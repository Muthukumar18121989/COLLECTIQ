import { reminderNote } from "@/lib/agent/default-policy";
import { type Actor, checkPermission } from "@/lib/agent/permissions";
import { todayISO } from "@/lib/dates";
import { formatMoney, toCents } from "@/lib/money";
import { PayPalApiError } from "@/lib/paypal/client";
import { canonicalState, toPayPalCreatePayload } from "@/lib/paypal/mapper";
import type { PayPalInvoice } from "@/lib/paypal/types";
import { UniqueViolationError } from "@/lib/db/store";
import type { CollectionPolicy, Invoice, InvoiceItem, PolicyStep, ReminderTone } from "@/lib/types";
import { type InvoiceInput, invoiceInputSchema } from "@/lib/validation";
import { type ServiceContext, ServiceError, recordActivity } from "./context";

function paypalErrorMessage(e: unknown) {
  if (e instanceof PayPalApiError) {
    return `${e.message}${e.debugId ? ` (PayPal debug id ${e.debugId})` : ""}`;
  }
  return (e as Error).message ?? String(e);
}

async function defaultPolicy(ctx: ServiceContext): Promise<CollectionPolicy | null> {
  return ctx.db.findOne("collection_policies", { is_default: true });
}

function newInvoiceNumber(now: Date) {
  const rand = Math.floor(Math.random() * 36 ** 3).toString(36).toUpperCase().padStart(3, "0");
  return `CIQ-${now.toISOString().slice(2, 10).replace(/-/g, "")}-${rand}`;
}

function totals(items: InvoiceInput["items"], taxRate: number) {
  const subtotal = items.reduce((s, it) => s + Math.round(it.quantity * toCents(it.unit_amount)), 0);
  const tax = Math.round((subtotal * taxRate) / 100);
  return { subtotal, tax, total: subtotal + tax };
}

async function ensureProject(ctx: ServiceContext, clientId: string, name: string | null | undefined) {
  if (!name) return null;
  const existing = (await ctx.db.list("projects", { client_id: clientId })).find(
    (p) => p.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return existing.id;
  const p = await ctx.db.insert("projects", { client_id: clientId, name, status: "active", is_demo: false });
  return p.id;
}

export async function createInvoiceDraft(
  ctx: ServiceContext,
  raw: unknown,
  opts: { actor: Actor; approved?: boolean; reasoning?: string } = { actor: "user" },
): Promise<Invoice> {
  const parsed = invoiceInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ServiceError(parsed.error.issues[0]?.message ?? "Invalid invoice", 422, "validation", parsed.error.issues);
  }
  const input = parsed.data;
  const profile = await ctx.db.profile();
  const perm = checkPermission({
    op: "create_invoice_draft",
    actor: opts.actor,
    autonomyMode: profile.autonomy_mode,
    agentPaused: profile.agent_paused,
    approved: Boolean(opts.approved),
  });
  if (perm.decision !== "allow") throw new ServiceError(perm.reason, 403, perm.code);

  const client = await ctx.db.get("clients", input.client_id);
  if (!client) throw new ServiceError("Client not found. Add the client first.", 404, "client_missing");

  const policyId = input.policy_id ?? (await defaultPolicy(ctx))?.id ?? null;
  if (input.policy_id && !(await ctx.db.get("collection_policies", input.policy_id))) {
    throw new ServiceError("Collection policy not found", 404, "policy_missing");
  }
  const t = totals(input.items, profile.tax_rate_percent);
  const projectId = await ensureProject(ctx, client.id, input.project_name);

  const invoice = await ctx.db.insert("invoices", {
    client_id: client.id,
    project_id: projectId,
    policy_id: policyId,
    invoice_number: newInvoiceNumber(ctx.now()),
    currency: input.currency as Invoice["currency"],
    issue_date: input.issue_date,
    due_date: input.due_date,
    status: "draft",
    subtotal_cents: t.subtotal,
    tax_cents: t.tax,
    total_cents: t.total,
    amount_paid_cents: 0,
    amount_due_cents: t.total,
    note: input.note ?? null,
    collection_paused: false,
    dispute_open: false,
    paypal_mode: null,
    paypal_invoice_id: null,
    paypal_status: null,
    paypal_recipient_url: null,
    paypal_invoicer_url: null,
    paypal_last_synced_at: null,
    sent_at: null,
    paid_at: null,
    cancelled_at: null,
    is_demo: false,
    created_by: opts.actor === "user" ? "user" : "agent",
  });
  await insertItems(ctx, invoice.id, input.items);
  await recordActivity(ctx, {
    category: "invoice_created",
    invoice_id: invoice.id,
    client_id: client.id,
    trigger: opts.actor === "user" ? "Created manually" : "Created by AI agent (approved by you)",
    reasoning: opts.reasoning ?? null,
    proposed_action: `Draft ${invoice.invoice_number} for ${formatMoney(t.total, invoice.currency)}`,
    permission_result: `${perm.decision}: ${perm.reason}`,
    approval_status: opts.actor === "user" ? "not_required" : "approved",
    execution_status: "succeeded",
  });
  return invoice;
}

