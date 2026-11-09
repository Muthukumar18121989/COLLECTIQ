import { log } from "@/lib/logger";
import type {
  CreateInvoicePayload,
  PayPalInvoice,
  PayPalLink,
  WebhookEventBody,
} from "./types";

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

/** A failed PayPal call. Never treat one of these as a success. */
export class PayPalApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly debugId: string | null,
    public readonly issue: string | null,
    public readonly details: unknown,
  ) {
    super(message);
    this.name = "PayPalApiError";
  }
  get retryable() {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}

type Fetch = typeof fetch;

/**
 * Thin, typed wrapper over the PayPal REST APIs used by COLLECTIQ.
 * Server-side only: it holds the client secret.
 */
export class PayPalClient {
  private token: { value: string; expiresAt: number } | null = null;
  private tokenPromise: Promise<string> | null = null;

  constructor(private readonly cfg: PayPalConfig, private readonly fetchImpl: Fetch = fetch) {}

  /** OAuth 2.0 client-credentials token, cached until 60s before expiry. */
  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = (async () => {
      const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
      const res = await this.fetchImpl(`${this.cfg.baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        expires_in?: number;
        error_description?: string;
      };
      if (!res.ok || !body.access_token) {
        throw new PayPalApiError(
          `PayPal authentication failed: ${body.error_description ?? res.statusText}`,
          res.status,
          res.headers.get("paypal-debug-id"),
          "AUTHENTICATION_FAILURE",
          null,
        );
      }
      this.token = {
        value: body.access_token,
        expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 300) - 60) * 1000,
      };
      return body.access_token;
    })().finally(() => {
      this.tokenPromise = null;
    });
    return this.tokenPromise;
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts: { body?: unknown; requestId?: string; prefer?: boolean } = {},
  ): Promise<{ status: number; data: T | null }> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    // PayPal-Request-Id makes POSTs idempotent: a retry with the same id
    // returns the original result instead of repeating the operation.
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    if (opts.prefer) headers["Prefer"] = "return=representation";

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: "no-store",
      });
    } catch (e) {
      throw new PayPalApiError(`Network error calling PayPal: ${(e as Error).message}`, 0, null, "NETWORK_ERROR", null);
    }
    const debugId = res.headers.get("paypal-debug-id");
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const err = (data ?? {}) as { message?: string; name?: string; details?: Array<{ issue?: string; description?: string }> };
      const issue = err.details?.[0]?.issue ?? err.name ?? null;
      const desc = err.details?.[0]?.description ?? err.message ?? res.statusText;
      log.warn("paypal.request_failed", { method, path, status: res.status, debugId, issue });
      if (res.status === 401) this.token = null;
      throw new PayPalApiError(`PayPal ${res.status}: ${desc}`, res.status, debugId, issue, err.details ?? null);
    }
    log.info("paypal.request_ok", { method, path, status: res.status, debugId });
    return { status: res.status, data: data as T };
  }

  /** POST /v2/invoicing/invoices — creates a DRAFT invoice at PayPal. */
  async createDraftInvoice(payload: CreateInvoicePayload, requestId: string): Promise<{ id: string; invoice: PayPalInvoice | null }> {
    const { data } = await this.request<PayPalInvoice | PayPalLink>("POST", "/v2/invoicing/invoices", {
      body: payload,
      requestId,
      prefer: true,
    });
    if (data && "id" in data && data.id) return { id: data.id, invoice: data as PayPalInvoice };
    const href = (data as PayPalLink | null)?.href ?? "";
    const id = href.split("/").pop();
    if (!id) throw new PayPalApiError("PayPal did not return an invoice id", 502, null, "MISSING_ID", data);
    return { id, invoice: null };
  }

  /** POST /v2/invoicing/invoices/{id}/send */
  async sendInvoice(id: string, opts: { subject?: string; note?: string }, requestId: string): Promise<{ recipientUrl: string | null; status: number }> {
    const { status, data } = await this.request<PayPalLink>("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, {
      body: { send_to_invoicer: true, send_to_recipient: true, subject: opts.subject, note: opts.note },
      requestId,
    });
    return { recipientUrl: data?.href ?? null, status };
  }

  /** POST /v2/invoicing/invoices/{id}/remind — returns 204 on success. */
  async remindInvoice(id: string, opts: { subject?: string; note?: string }, requestId: string): Promise<void> {
    await this.request("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, {
      body: { subject: opts.subject, note: opts.note, send_to_invoicer: false, send_to_recipient: true },
      requestId,
    });
  }

  /** POST /v2/invoicing/invoices/{id}/cancel — returns 204 on success. */
  async cancelInvoice(id: string, opts: { subject?: string; note?: string }, requestId: string): Promise<void> {
    await this.request("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, {
      body: { subject: opts.subject, note: opts.note, send_to_invoicer: true, send_to_recipient: true },
      requestId,
    });
  }

  /** GET /v2/invoicing/invoices/{id} — canonical state. */
  async getInvoice(id: string): Promise<PayPalInvoice> {
    const { data } = await this.request<PayPalInvoice>("GET", `/v2/invoicing/invoices/${encodeURIComponent(id)}`);
    if (!data) throw new PayPalApiError("Empty invoice response", 502, null, "EMPTY", null);
    return data;
  }

  /** GET /v2/invoicing/invoices */
  async listInvoices(page = 1, pageSize = 20): Promise<{ items: PayPalInvoice[]; total_items?: number }> {
    const { data } = await this.request<{ items?: PayPalInvoice[]; total_items?: number }>(
      "GET",
      `/v2/invoicing/invoices?page=${page}&page_size=${pageSize}&total_required=true`,
    );
    return { items: data?.items ?? [], total_items: data?.total_items };
  }

  /** POST /v1/notifications/verify-webhook-signature */
  async verifyWebhookSignature(input: {
    headers: Headers;
    webhookId: string;
    event: WebhookEventBody;
  }): Promise<"SUCCESS" | "FAILURE"> {
    const h = input.headers;
    const required = {
      auth_algo: h.get("paypal-auth-algo"),
      cert_url: h.get("paypal-cert-url"),
      transmission_id: h.get("paypal-transmission-id"),
      transmission_sig: h.get("paypal-transmission-sig"),
      transmission_time: h.get("paypal-transmission-time"),
    };
    if (Object.values(required).some((v) => !v)) return "FAILURE";
    const { data } = await this.request<{ verification_status: "SUCCESS" | "FAILURE" }>(
      "POST",
      "/v1/notifications/verify-webhook-signature",
      { body: { ...required, webhook_id: input.webhookId, webhook_event: input.event } },
    );
    return data?.verification_status === "SUCCESS" ? "SUCCESS" : "FAILURE";
  }
}
