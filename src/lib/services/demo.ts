import { fromCents } from "@/lib/money";
import type { PayPalInvoice } from "@/lib/paypal/types";
import { type ServiceContext, ServiceError, recordActivity } from "./context";
import { applyCanonical } from "./invoices";

/**
 * DEMO MODE ONLY. Simulates PayPal reporting a payment on a demo invoice so the
 * payment-event pipeline (status update, reminder suppression, activity) can be
 * exercised without PayPal. Refuses to touch any invoice that lives in PayPal.
 */
export async function simulateDemoPayment(ctx: ServiceContext, invoiceId: string, amountCents?: number) {
  const inv = await ctx.db.require("invoices", invoiceId);
  if (inv.paypal_mode !== "demo") {
    throw new ServiceError("Payment simulation is only available for demo-mode invoices. Real payments must come from PayPal.", 403, "not_demo");
  }
  if (!["sent", "unpaid", "partially_paid", "overdue"].includes(inv.status)) {
    throw new ServiceError(`Invoice is ${inv.status}; nothing to pay.`, 409, "not_open");
  }
  const pay = Math.min(amountCents ?? inv.amount_due_cents, inv.amount_due_cents);
  if (pay <= 0) throw new ServiceError("Amount must be positive", 422, "validation");
  const paid = inv.amount_paid_cents + pay;
  const due = inv.total_cents - paid;
  const pp: PayPalInvoice = {
    id: inv.paypal_invoice_id ?? `DEMO-INV-${inv.invoice_number}`,
    status: due <= 0 ? "PAID" : "PARTIALLY_PAID",
    detail: { currency_code: inv.currency },
    amount: { currency_code: inv.currency, value: fromCents(inv.total_cents) },
    due_amount: { currency_code: inv.currency, value: fromCents(Math.max(0, due)) },
    payments: { paid_amount: { currency_code: inv.currency, value: fromCents(paid) } },
  };
  await ctx.db.store.insert("webhook_events", {
    user_id: ctx.db.userId,
    paypal_event_id: `DEMO-EVT-${crypto.randomUUID()}`,
    event_type: due <= 0 ? "INVOICING.INVOICE.PAID" : "INVOICING.INVOICE.PARTIALLY_PAID",
    resource_id: pp.id,
    verification_status: "SKIPPED_DEMO",
    processing_status: "processed",
    payload: { demo: true, simulated: true, invoice: pp } as Record<string, unknown>,
    error: null,
    processed_at: ctx.now().toISOString(),
  });
  await recordActivity(ctx, {
    category: "webhook_received",
    invoice_id: inv.id,
    client_id: inv.client_id,
    trigger: "DEMO: simulated payment event",
    observed_condition: "Simulated in demo mode. This is not a PayPal event and no money moved.",
    execution_status: "info",
    mode: "demo",
  });
  return applyCanonical(ctx, inv, pp, "DEMO: simulated payment event", "demo");
}