async function insertItems(ctx: ServiceContext, invoiceId: string, items: InvoiceInput["items"]) {
  let position = 0;
  for (const it of items) {
    await ctx.db.insert("invoice_items", {
      invoice_id: invoiceId,
      description: it.description,
      quantity: it.quantity,
      unit_amount_cents: toCents(it.unit_amount),
      position: position++,
    });
  }
}

export async function updateDraft(ctx: ServiceContext, id: string, raw: unknown): Promise<Invoice> {
  const invoice = await ctx.db.require("invoices", id);
  if (invoice.status !== "draft" || invoice.paypal_invoice_id) {
    throw new ServiceError("Only unsent drafts can be edited.", 409, "not_editable");
  }
  const parsed = invoiceInputSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError(parsed.error.issues[0]?.message ?? "Invalid invoice", 422, "validation", parsed.error.issues);
  const input = parsed.data;
  const profile = await ctx.db.profile();
  const client = await ctx.db.get("clients", input.client_id);
  if (!client) throw new ServiceError("Client not found", 404, "client_missing");
  const t = totals(input.items, profile.tax_rate_percent);
  for (const it of await ctx.db.list("invoice_items", { invoice_id: id })) await ctx.db.remove("invoice_items", it.id);
  await insertItems(ctx, id, input.items);
  return ctx.db.update("invoices", id, {
    client_id: client.id,
    project_id: await ensureProject(ctx, client.id, input.project_name),
    policy_id: input.policy_id ?? invoice.policy_id,
    currency: input.currency as Invoice["currency"],
    issue_date: input.issue_date,
    due_date: input.due_date,
    note: input.note ?? null,
    subtotal_cents: t.subtotal,
    tax_cents: t.tax,
    total_cents: t.total,
    amount_due_cents: t.total,
  });
}

