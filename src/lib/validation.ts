import { z } from "zod";
import { CURRENCIES } from "@/lib/types";

const id = z.string().min(1).max(64);
const isoDate = z.iso.date({ message: "Use a YYYY-MM-DD date" });
const money = z.coerce
  .number({ message: "Enter an amount" })
  .positive("Amount must be greater than zero")
  .max(1_000_000, "Amount is too large")
  .refine((n) => Math.round(n * 100) === Number((n * 100).toFixed(2)), "Use at most 2 decimal places");

export const lineItemSchema = z.object({
  description: z.string().trim().min(1, "Describe the work").max(200),
  quantity: z.coerce.number().positive("Quantity must be positive").max(10_000),
  unit_amount: money,
});

export const invoiceInputSchema = z
  .object({
    client_id: id,
    project_name: z.string().trim().max(120).optional().nullable(),
    currency: z.enum(CURRENCIES as [string, ...string[]]),
    issue_date: isoDate,
    due_date: isoDate,
    note: z.string().trim().max(4000).optional().nullable(),
    policy_id: id.optional().nullable(),
    items: z.array(lineItemSchema).min(1, "Add at least one line item").max(50),
  })
  .refine((v) => v.due_date >= v.issue_date, { message: "Due date must be on or after the issue date", path: ["due_date"] });
export type InvoiceInput = z.infer<typeof invoiceInputSchema>;

export const clientInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.email("Enter a valid email"),
  company: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  currency: z.enum(CURRENCIES as [string, ...string[]]).default("USD"),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type ClientInput = z.infer<typeof clientInputSchema>;

export const clientPatchSchema = clientInputSchema.partial().extend({
  collection_paused: z.boolean().optional(),
  dispute_open: z.boolean().optional(),
  dispute_note: z.string().trim().max(2000).optional().nullable(),
});

export const policyStepSchema = z.object({
  id: z.string().trim().min(1).max(40),
  offset_days: z.coerce.number().int().min(-60).max(180),
  action: z.enum(["reminder", "escalation", "manual_review"]),
  tone: z.enum(["friendly", "neutral", "firm"]),
  requires_approval: z.boolean(),
  label: z.string().trim().min(1).max(120),
});

export const policyInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    status: z.enum(["active", "paused"]),
    auto_execute: z.boolean(),
    is_default: z.boolean().optional(),
    steps: z.array(policyStepSchema).min(1).max(10),
    max_reminders_per_invoice: z.coerce.number().int().min(1).max(10),
    min_days_between_reminders: z.coerce.number().int().min(1).max(30),
    reminder_note_template: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((p) => new Set(p.steps.map((s) => s.id)).size === p.steps.length, {
    message: "Step ids must be unique",
    path: ["steps"],
  })
  .transform((p) => ({
    ...p,
    // Escalations always require approval, regardless of what the form sent.
    steps: p.steps.map((s) => (s.action === "reminder" ? s : { ...s, requires_approval: true })),
  }));
export type PolicyInput = z.infer<typeof policyInputSchema>;

export const settingsSchema = z.object({
  full_name: z.string().trim().max(120).optional().nullable(),
  business_name: z.string().trim().max(120).optional().nullable(),
  default_currency: z.enum(CURRENCIES as [string, ...string[]]).optional(),
  autonomy_mode: z.enum(["assisted", "policy_driven", "adaptive"]).optional(),
  tax_rate_percent: z.coerce.number().min(0).max(50).optional(),
  agent_paused: z.boolean().optional(),
});

export const chatInputSchema = z.object({
  conversation_id: id.optional().nullable(),
  message: z.string().trim().min(1, "Type a message").max(2000),
});

export const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
});
