import { describe, expect, it, vi } from "vitest";
import { PayPalApiError, PayPalClient } from "@/lib/paypal/client";
import { canonicalState } from "@/lib/paypal/mapper";
import type { PayPalInvoice } from "@/lib/paypal/types";

const cfg = { clientId: "id", clientSecret: "secret", baseUrl: "https://api-m.sandbox.paypal.com" };

function mockFetch(handlers: Array<(url: string, init: RequestInit) => Response | Promise<Response>>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const h = handlers[Math.min(i++, handlers.length - 1)];
    return h(url, init);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body == null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const token = () => json({ access_token: "A21-token", expires_in: 32400 });

describe("PayPal client", () => {
  it("caches the OAuth token across calls and sends idempotency headers", async () => {
    const m = mockFetch([token, () => json({ id: "INV2-AAA", status: "DRAFT", detail: { currency_code: "USD" } }, 201), () => new Response(null, { status: 204 })]);
    const c = new PayPalClient(cfg, m.fn);
    const created = await c.createDraftInvoice(
      { detail: { invoice_number: "CIQ-1", invoice_date: "2026-11-09", currency_code: "USD", payment_term: { due_date: "2026-11-16" } }, primary_recipients: [], items: [] },
      "ciq-create-1",
    );
    expect(created.id).toBe("INV2-AAA");
    await c.remindInvoice("INV2-AAA", { note: "hi" }, "ciq-remind-1");
    expect(m.calls.filter((x) => x.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);
    const createCall = m.calls[1];
    expect(createCall.url).toBe("https://api-m.sandbox.paypal.com/v2/invoicing/invoices");
    const h = createCall.init.headers as Record<string, string>;
    expect(h["PayPal-Request-Id"]).toBe("ciq-create-1");
    expect(h.Authorization).toBe("Bearer A21-token");
    expect(m.calls[2].url).toContain("/v2/invoicing/invoices/INV2-AAA/remind");
  });

  it("extracts the invoice id from a link-only create response", async () => {
    const m = mockFetch([token, () => json({ rel: "self", href: "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-LINK", method: "GET" }, 201)]);
    const c = new PayPalClient(cfg, m.fn);
    const r = await c.createDraftInvoice({ detail: { invoice_number: "x", invoice_date: "2026-11-09", currency_code: "USD", payment_term: { due_date: "2026-11-09" } }, primary_recipients: [], items: [] }, "r");
    expect(r.id).toBe("INV2-LINK");
  });

  it("maps PayPal API failures to PayPalApiError with the debug id", async () => {
    const m = mockFetch([
      token,
      () => json({ name: "UNPROCESSABLE_ENTITY", message: "The requested action could not be performed", details: [{ issue: "CANNOT_REMIND_INVOICE", description: "Invoice is paid." }] }, 422, { "paypal-debug-id": "abc123" }),
    ]);
    const c = new PayPalClient(cfg, m.fn);
    const err = await c.remindInvoice("INV2-X", {}, "r").catch((e) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err.status).toBe(422);
    expect(err.issue).toBe("CANNOT_REMIND_INVOICE");
    expect(err.debugId).toBe("abc123");
    expect(err.retryable).toBe(false);
  });

  it("reports authentication failures and network errors as retryable where appropriate", async () => {
    const bad = new PayPalClient(cfg, mockFetch([() => json({ error: "invalid_client", error_description: "Client Authentication failed" }, 401)]).fn);
    await expect(bad.accessToken()).rejects.toMatchObject({ status: 401, issue: "AUTHENTICATION_FAILURE" });
    const net = new PayPalClient(cfg, mockFetch([token, () => {
      throw new TypeError("fetch failed");
    }]).fn);
    const e = await net.getInvoice("INV2-Y").catch((x) => x);
    expect(e.issue).toBe("NETWORK_ERROR");
    expect(e.retryable).toBe(true);
  });

  it("verifies webhook signatures through PayPal and fails closed without headers", async () => {
    const m = mockFetch([token, () => json({ verification_status: "SUCCESS" })]);
    const c = new PayPalClient(cfg, m.fn);
    const headers = new Headers({
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
      "paypal-transmission-id": "t-1",
      "paypal-transmission-sig": "sig",
      "paypal-transmission-time": "2026-11-09T12:00:00Z",
    });
    expect(await c.verifyWebhookSignature({ headers, webhookId: "WH-ID", event: { id: "E1", event_type: "INVOICING.INVOICE.PAID" } })).toBe("SUCCESS");
    const body = JSON.parse(String(m.calls[1].init.body));
    expect(body.webhook_id).toBe("WH-ID");
    expect(body.transmission_id).toBe("t-1");

    const none = new PayPalClient(cfg, mockFetch([token]).fn);
    expect(await none.verifyWebhookSignature({ headers: new Headers(), webhookId: "WH-ID", event: { id: "E1", event_type: "x" } })).toBe("FAILURE");
  });
});

describe("canonical status mapping", () => {
  const inv = (status: PayPalInvoice["status"], total: string, due: string, paid: string): PayPalInvoice => ({
    id: "INV2",
    status,
    detail: { currency_code: "USD" },
    amount: { currency_code: "USD", value: total },
    due_amount: { currency_code: "USD", value: due },
    payments: { paid_amount: { currency_code: "USD", value: paid } },
  });
  it("never treats PAID as settled while a balance is due", () => {
    expect(canonicalState(inv("PAID", "100.00", "40.00", "60.00"), 10000).status).toBe("partially_paid");
    expect(canonicalState(inv("PAID", "100.00", "0.00", "100.00"), 10000)).toMatchObject({ status: "paid", fully_settled: true });
    expect(canonicalState(inv("SENT", "100.00", "100.00", "0.00"), 10000).status).toBe("sent");
    expect(canonicalState(inv("CANCELLED", "100.00", "100.00", "0.00"), 10000).amount_due_cents).toBe(0);
  });
});
