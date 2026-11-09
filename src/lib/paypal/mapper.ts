import { fromCents, toCents } from "@/lib/money";
import type { Client, Invoice, InvoiceItem, InvoiceStatus } from "@/lib/types";
import type { CreateInvoicePayload, PayPalInvoice } from "./types";

export function toPayPalCreatePayload(invoice: Invoice, items: InvoiceItem[], client: Client, taxRatePercent: number): CreateInvoicePayload {
  const [given, ...rest] = client.name.trim().split(/\s+/);
  return {
    detail: {
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.issue_date,
      currency_code: invoice.currency,
      note: invoice.note ?? undefined,
      payment_term: { due_date: invoice.due_date },
    },
    primary_recipients: [
      {
        billing_info: {
          name: { given_name: given ?? client.name, surname: rest.join(" ") || undefined },
          email_address: client.email,
        },
      },
    ],
    items: [...items]
      .sort((a, b) => a.position - b.position)
      .map((it) => ({
        name: it.description.slice(0, 200),
        quantity: String(it.quantity),
        unit_amount: { currency_code: invoice.currency, value: fromCents(it.unit_amount_cents) },
        unit_of_measure: "QUANTITY" as const,
        ...(taxRatePercent > 0 ? { tax: { name: "Tax", percent: String(taxRatePercent) } } : {}),
      })),
  };
}

export interface CanonicalState {
  status: InvoiceStatus;
  paypal_status: string;
  amount_paid_cents: number;
  amount_due_cents: number;
  recipient_url: string | null;
  invoicer_url: string | null;
  fully_settled: boolean;
}

/**
 * Derive local state from PayPal's canonical invoice. A "PAID"-type status is
 * only treated as fully settled when PayPal also reports no outstanding balance.
 */
export function canonicalState(pp: PayPalInvoice, localTotalCents: number): CanonicalState {
  const paid = pp.payments?.paid_amount ? toCents(pp.payments.paid_amount.value) : 0;
  const total = pp.amount ? toCents(pp.amount.value) : localTotalCents;
  const due = pp.due_amount ? toCents(pp.due_amount.value) : Math.max(0, total - paid);

  let status: InvoiceStatus;
  switch (pp.status) {
    case "PAID":
    case "MARKED_AS_PAID":
      status = due <= 0 ? "paid" : "partially_paid";
      break;
    case "PARTIALLY_PAID":
      status = due <= 0 ? "paid" : "partially_paid";
      break;
    case "CANCELLED":
      status = "cancelled";
      break;
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
    case "MARKED_AS_REFUNDED":
      status = "refunded";
      break;
    case "UNPAID":
      status = "unpaid";
      break;
    case "DRAFT":
      status = "draft";
      break;
    default:
      status = "sent";
  }
  return {
    status,
    paypal_status: pp.status,
    amount_paid_cents: paid,
    amount_due_cents: status === "cancelled" ? 0 : due,
    recipient_url: pp.detail?.metadata?.recipient_view_url ?? null,
    invoicer_url: pp.detail?.metadata?.invoicer_view_url ?? null,
    fully_settled: status === "paid",
  };
}
