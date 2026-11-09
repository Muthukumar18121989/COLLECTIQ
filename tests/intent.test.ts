import { describe, expect, it } from "vitest";
import { extractAmount, extractDue, parseIntent } from "@/lib/agent/intent";
import type { Client } from "@/lib/types";

const client = (id: string, name: string, company: string | null = null): Client => ({
  id,
  user_id: "u",
  name,
  email: `${name.split(" ")[0].toLowerCase()}@example.com`,
  company,
  phone: null,
  currency: "USD",
  collection_paused: false,
  dispute_open: false,
  dispute_note: null,
  notes: null,
  is_demo: false,
  created_at: "",
  updated_at: "",
});

const clients = [client("1", "Sarah Chen", "Bloom Studio"), client("2", "Alex Rivera", "Northwind Labs"), client("3", "Maya Patel")];

describe("AI intent extraction (rule-based engine)", () => {
  it("extracts a complete invoice request", () => {
    const r = parseIntent("Create an invoice for Sarah for $850 for branding work, due in seven days.", clients);
    expect(r.kind).toBe("create_invoice");
    expect(r.client?.id).toBe("1");
    expect(r.amount).toBe(850);
    expect(r.currency).toBe("USD");
    expect(r.dueInDays).toBe(7);
    expect(r.description?.toLowerCase()).toContain("branding");
    expect(r.clarification).toBeUndefined();
  });

  it("parses amounts and due dates in several formats", () => {
    expect(extractAmount("bill them $1,250.50 now")).toEqual({ amount: 1250.5, currency: "USD" });
    expect(extractAmount("€300 for edits")).toEqual({ amount: 300, currency: "EUR" });
    expect(extractAmount("400 GBP")).toEqual({ amount: 400, currency: "GBP" });
    expect(extractAmount("no money here")).toEqual({});
    expect(extractDue("due in 14 days")).toEqual({ dueInDays: 14 });
    expect(extractDue("due in two weeks")).toEqual({ dueInDays: 14 });
    expect(extractDue("due on 2026-12-01")).toEqual({ dueDate: "2026-12-01" });
  });

  it("recognises the spec's example instructions", () => {
    expect(parseIntent("Show all overdue invoices", clients).kind).toBe("list_overdue");
    expect(parseIntent("Which client owes me the most money?", clients).kind).toBe("top_debtor");
    expect(parseIntent("Prepare reminders for clients who haven't paid", clients).kind).toBe("prepare_reminders");
    expect(parseIntent("How much money am I expecting this month?", clients).kind).toBe("expected_income");
    expect(parseIntent("Show invoices due this week", clients).kind).toBe("due_this_week");
    expect(parseIntent("Explain why my outstanding balance has increased", clients).kind).toBe("explain_outstanding");
    const pause = parseIntent("Pause reminders for Alex", clients);
    expect(pause.kind).toBe("pause_reminders");
    expect(pause.client?.id).toBe("2");
  });

  it("matches clients by company name", () => {
    expect(parseIntent("Invoice Northwind Labs $500 for the audit", clients).client?.id).toBe("2");
  });
});

describe("missing client information", () => {
  it("never invents a client that is not saved", () => {
    const r = parseIntent("Create an invoice for Priya for $500 for logo work", clients);
    expect(r.kind).toBe("create_invoice");
    expect(r.client).toBeUndefined();
    expect(r.requestedClientName).toBe("Priya");
    expect(r.clarification).toMatch(/don't have a client called "Priya"/);
  });

  it("asks for the amount instead of guessing", () => {
    const r = parseIntent("Create an invoice for Sarah for branding work", clients);
    expect(r.client?.id).toBe("1");
    expect(r.clarification).toMatch(/How much/);
  });

  it("asks which client when a pause request is ambiguous or unknown", () => {
    expect(parseIntent("Pause reminders for Jordan", clients).clarification).toBeDefined();
  });
});
