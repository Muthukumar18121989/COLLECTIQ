import { AlertTriangle, ArrowRight, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CompactActivity } from "@/components/activity-feed";
import { ApprovalCard } from "@/components/approval-card";
import { AgingChart, ReceivablesChart } from "@/components/charts";
import { InvoiceStatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";
import { addDays, formatDate, todayISO } from "@/lib/dates";
import { AGING_LABELS, type AgingBucket, computeSummary, effectiveStatus, factualSummary } from "@/lib/metrics";
import { formatMoney } from "@/lib/money";
import { getSession } from "@/lib/server";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const session = await getSession();
  if (!session) return null;
  const { ctx, profile } = session;
  const [invoices, clients, activity, approvals] = await Promise.all([
    ctx.db.list("invoices"),
    ctx.db.list("clients"),
    ctx.db.list("agent_activity", undefined, { orderBy: "created_at", ascending: false, limit: 40 }),
    ctx.db.list("approvals", { status: "pending" }, { orderBy: "created_at", ascending: false }),
  ]);
  const cur = profile.default_currency;
  const s = computeSummary(invoices, clients, new Date(), cur);
  const f = (c: number) => formatMoney(c, cur);
  const today = todayISO();
  const invoiceNumbers = new Map(invoices.map((i) => [i.id, i.invoice_number]));
  const clientNames = new Map(clients.map((c) => [c.id, c.name]));
  const attention = invoices
    .filter((i) => effectiveStatus(i, today) === "overdue" || i.status === "partially_paid")
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 5);
  const recentInvoices = [...invoices].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6);
  const weekAgo = `${addDays(today, -7)}T00:00:00.000Z`;
  const week = activity.filter((a) => a.created_at >= weekAgo);
  const otherCurrencies = new Set(invoices.filter((i) => i.currency !== cur).map((i) => i.currency));

  const kpis = [
    { label: "Outstanding", value: f(s.outstandingCents), sub: `${s.outstandingCount} open invoice${s.outstandingCount === 1 ? "" : "s"}` },
    { label: "Overdue", value: f(s.overdueCents), sub: `${s.overdueCount} invoice${s.overdueCount === 1 ? "" : "s"}`, tone: s.overdueCents > 0 ? "text-danger" : "" },
    { label: "Collected this month", value: f(s.collectedThisMonthCents), sub: "From recorded payments" },
    { label: "Expected next 30 days", value: f(s.expectedNext30Cents), sub: "By due date · not confirmed" },
    { label: "Collection rate", value: s.collectionRate == null ? "—" : `${Math.round(s.collectionRate * 100)}%`, sub: "Of matured invoice value" },
    { label: "Active clients", value: String(s.activeClients), sub: "With open balances" },
  ];

  return (
    <>
      <PageHeader
        title={`Good to see you${profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}`}
        description="Your receivables, computed from your invoice records."
        actions={
          <>
            {s.hasDemoData && <Badge tone="warning">Includes demo data</Badge>}
            <Button asChild variant="outline">
              <Link href="/invoices/new">New invoice</Link>
            </Button>
            <Button asChild>
              <Link href="/command">
                <Sparkles /> Ask agent
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.label} className="p-4">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className={`mt-1.5 text-xl font-semibold tracking-tight tabular ${k.tone ?? ""}`}>{k.value}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{k.sub}</p>
          </Card>
        ))}
      </div>
      {otherCurrencies.size > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">Totals are in {cur}. Invoices in {[...otherCurrencies].join(", ")} are not converted and are excluded.</p>
      )}

      <Card className="mt-4 border-primary/25 bg-primary-soft/40">
        <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center">
          <Sparkles className="size-5 shrink-0 text-primary" />
          <p className="flex-1 text-sm leading-relaxed">{factualSummary(s, f)}</p>
          <Button asChild variant="ghost" size="sm" className="shrink-0">
            <Link href="/insights">
              Insights <ArrowRight />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Receivables</CardTitle>
              <CardDescription>Invoiced vs collected, last 6 months ({cur})</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ReceivablesChart data={s.monthly} currency={cur} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Invoice aging</CardTitle>
              <CardDescription>Open balance by days past due</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <AgingChart
              currency={cur}
              data={(Object.keys(AGING_LABELS) as AgingBucket[]).map((k) => ({ label: AGING_LABELS[k], cents: s.aging[k].cents, count: s.aging[k].count }))}
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" id="approvals">
          <CardHeader>
            <div>
              <CardTitle>Pending approvals</CardTitle>
              <CardDescription>Actions your agent prepared and is waiting on you for</CardDescription>
            </div>
            {approvals.length > 0 && <Badge tone="warning">{approvals.length}</Badge>}
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {approvals.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Nothing needs your approval right now.</p>
            ) : (
              approvals.slice(0, 4).map((a) => <ApprovalCard key={a.id} approval={a} compact />)
            )}
            {approvals.length > 4 && (
              <Link href="/autopilot#approvals" className="text-xs font-medium text-primary hover:underline">
                View all {approvals.length} →
              </Link>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Needs attention</CardTitle>
              <CardDescription>Overdue or partially paid</CardDescription>
            </div>
            <AlertTriangle className="size-4 text-warning" />
          </CardHeader>
          <CardContent>
            {attention.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Nothing overdue. Nice.</p>
            ) : (
              <ul className="divide-y divide-border">
                {attention.map((i) => (
                  <li key={i.id}>
                    <Link href={`/invoices/${i.id}`} className="flex items-center justify-between gap-2 py-2.5 hover:opacity-80">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">{clientNames.get(i.client_id)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {i.invoice_number} · due {formatDate(i.due_date)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[13px] font-semibold tabular">{formatMoney(i.amount_due_cents, i.currency)}</p>
                        <InvoiceStatusBadge status={effectiveStatus(i, today)} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent invoices</CardTitle>
              <CardDescription>Latest changes</CardDescription>
            </div>
            <Link href="/invoices" className="text-xs font-medium text-primary hover:underline">
              All invoices
            </Link>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {recentInvoices.map((i) => (
                <li key={i.id}>
                  <Link href={`/invoices/${i.id}`} className="flex items-center justify-between gap-2 py-2.5 hover:opacity-80">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">
                        {i.invoice_number} · {clientNames.get(i.client_id)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">Due {formatDate(i.due_date)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] tabular">{formatMoney(i.total_cents, i.currency)}</span>
                      <InvoiceStatusBadge status={effectiveStatus(i, today)} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Agent activity</CardTitle>
              <CardDescription>
                Last 7 days: {week.filter((a) => a.category === "reminder_sent" && a.execution_status === "succeeded").length} reminders sent ·{" "}
                {week.filter((a) => a.execution_status === "approval_required").length} prepared for approval · {week.filter((a) => a.execution_status === "blocked").length} blocked
              </CardDescription>
            </div>
            <Link href="/activity" className="text-xs font-medium text-primary hover:underline">
              Full log
            </Link>
          </CardHeader>
          <CardContent>
            <CompactActivity items={activity.slice(0, 6)} invoiceNumbers={invoiceNumbers} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