export async function sendInvoice(
  ctx: ServiceContext,
  id: string,
  opts: { actor: Actor; approved?: boolean },
): Promise<Invoice> {
  let invoice = await ctx.db.require("invoices", id);
  const client = await ctx.db.require("clients", invoice.client_id);
  const profile = await ctx.db.profile();
  const perm = checkPermission({
    op: "send_invoice",
    actor: opts.actor,
    autonomyMode: profile.autonomy_mode,
    agentPaused: profile.agent_paused,
    approved: Boolean(opts.approved),
    invoice,
    client,
  });
  if (perm.decision !== "allow") {
    await recordActivity(ctx, {
      category: "action_blocked",
      invoice_id: id,
      client_id: client.id,
      trigger: opts.actor,
      proposed_action: `Send ${invoice.invoice_number}`,
      permission_result: `${perm.decision}: ${perm.reason}`,
      execution_status: "blocked",
    });
    throw new ServiceError(perm.reason, 403, perm.code);
  }

  const gateway = ctx.gateways.forInvoice(invoice);
  const items: InvoiceItem[] = await ctx.db.list("invoice_items", { invoice_id: id });
  try {
    if (!invoice.paypal_invoice_id) {
      const created = await gateway.create(toPayPalCreatePayload(invoice, items, client, profile.tax_rate_percent), `ciq-create-${invoice.id}`);
      // Persist the PayPal id immediately so a failed send can be retried
      // without creating a duplicate PayPal invoice.
      invoice = await ctx.db.update("invoices", id, {
        paypal_invoice_id: created.id,
        paypal_mode: gateway.mode,
        paypal_status: created.invoice?.status ?? "DRAFT",
      });
    }
    const sent = await gateway.send(invoice.paypal_invoice_id!, { subject: `Invoice ${invoice.invoice_number}`, note: invoice.note ?? undefined }, `ciq-send-${invoice.id}`);

    let pp: PayPalInvoice | null = null;
    try {
      pp = await gateway.fetch(invoice);
    } catch {
      pp = null; // Send succeeded; canonical refresh can happen on next sync.
    }
    const canon = pp ? canonicalState(pp, invoice.total_cents) : null;
    invoice = await ctx.db.update("invoices", id, {
      status: canon && canon.status !== "draft" ? canon.status : "sent",
      paypal_status: canon && canon.status !== "draft" ? canon.paypal_status : "SENT",
      paypal_recipient_url: canon?.recipient_url ?? sent.recipientUrl ?? invoice.paypal_recipient_url,
      paypal_invoicer_url: canon?.invoicer_url ?? invoice.paypal_invoicer_url,
      paypal_last_synced_at: ctx.now().toISOString(),
      sent_at: ctx.now().toISOString(),
    });
    await recordActivity(ctx, {
      category: "invoice_sent",
      invoice_id: id,
      client_id: client.id,
      trigger: opts.actor === "user" ? "You clicked Send" : "Approved agent action",
      proposed_action: `Send ${invoice.invoice_number} (${formatMoney(invoice.total_cents, invoice.currency)}) to ${client.email}`,
      permission_result: `allow: ${perm.reason}`,
      approval_status: opts.actor === "user" ? "not_required" : "approved",
      execution_status: "succeeded",
      paypal_ref: invoice.paypal_invoice_id,
      mode: gateway.mode,
      reasoning: gateway.mode === "demo" ? "DEMO MODE: simulated send. No PayPal API call was made." : null,
    });
    return invoice;
  } catch (e) {
    const msg = paypalErrorMessage(e);
    await recordActivity(ctx, {
      category: "invoice_sent",
      invoice_id: id,
      client_id: client.id,
      trigger: opts.actor,
      proposed_action: `Send ${invoice.invoice_number}`,
      permission_result: `allow: ${perm.reason}`,
      execution_status: "failed",
      paypal_ref: invoice.paypal_invoice_id,
      error: msg,
      mode: gateway.mode,
    });
    throw new ServiceError(`PayPal did not send the invoice: ${msg}`, 502, "paypal_error");
  }
}

