import { UserDb } from "@/lib/db/user-db";
import { type Store, UniqueViolationError } from "@/lib/db/store";
import { log } from "@/lib/logger";
import type { GatewayResolver } from "@/lib/paypal";
import type { PayPalInvoice, WebhookEventBody } from "@/lib/paypal/types";
import type { WebhookEvent } from "@/lib/types";
import { recordActivity } from "./context";
import { applyCanonical } from "./invoices";

export const HANDLED_EVENTS = new Set([
  "INVOICING.INVOICE.CREATED",
  "INVOICING.INVOICE.SENT",
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.PARTIALLY_PAID",
  "INVOICING.INVOICE.CANCELLED",
  "INVOICING.INVOICE.REFUNDED",
  "INVOICING.INVOICE.UPDATED",
  "INVOICING.INVOICE.SCHEDULED",
]);

export type Verifier = (event: WebhookEventBody) => Promise<"SUCCESS" | "FAILURE" | "SKIPPED_DEMO">;

export interface WebhookResult {
  httpStatus: number;
  outcome: "processed" | "duplicate" | "ignored" | "rejected" | "failed";
  message: string;
}

function invoiceIdFrom(event: WebhookEventBody): string | null {
  const r = event.resource ?? {};
  const inv = (r as { invoice?: PayPalInvoice }).invoice;
  return inv?.id ?? (typeof r.id === "string" ? r.id : null);
}

/**
 * Verify → persist (dedupe by event id) → look up local invoice → fetch the
 * canonical invoice from PayPal → update local state → suppress reminders.
 * Returns 5xx on processing errors so PayPal retries; retries of an event that
 * already processed successfully are acknowledged without side effects.
 */
export async function processWebhook(input: {
  store: Store;
  event: WebhookEventBody;
  verify: Verifier;
  gateways: GatewayResolver;
  now?: () => Date;
}): Promise<WebhookResult> {
  const { store, event } = input;
  const now = input.now ?? (() => new Date());
  if (!event?.id || !event.event_type) {
    return { httpStatus: 400, outcome: "rejected", message: "Malformed webhook body" };
  }

  // 1. Verify every event with PayPal before trusting it.
  let verification: WebhookEvent["verification_status"];
  try {
    verification = await input.verify(event);
  } catch (e) {
    log.error("webhook.verify_error", { eventId: event.id, error: (e as Error).message });
    return { httpStatus: 503, outcome: "failed", message: "Could not verify signature; please retry" };
  }

  const resourceId = invoiceIdFrom(event);
  const local = resourceId ? await store.findOne("invoices", { paypal_invoice_id: resourceId }) : null;

  // 2. Persist + dedupe.
  let row: WebhookEvent;
  try {
    row = await store.insert("webhook_events", {
      user_id: local?.user_id ?? null,
      paypal_event_id: event.id,
      event_type: event.event_type,
      resource_id: resourceId,
      verification_status: verification,
      processing_status: "received",
      payload: event as unknown as Record<string, unknown>,
      error: null,
      processed_at: null,
    });
  } catch (e) {
    if (!(e instanceof UniqueViolationError)) throw e;
    const existing = await store.findOne("webhook_events", { paypal_event_id: event.id });
    if (!existing || ["processed", "ignored", "duplicate"].includes(existing.processing_status)) {
      return { httpStatus: 200, outcome: "duplicate", message: "Event already processed" };
    }
    row = existing; // previous attempt failed: safe to retry
  }

  if (verification === "FAILURE") {
    await store.update("webhook_events", row.id, { processing_status: "ignored", error: "Signature verification failed", processed_at: now().toISOString() });
    return { httpStatus: 400, outcome: "rejected", message: "Signature verification failed" };
  }
  if (!HANDLED_EVENTS.has(event.event_type)) {
    await store.update("webhook_events", row.id, { processing_status: "ignored", processed_at: now().toISOString() });
    return { httpStatus: 200, outcome: "ignored", message: `Event type ${event.event_type} not handled` };
  }
  if (!local) {
    await store.update("webhook_events", row.id, { processing_status: "ignored", error: "No matching local invoice", processed_at: now().toISOString() });
    return { httpStatus: 200, outcome: "ignored", message: "No matching invoice" };
  }

  // 3. Canonical state: never trust the event payload alone for payment status.
  const ctx = { db: new UserDb(store, local.user_id), gateways: input.gateways, now };
  try {
    const gateway = input.gateways.forInvoice(local);
    const pp = await gateway.fetch(local);
    await recordActivity(ctx, {
      category: "webhook_received",
      invoice_id: local.id,
      client_id: local.client_id,
      trigger: `PayPal webhook ${event.event_type}`,
      observed_condition: `Event ${event.id}; canonical PayPal status ${pp.status}.`,
      execution_status: "info",
      paypal_ref: local.paypal_invoice_id,
      mode: gateway.mode,
      metadata: { webhook_event_id: row.id, verification },
    });
    await applyCanonical(ctx, local, pp, `PayPal webhook ${event.event_type}`, gateway.mode);
    await store.update("webhook_events", row.id, { user_id: local.user_id, processing_status: "processed", processed_at: now().toISOString(), error: null });
    return { httpStatus: 200, outcome: "processed", message: "Processed" };
  } catch (e) {
    const msg = (e as Error).message;
    log.error("webhook.process_error", { eventId: event.id, error: msg });
    await store.update("webhook_events", row.id, { processing_status: "failed", error: msg });
    return { httpStatus: 500, outcome: "failed", message: "Processing failed; PayPal will retry" };
  }
}
