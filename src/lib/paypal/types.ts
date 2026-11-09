// Subset of the PayPal Invoicing v2 resource shapes that COLLECTIQ reads.
// Reference: https://developer.paypal.com/docs/api/invoicing/v2/

export interface PayPalMoney {
  currency_code: string;
  value: string;
}

export type PayPalInvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "SCHEDULED"
  | "PAID"
  | "MARKED_AS_PAID"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_PAID"
  | "PARTIALLY_REFUNDED"
  | "MARKED_AS_REFUNDED"
  | "UNPAID"
  | "PAYMENT_PENDING";

export interface PayPalInvoice {
  id: string;
  status: PayPalInvoiceStatus;
  detail: {
    invoice_number?: string;
    invoice_date?: string;
    currency_code: string;
    note?: string;
    payment_term?: { term_type?: string; due_date?: string };
    metadata?: {
      create_time?: string;
      recipient_view_url?: string;
      invoicer_view_url?: string;
      last_update_time?: string;
    };
  };
  primary_recipients?: Array<{
    billing_info?: { name?: { given_name?: string; surname?: string }; email_address?: string };
  }>;
  items?: Array<{ name: string; quantity: string; unit_amount: PayPalMoney }>;
  amount?: PayPalMoney & { breakdown?: Record<string, unknown> };
  due_amount?: PayPalMoney;
  payments?: { paid_amount?: PayPalMoney; transactions?: Array<Record<string, unknown>> };
  refunds?: { refund_amount?: PayPalMoney };
}

export interface PayPalLink {
  rel: string;
  href: string;
  method?: string;
}

export interface CreateInvoicePayload {
  detail: {
    invoice_number: string;
    invoice_date: string;
    currency_code: string;
    note?: string;
    payment_term: { due_date: string };
  };
  primary_recipients: Array<{
    billing_info: { name: { given_name: string; surname?: string }; email_address: string };
  }>;
  items: Array<{
    name: string;
    quantity: string;
    unit_amount: PayPalMoney;
    unit_of_measure: "QUANTITY";
    tax?: { name: string; percent: string };
  }>;
}

export interface WebhookEventBody {
  id: string;
  event_type: string;
  resource_type?: string;
  summary?: string;
  create_time?: string;
  resource?: { invoice?: PayPalInvoice; id?: string } & Record<string, unknown>;
}