/** Apply PayPal's canonical state to the local invoice and log meaningful changes. */
export async function applyCanonical(ctx: ServiceContext, invoice: Invoice, pp: PayPalInvoice, trigger: string, mode: Invoice["paypal_mode"]) {
  const canon = canonicalState(pp, invoice.total_cents);
  const now = ctx.now().toISOString();
  const updated = await ctx.db.update("invoices", invoice.id, {
    status: canon.status,
    paypal_status: canon.paypal_status,
    amount_paid_cents: canon.amount_paid_cents,
    amount_due_cents: canon.amount_due_cents,
    paypal_recipient_url: canon.recipient_url ?? invoice.paypal_recipient_url,
    paypal_invoicer_url: canon.invoicer_url ?? invoice.paypal_invoicer_url,
    paypal_last_synced_at: now,
    paid_at: canon.status === "paid" ? (invoice.paid_at ?? now) : invoice.paid_at,
    cancelled_at: canon.status === "cancelled" ? (invoice.cancelled_at ?? now) : invoice.cancelled_at,
  });
  const paidDelta = canon.amount_paid_cents - invoice.amount_paid_cents;
  if (paidDelta > 0) {
    await recordActivity(ctx, {
      category: "payment_received",
      invoice_id: invoice.id,
      client_id: invoice.client_id,
      trigger,
      observed_condition: `PayPal reports ${formatMoney(canon.amount_paid_cents, invoice.currency)} paid, ${formatMoney(canon.amount_due_cents, invoice.currency)} still due (status ${canon.paypal_status}).`,
      reasoning: canon.fully_settled
        ? "Verified against PayPal's invoice record: no balance outstanding."
        : "Partial payment: balance remains, collection continues.",
      execution_status: "succeeded",
      paypal_ref: invoice.paypal_invoice_id,
      mode: mode ?? "internal",
    });
  } else if (canon.status !== invoice.status) {
    await recordActivity(ctx, {
      category: "payment_status_updated",
      invoice_id: invoice.id,
      client_id: invoice.client_id,
      trigger,
      observed_condition: `Status changed from ${invoice.status} to ${canon.status} (PayPal: ${canon.paypal_status}).`,
      execution_status: "info",
      paypal_ref: invoice.paypal_invoice_id,
      mode: mode ?? "internal",
    });
  }
  if (["paid", "cancelled", "refunded"].includes(canon.status)) {
    await suppressPending(ctx, invoice.id, `Invoice is ${canon.status}`);
  }
  return updated;
}

/** Stop any queued reminders/approvals for an invoice that no longer needs collection. */
export async function suppressPending(ctx: ServiceContext, invoiceId: string, reason: string) {
  let count = 0;
  for (const a of await ctx.db.list("approvals", { invoice_id: invoiceId, status: "pending" })) {
    if (a.kind === "send_reminder" || a.kind === "escalation") {
      await ctx.db.update("approvals", a.id, { status: "expired", decided_at: ctx.now().toISOString(), result: { reason } });
      count++;
    }
  }
  for (const t of await ctx.db.list("agent_tasks", { invoice_id: invoiceId, status: "pending_approval" })) {
    await ctx.db.update("agent_tasks", t.id, { status: "suppressed", error: reason });
    count++;
  }
  if (count > 0) {
    await recordActivity(ctx, {
      category: "action_blocked",
      invoice_id: invoiceId,
      trigger: "Payment status change",
      observed_condition: reason,
      proposed_action: `Suppressed ${count} pending reminder action(s)`,
      execution_status: "info",
    });
  }
  return count;
}

export async function syncInvoice(ctx: ServiceContext, id: string, trigger = "Manual refresh"): Promise<Invoice> {
  const invoice = await ctx.db.require("invoices", id);
  if (!invoice.paypal_invoice_id) throw new ServiceError("This invoice has not been sent to PayPal yet.", 409, "not_sent");
  const gateway = ctx.gateways.forInvoice(invoice);
  try {
    const pp = await gateway.fetch(invoice);
    return await applyCanonical(ctx, invoice, pp, trigger, gateway.mode);
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError(`Could not retrieve invoice from PayPal: ${paypalErrorMessage(e)}`, 502, "paypal_error");
  }
}

export interface RemindOptions {
  actor: Actor;
  approved?: boolean;
  tone?: ReminderTone;
  note?: string;
  policy?: CollectionPolicy | null;
  step?: PolicyStep | null;
  /** When set, the caller owns the agent_task row (scheduler / approval). */
  taskId?: string;
  trigger: string;
  reasoning?: string;
}

export type RemindOutcome =
  | { outcome: "sent"; invoice: Invoice; mode: string }
  | { outcome: "suppressed"; invoice: Invoice; reason: string };

/**
 * Send a payment reminder through PayPal. Always re-checks permission and the
 * latest PayPal status immediately before executing.
 */
