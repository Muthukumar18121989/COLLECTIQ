import { ArrowLeft, Mail, Phone, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompactActivity } from "@/components/activity-feed";
import { ClientCollectionControls } from "@/components/client-forms";
import { InvoiceStatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { formatDate, todayISO } from "@/lib/dates";
import { effectiveStatus, isOpen } from "@/lib/metrics";
import { formatMoney } from "@/lib/money";
import { getSession } from "@/lib/server";

export const metadata: Metadata = { title: "Client" };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return null;
  const { ctx } = session;
  const { id } = await params;
  const client = await ctx.db.get("clients", id);
  if (!client) notFound();
  const [invoices, projects, activity, policies] = await Promise.all([
    ctx.db.list("invoices", { client_id: id }, { orderBy: "issue_date", ascending: false }),
    ctx.db.list("projects", { client_id: id }),
    ctx.db.list("agent_activity", { client_id: id }, { orderBy: "created_at", ascending: false }),
    ctx.db.list("collection_policies"),
  ]);
  const today = todayISO();
  const m = (c: number) => formatMoney(c, client.currency);
  const billed = invoices.filter((i) => i.currency === client.currency && !["draft", "cancelled"].includes(i.status));
  const totals = {
    invoiced: billed.reduce((s, i) => s + i.total_cents, 0),
    collected: billed.reduce((s, i) => s + i.amount_paid_cents, 0),
    outstanding: billed.filter(isOpen).reduce((s, i) => s + i.amount_due_cents, 0),
    overdue: billed.filter((i) => isOpen(i) && i.due_date < today).reduce((s, i) => s + i.amount_due_cents, 0),
  };
  const payments = activity.filter((a) => a.category === "payment_received");
  const comms = activity.filter((a) => ["invoice_sent", "reminder_sent", "invoice_cancelled"].includes(a.category) && a.execution_status === "succeeded");
  const numbers = new Map(invoices.map((i) => [i.id, i.invoice_number]));
  const policyIds = new Set(invoices.map((i) => i.policy_id).filter(Boolean));

  return (
    <>
      <Link href="/clients" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Clients
      </Link>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{client.name}</h1>
            {client.is_demo && <Badge tone="warning">Demo data</Badge>}
            {client.dispute_open ? <Badge tone="danger">Dispute recorded</Badge> : client.collection_paused ? <Badge tone="warning">Reminders paused</Badge> : null}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {client.company && <span>{client.company}</span>}
            <span className="inline-flex items-center gap-1">
              <Mail className="size-3.5" /> {client.email}
            </span>
            {client.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3.5" /> {client.phone}
              </span>
            )}
            <span>Bills in {client.currency}</span>
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <Button asChild>
            <Link href={`/invoices/new?client=${client.id}`}>
              <Plus /> New invoice
            </Link>
          </Button>
          <ClientCollectionControls id={client.id} paused={client.collection_paused} disputeOpen={client.dispute_open} disputeNote={client.dispute_note} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Total invoiced", m(totals.invoiced), ""],
          ["Total collected", m(totals.collected), "text-success"],
          ["Outstanding", m(totals.outstanding), ""],
          ["Overdue", m(totals.overdue), totals.overdue > 0 ? "text-danger" : ""],
        ].map(([l, v, cls]) => (
          <Card key={l} className="p-4">
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className={`mt-1 text-lg font-semibold tabular ${cls}`}>{v}</p>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Invoices</CardTitle>
              <CardDescription>
                {projects.filter((p) => p.status === "active").length} active project(s): {projects.map((p) => p.name).join(", ") || "none"}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No invoices for this client yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {invoices.map((i) => (
                  <li key={i.id}>
                    <Link href={`/invoices/${i.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
                      <div>
                        <p className="text-[13px] font-medium">{i.invoice_number}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Issued {formatDate(i.issue_date)} · due {formatDate(i.due_date)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] tabular">{formatMoney(i.total_cents, i.currency)}</span>
                        <InvoiceStatusBadge status={effectiveStatus(i, today)} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Collection policies</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {policies.filter((p) => policyIds.has(p.id)).map((p) => (
                <p key={p.id}>
                  {p.name} · {p.status}
                </p>
              ))}
              {policyIds.size === 0 && <p>No policies applied yet.</p>}
              {client.dispute_open && <p className="mt-2 text-danger">Collection stopped: {client.dispute_note ?? "dispute recorded"}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Payment history</CardTitle>
                <CardDescription>Recorded payments only</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <CompactActivity items={payments} invoiceNumbers={numbers} />
            </CardContent>
          </Card>
        </div>
      </div>
      <Card className="mt-4">
        <CardHeader>
          <div>
            <CardTitle>Communication history</CardTitle>
            <CardDescription>Invoices and reminders sent to this client</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <CompactActivity items={comms} invoiceNumbers={numbers} />
        </CardContent>
      </Card>
    </>
  );
}
