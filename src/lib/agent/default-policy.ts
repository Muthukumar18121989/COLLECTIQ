import type { PolicyStep } from "@/lib/types";

/** The spec's default collection ladder. */
export const DEFAULT_POLICY_STEPS: PolicyStep[] = [
  {
    id: "pre_due_3",
    offset_days: -3,
    action: "reminder",
    tone: "friendly",
    requires_approval: false,
    label: "Friendly reminder 3 days before due",
  },
  {
    id: "overdue_1",
    offset_days: 1,
    action: "reminder",
    tone: "neutral",
    requires_approval: false,
    label: "Payment follow-up 1 day overdue",
  },
  {
    id: "overdue_7",
    offset_days: 7,
    action: "escalation",
    tone: "firm",
    requires_approval: true,
    label: "Escalation reminder 7 days overdue",
  },
  {
    id: "overdue_14",
    offset_days: 14,
    action: "manual_review",
    tone: "neutral",
    requires_approval: true,
    label: "Notify me for manual review at 14 days overdue",
  },
];

export const DEFAULT_POLICY = {
  name: "Standard collection",
  status: "active" as const,
  is_default: true,
  auto_execute: true,
  steps: DEFAULT_POLICY_STEPS,
  max_reminders_per_invoice: 4,
  min_days_between_reminders: 2,
  reminder_note_template: null,
};

const TONE_COPY: Record<PolicyStep["tone"], (n: string, amount: string, due: string) => string> = {
  friendly: (n, a, d) =>
    `Hi ${n}, just a friendly heads-up that invoice for ${a} is due on ${d}. You can pay securely through the PayPal link. Thank you!`,
  neutral: (n, a, d) =>
    `Hi ${n}, this is a reminder that the invoice for ${a} (due ${d}) is still open. You can pay through the PayPal link at your convenience.`,
  firm: (n, a, d) =>
    `Hi ${n}, the invoice for ${a} was due on ${d} and remains unpaid. Please arrange payment through the PayPal link or reply to let me know when to expect it.`,
};

export function reminderNote(tone: PolicyStep["tone"], clientName: string, amount: string, due: string) {
  return TONE_COPY[tone](clientName.split(" ")[0] ?? clientName, amount, due).slice(0, 4000);
}
