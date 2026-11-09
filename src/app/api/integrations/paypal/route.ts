import { NextResponse } from "next/server";
import { integrationModes } from "@/lib/env";
import { PayPalApiError } from "@/lib/paypal/client";
import { paypalClient } from "@/lib/paypal";
import { apiRoute, jsonError } from "@/lib/server";

/** Real connectivity test: requests an OAuth token and lists one invoice from PayPal. */
export const POST = apiRoute(async () => {
  const client = paypalClient();
  if (!client) return jsonError("PayPal credentials are not configured.", 400, "not_configured");
  try {
    await client.accessToken();
    const list = await client.listInvoices(1, 1);
    return NextResponse.json({ ok: true, mode: integrationModes().paypal, total_invoices: list.total_items ?? null });
  } catch (e) {
    const msg = e instanceof PayPalApiError ? `${e.message}${e.debugId ? ` (debug id ${e.debugId})` : ""}` : (e as Error).message;
    return jsonError(`PayPal connection failed: ${msg}`, 502, "paypal_error");
  }
});
