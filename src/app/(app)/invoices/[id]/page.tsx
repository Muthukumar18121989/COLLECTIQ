import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompactActivity } from "@/components/activity-feed";
import { ApprovalCard } from "@/components/approval-card";
import { InvoiceActions } from "@/components/invoice-actions";
import { InvoiceStatusBadge, PayPalModeBadge } from "@/components/status";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { evaluateInvoice } from "@/lib/agent/policy-engine";
import { formatDate, formatDateTime, todayISO } from "@/lib/dates";
import { integrationModes } from "@/lib/env";
import { effectiveStatus } from "@/lib/metrics";
import { formatMoney } from "@/lib/money";
import { getSession } from "@/lib/server";

export const metadata: Metadata = { title: "Invoice" };

const TASK_LABEL: Record<string, string> = {
  pending_approval: "Awaiting approval",
  executing: "Running",
  succeeded: "Done",
  failed: "Failed",
  blocked: "Blocked",
  suppressed: "Suppressed",
  skipped: "Skipped",
};

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return null;
  const { ctx } = session;
  const { id } = await params;
  const invoice = await ctx.db.get("invoices", id);
  if (!invoice) notFound();
  const [client, items, activity, tasks, approvals, policies, project] = await Promise.all([
    ctx.db.get("clients", invoice.client_id),
    ctx.db.list("invoice_items", { invoice_id: id }, { orderBy: "position" }),
    ctx.db.list("agent_activity", { invoice_id: id }, { orderBy: "created_at", ascending: false }),
    ctx.db.list("agent_tasks", { invoice_id: id }, { orderBy: "created_at", ascending: false }),
    ctx.db.list("approvals", { invoice_id: id, status: "pending" }),
    ctx.db.list("collection_policies"),
    invoice.project_id ? ctx.db.get("projects", invoice.project_id) : Promise.resolve(null),
  ]);
  const today = todayISO();
  const status = effectiveStatus(invoice, today);
  const policy = policies.find((p) => p.id === invoice.policy_id) ?? null;
  const next = evaluateInvoice({ invoice, policy, tasks });
  const m = (c: number) => formatMoney(c, invoice.currency);
  const modes = integrationModes();
  const sendMode = invoice.paypal_mode ?? (modes.paypal === "demo" ? "demo" : modes.paypal);

  return (
    <>
      <Link href="/invoices" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Invoices
      </Link>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{invoice.invoice_number}</h1>
            <InvoiceStatusBadge status={status} />
            <PayPalModeBadge mode={invoice.paypal_mode} />
            {invoice.is_demo && <Badge tone="warning">Demo data</Badge>}
            {(invoice.collection_paused || client?.collection_paused) && <Badge tone="warning">Reminders paused</Badge>}
            {client?.dispute_open && <Badge tone="danger">Dispute recorded</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {client?.name} · {m(invoice.total_cents)} · due {formatDate(invoice.due_date)}
          </p>
        </div>
        <InvoiceActions
          id={invoice.id}
          status={status}
          paypalMode={invoice.paypal_mode}
          hasPayPalId={Boolean(invoice.paypal_invoice_id)}
          paused={invoice.collection_paused}
          sendMode={sendMode}
          dueLabel={m(invoice.amount_due_cents)}
          clientEmail={client?.email ?? ""}
        />
      </div>

      {approvals.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {approvals.map((a) => (
            <ApprovalCard key={a.id} approval={a} />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardContent className="pt-5">
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Bill to</p>
                  {client ? (
                    <Link href={`/clients/${client.id}`} className="mt-1 block text-sm font-medium hover:underline">
                      {client.name}
                    </Link>
                  ) : null}
                  <p className="text-xs text-muted-foreground">{client?.company}</p>
                  <p className="text-xs text-muted-foreground">{client?.email}</p>
                </div>
                <dl className="grid grid-cols-2 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Issued</dt>
                  <dd>{formatDate(invoice.issue_date)}</dd>
                  <dt className="text-muted-foreground">Due</dt>
                  <dd>{formatDate(invoice.due_date)}</dd>
                  <dt className="text-muted-foreground">Project</dt>
                  <dd>{project?.name ?? "—"}</dd>
                  <dt className="text-muted-foreground">Currency</dt>
                  <dd>{invoice.currency}</dd>
                </dl>
              </div>
              <table className="mt-6 w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Item</th>
                    <th className="pb-2 text-right font-medium">Qty</th>
                    <th className="pb-2 text-right font-medium">Unit</th>
                    <th className="pb-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-b border-border">
                      <td className="py-2.5">{it.description}</td>
                      <td className="py-2.5 text-right tabular">{it.quantity}</td>
                      <td className="py-2.5 text-right tabular">{m(it.unit_amount_cents)}</td>
                      <td className="py-2.5 text-right tabular">{m(Math.round(it.quantity * it.unit_amount_cents))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="ml-auto mt-4 w-full max-w-xs space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular">{m(invoice.subtotal_cents)}</dd>
                </div>
                {invoice.tax_cents > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Tax</dt>
                    <dd className="tabular">{m(invoice.tax_cents)}</dd>
                  </div>
                )}
                <div className="flex justify-between font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular">{m(invoice.total_cents)}</dd>
                </div>
                <div className="flex justify-between text-success">
                  <dt>Paid</dt>
                  <dd className="tabular">{m(invoice.amount_paid_cents)}</dd>
                </div>
                <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                  <dt>Balance due</dt>
                  <dd className="tabular">{m(invoice.amount_due_cents)}</dd>
                </div>
              </dl>
              {invoice.note && <p className="mt-4 rounded-[10px] bg-muted px-3 py-2 text-xs text-muted-foreground">{invoice.note}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Activity timeline</CardTitle>
                <CardDescription>Everything that happened to this invoice, newest first</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <CompactActivity items={activity} invoiceNumbers={new Map()} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>PayPal</CardTitle>
              <PayPalModeBadge mode={invoice.paypal_mode} />
            </CardHeader>
            <CardContent>
              {invoice.paypal_invoice_id ? (
                <dl className="space-y-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">{invoice.paypal_mode === "demo" ? "Demo reference (not a PayPal ID)" : "PayPal invoice ID"}</dt>
                    <dd className="mt-0.5 break-all font-mono">{invoice.paypal_invoice_id}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{invoice.paypal_mode === "demo" ? "Simulated status" : "PayPal status"}</dt>
                    <dd className="mt-0.5 font-mono">{invoice.paypal_status ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Last synced</dt>
                    <dd className="mt-0.5">{formatDateTime(invoice.paypal_last_synced_at)}</dd>
                  </div>
                  {invoice.paypal_recipient_url && (
                    <a href={invoice.paypal_recipient_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                      Client payment page <ExternalLink className="size-3" />
                    </a>
                  )}
                  {invoice.paypal_invoicer_url && (
                    <a href={invoice.paypal_invoicer_url} target="_blank" rel="noreferrer" className="ml-3 inline-flex items-center gap-1 font-medium text-primary hover:underline">
                      Open in PayPal <ExternalLink className="size-3" />
                    </a>
                  )}
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">Not created in PayPal yet. Sending creates the PayPal invoice and emails it to the client.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Collection</CardTitle>
                <CardDescription>{policy ? `${policy.name}${policy.status === "paused" ? " (paused)" : ""}` : "No policy assigned"}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-[10px] bg-muted px-3 py-2 text-xs">
                <span className="font-medium">Next step: </span>
                {next.action === "none" ? next.reason : `${next.step?.label} (${next.reason})`}
              </div>
              <p className="mt-4 mb-2 text-xs font-medium text-muted-foreground">Agent collection history</p>
              {tasks.length === 0 ? (
                <p className="text-xs text-muted-foreground">No collection actions yet.</p>
              ) : (
                <ul className="space-y-2">
                  {tasks.map((t) => (
                    <li key={t.id} className="flex items-start justify-between gap-2 text-xs">
                      <div>
                        <p className="font-medium capitalize">{t.kind.replace("_", " ")}{t.step_id ? ` · ${t.step_id.replace(/_/g, " ")}` : ""}</p>
                        <p className="text-muted-foreground">{formatDateTime(t.executed_at ?? t.created_at)} · {t.trigger}</p>
                        {t.error && <p className="text-danger">{t.error}</p>}
                      </div>
                      <Badge tone={t.status === "succeeded" ? "success" : t.status === "failed" || t.status === "blocked" ? "danger" : t.status === "pending_approval" ? "warning" : "neutral"}>
                        {TASK_LABEL[t.status]}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