export async function remindInvoice(ctx: ServiceContext, id: string, opts: RemindOptions): Promise<RemindOutcome> {
  let invoice = await ctx.db.require("invoices", id);
  const client = await ctx.db.require("clients", invoice.client_id);
  const profile = await ctx.db.profile();
  const op = opts.step?.action === "escalation" ? "escalation" : "send_reminder";
  const permCtx = {
    op,
    actor: opts.actor,
    autonomyMode: profile.autonomy_mode,
    agentPaused: profile.agent_paused,
    approved: Boolean(opts.approved),
    client,
    policy: opts.policy ?? null,
    step: opts.step ?? null,
  } as const;

  let perm = checkPermission({ ...permCtx, invoice });
  if (perm.decision !== "allow") {
    await recordActivity(ctx, {
      category: "action_blocked",
      invoice_id: id,
      client_id: client.id,
      trigger: opts.trigger,
      proposed_action: `Send reminder for ${invoice.invoice_number}`,
      permission_result: `${perm.decision}: ${perm.reason}`,
      execution_status: "blocked",
    });
    throw new ServiceError(perm.reason, 403, perm.code);
  }
  if (!invoice.paypal_invoice_id) throw new ServiceError("Send the invoice before sending reminders.", 409, "not_sent");

  // Manual reminders: at most one per invoice per day (duplicate prevention).
  let taskId = opts.taskId;
  if (!taskId) {
    const key = `${opts.actor}:invoice:${id}:reminder:${todayISO(ctx.now())}`;
    try {
      const t = await ctx.db.insert("agent_tasks", {
        invoice_id: id,
        kind: "reminder",
        step_id: null,
        idempotency_key: key,
        status: "executing",
        trigger: opts.actor === "user" ? "user" : "chat",
        scheduled_for: null,
        executed_at: null,
        paypal_ref: null,
        error: null,
      });
      taskId = t.id;
    } catch (e) {
      if (e instanceof UniqueViolationError) {
        throw new ServiceError("A reminder for this invoice was already sent today.", 409, "duplicate_reminder");
      }
      throw e;
    }
  }

  const gateway = ctx.gateways.forInvoice(invoice);
  try {
    // 1. Refresh canonical status from PayPal before acting.
    const pp = await gateway.fetch(invoice);
    invoice = await applyCanonical(ctx, invoice, pp, "Pre-reminder status check", gateway.mode);
    perm = checkPermission({ ...permCtx, invoice });
    if (perm.decision !== "allow") {
      await ctx.db.update("agent_tasks", taskId, { status: "suppressed", error: perm.reason, executed_at: ctx.now().toISOString() });
      await recordActivity(ctx, {
        category: "action_blocked",
        invoice_id: id,
        client_id: client.id,
        trigger: opts.trigger,
        observed_condition: `Latest PayPal status: ${invoice.paypal_status}`,
        proposed_action: `Reminder for ${invoice.invoice_number}`,
        permission_result: `${perm.decision}: ${perm.reason}`,
        execution_status: "blocked",
        paypal_ref: invoice.paypal_invoice_id,
        mode: gateway.mode,
      });
      return { outcome: "suppressed", invoice, reason: perm.reason };
    }

    // 2. Send the reminder (idempotent per task).
    const tone = opts.tone ?? opts.step?.tone ?? "friendly";
    const note =
      opts.note ??
      reminderNote(tone, client.name, formatMoney(invoice.amount_due_cents, invoice.currency), invoice.due_date);
    await gateway.remind(invoice.paypal_invoice_id!, { subject: `Reminder: invoice ${invoice.invoice_number}`, note }, `ciq-remind-${taskId}`);
    await ctx.db.update("agent_tasks", taskId, {
      status: "succeeded",
      executed_at: ctx.now().toISOString(),
      paypal_ref: invoice.paypal_invoice_id,
      error: null,
    });
    await recordActivity(ctx, {
      category: "reminder_sent",
      invoice_id: id,
      client_id: client.id,
      trigger: opts.trigger,
      observed_condition: `${formatMoney(invoice.amount_due_cents, invoice.currency)} due ${invoice.due_date}; PayPal status ${invoice.paypal_status}.`,
      reasoning: [opts.reasoning, gateway.mode === "demo" ? "DEMO MODE: simulated reminder. No PayPal API call was made." : null]
        .filter(Boolean)
        .join(" ") || null,
      proposed_action: `${tone[0].toUpperCase()}${tone.slice(1)} reminder: "${note.slice(0, 160)}${note.length > 160 ? "…" : ""}"`,
      permission_result: `allow: ${perm.reason}`,
      approval_status: opts.approved ? "approved" : "not_required",
      execution_status: "succeeded",
      paypal_ref: invoice.paypal_invoice_id,
      mode: gateway.mode,
    });
    return { outcome: "sent", invoice, mode: gateway.mode };
  } catch (e) {
    const msg = paypalErrorMessage(e);
    await ctx.db.update("agent_tasks", taskId, { status: "failed", error: msg, executed_at: ctx.now().toISOString() });
    await recordActivity(ctx, {
      category: "reminder_sent",
      invoice_id: id,
      client_id: client.id,
      trigger: opts.trigger,
      proposed_action: `Reminder for ${invoice.invoice_number}`,
      permission_result: `allow: ${perm.reason}`,
      execution_status: "failed",
      error: msg,
      paypal_ref: invoice.paypal_invoice_id,
      mode: gateway.mode,
    });
    throw new ServiceError(`Reminder was not sent: ${msg}`, 502, "paypal_error");
  }
}

