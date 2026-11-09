import { NextResponse } from "next/server";
import { env, integrationModes } from "@/lib/env";
import { log } from "@/lib/logger";
import { defaultGatewayResolver, paypalClient } from "@/lib/paypal";
import type { WebhookEventBody } from "@/lib/paypal/types";
import { jsonError, systemStore } from "@/lib/server";
import { processWebhook } from "@/lib/services/webhooks";

/**
 * PayPal webhook receiver. Every event is verified with PayPal's
 * verify-webhook-signature API before anything is trusted or changed.
 */
export async function POST(req: Request) {
  const client = paypalClient();
  if (!client || !env.paypal.webhookId || integrationModes().paypal === "demo") {
    return jsonError("PayPal webhooks are not configured (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID).", 503, "webhooks_not_configured");
  }
  const raw = await req.text();
  if (raw.length > 512_000) return jsonError("Payload too large", 413, "too_large");
  let event: WebhookEventBody;
  try {
    event = JSON.parse(raw);
  } catch {
    return jsonError("Invalid JSON", 400, "bad_json");
  }
  const headers = req.headers;
  const result = await processWebhook({
    store: systemStore(),
    event,
    gateways: defaultGatewayResolver(),
    verify: (ev) => client.verifyWebhookSignature({ headers, webhookId: env.paypal.webhookId!, event: ev }),
  });
  log.info("webhook.result", { eventId: event.id, type: event.event_type, outcome: result.outcome });
  return NextResponse.json({ outcome: result.outcome, message: result.message }, { status: result.httpStatus });
}
