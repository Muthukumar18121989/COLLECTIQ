// Domain types. Row types mirror the Supabase schema (snake_case) so the same
// objects flow through the demo store, the Supabase store and the services.

export type Currency = "USD" | "EUR" | "GBP" | "CAD" | "AUD" | "INR";
export const CURRENCIES: Currency[] = ["USD", "EUR", "GBP", "CAD", "AUD", "INR"];

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "unpaid"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "cancelled"
  | "refunded";

/** Where an invoice's PayPal side lives. `demo` means no PayPal call was ever made. */
export type PayPalMode = "sandbox" | "live" | "demo";

export type AutonomyMode = "assisted" | "policy_driven" | "adaptive";
export type ReminderTone = "friendly" | "neutral" | "firm";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  business_name: string | null;
  default_currency: Currency;
  autonomy_mode: AutonomyMode;
  tax_rate_percent: number;
  timezone: string;
  agent_paused: boolean;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  user_id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  currency: Currency;
  collection_paused: boolean;
  dispute_open: boolean;
  dispute_note: string | null;
  notes: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  client_id: string;
  name: string;
  status: "active" | "completed" | "archived";
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  user_id: string;
  client_id: string;
  project_id: string | null;
  policy_id: string | null;
  invoice_number: string;
  currency: Currency;
  issue_date: string; // YYYY-MM-DD
  due_date: string; // YYYY-MM-DD
  status: InvoiceStatus;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  amount_due_cents: number;
  note: string | null;
  collection_paused: boolean;
  dispute_open: boolean;
  paypal_mode: PayPalMode | null;
  paypal_invoice_id: string | null;
  paypal_status: string | null;
  paypal_recipient_url: string | null;
  paypal_invoicer_url: string | null;
  paypal_last_synced_at: string | null;
  sent_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  is_demo: boolean;
  created_by: "user" | "agent";
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: string;
  user_id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_amount_cents: number;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PolicyStep {
  id: string;
  /** Days relative to due date: negative = before due, positive = overdue. */
  offset_days: number;
  action: "reminder" | "escalation" | "manual_review";
  tone: ReminderTone;
  requires_approval: boolean;
  label: string;
}

export interface CollectionPolicy {
  id: string;
  user_id: string;
  name: string;
  status: "active" | "paused";
  is_default: boolean;
  auto_execute: boolean;
  steps: PolicyStep[];
  max_reminders_per_invoice: number;
  min_days_between_reminders: number;
  reminder_note_template: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export type AgentTaskStatus =
  | "pending_approval"
  | "executing"
  | "succeeded"
  | "failed"
  | "blocked"
  | "suppressed"
  | "skipped";

export interface AgentTask {
  id: string;
  user_id: string;
  invoice_id: string | null;
  kind: "reminder" | "escalation" | "manual_review" | "send_invoice" | "sync";
  step_id: string | null;
  idempotency_key: string;
  status: AgentTaskStatus;
  trigger: "scheduler" | "chat" | "user" | "webhook";
  scheduled_for: string | null;
  executed_at: string | null;
  paypal_ref: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export type ActivityCategory =
  | "invoice_created"
  | "invoice_sent"
  | "invoice_cancelled"
  | "reminder_prepared"
  | "reminder_sent"
  | "payment_received"
  | "payment_status_updated"
  | "policy_activated"
  | "policy_paused"
  | "policy_updated"
  | "approval_requested"
  | "approval_decided"
  | "action_blocked"
  | "manual_review_requested"
  | "webhook_received"
  | "settings_changed";

export type ExecutionStatus =
  | "succeeded"
  | "pending"
  | "approval_required"
  | "failed"
  | "blocked"
  | "info";

export interface AgentActivity {
  id: string;
  user_id: string;
  category: ActivityCategory;
  invoice_id: string | null;
  client_id: string | null;
  trigger: string;
  observed_condition: string | null;
  reasoning: string | null;
  proposed_action: string | null;
  permission_result: string | null;
  approval_status: "not_required" | "pending" | "approved" | "rejected" | null;
  execution_status: ExecutionStatus;
  paypal_ref: string | null;
  error: string | null;
  mode: PayPalMode | "internal";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ApprovalKind =
  | "create_invoice"
  | "send_invoice"
  | "send_reminder"
  | "escalation"
  | "cancel_invoice"
  | "pause_collection"
  | "policy_recommendation";

export interface Approval {
  id: string;
  user_id: string;
  kind: ApprovalKind;
  status: "pending" | "approved" | "rejected" | "executed" | "failed" | "expired";
  source: "chat" | "scheduler" | "adaptive" | "user";
  summary: string;
  reasoning: string | null;
  payload: Record<string, unknown>;
  invoice_id: string | null;
  client_id: string | null;
  agent_task_id: string | null;
  idempotency_key: string | null;
  result: Record<string, unknown> | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookEvent {
  id: string;
  user_id: string | null;
  paypal_event_id: string;
  event_type: string;
  resource_id: string | null;
  verification_status: "SUCCESS" | "FAILURE" | "SKIPPED_DEMO";
  processing_status: "received" | "processed" | "ignored" | "failed" | "duplicate";
  payload: Record<string, unknown>;
  error: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  user_id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls: Array<{ name: string; input: unknown; result_summary: string }>;
  approval_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface TableMap {
  profiles: Profile;
  clients: Client;
  projects: Project;
  invoices: Invoice;
  invoice_items: InvoiceItem;
  collection_policies: CollectionPolicy;
  agent_tasks: AgentTask;
  agent_activity: AgentActivity;
  approvals: Approval;
  webhook_events: WebhookEvent;
  conversations: Conversation;
  conversation_messages: ConversationMessage;
}
export type TableName = keyof TableMap;