export async function cancelInvoice(
  ctx: ServiceContext,
  id: string,
  opts: { actor: Actor; approved?: boolean; reason?: string },
): Promise<Invoice> {
  const invoice = await ctx.db.require("invoices", id);
  const client = await ctx.db.get("clients", invoice.client_id);
  const profile = await ctx.db.profile();
  const perm = checkPermission({
    op: "cancel_invoice",
    actor: opts.actor,
    autonomyMode: profile.autonomy_mode,
    agentPaused: profile.agent_paused,
    approved: Boolean(opts.approved),
    invoice,
    client,
  });
  if (perm.decision !== "allow") throw new ServiceError(perm.reason, 403, perm.code);

  let mode: Invoice["paypal_mode"] = invoice.paypal_mode;
  if (invoice.paypal_invoice_id) {
    const gateway = ctx.gateways.forInvoice(invoice);
    mode = gateway.mode;
    try {
      if (invoice.paypal_status && invoice.paypal_status !== "DRAFT") {
        await gateway.cancel(invoice.paypal_invoice_id, { subject: `Invoice ${invoice.invoice_number} cancelled`, note: opts.reason }, `ciq-cancel-${invoice.id}`);
      }
    } catch (e) {
      const msg = paypalErrorMessage(e);
      await recordActivity(ctx, {
        category: "invoice_cancelled",
        invoice_id: id,
        client_id: invoice.client_id,
        trigger: opts.actor,
        execution_status: "failed",
        error: msg,
        paypal_ref: invoice.paypal_invoice_id,
        mode: gateway.mode,
      });
      throw new ServiceError(`PayPal did not cancel the invoice: ${msg}`, 502, "paypal_error");
    }
  }
  const updated = await ctx.db.update("invoices", id, {
    status: "cancelled",
    paypal_status: invoice.paypal_invoice_id ? "CANCELLED" : invoice.paypal_status,
    amount_due_cents: 0,
    cancelled_at: ctx.now().toISOString(),
  });
  await suppressPending(ctx, id, "Invoice cancelled");
  await recordActivity(ctx, {
    category: "invoice_cancelled",
    invoice_id: id,
    client_id: invoice.client_id,
    trigger: opts.actor === "user" ? "You cancelled it" : "Approved agent action",
    reasoning: opts.reason ?? null,
    permission_result: `allow: ${perm.reason}`,
    execution_status: "succeeded",
    paypal_ref: invoice.paypal_invoice_id,
    mode: mode ?? "internal",
  });
  return updated;
}
