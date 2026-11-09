import type { Metadata } from "next";
import Link from "next/link";
import { AiSummary } from "@/components/ai-summary";
import { AgingChart, ClientContributionChart, ReceivablesChart } from "@/components/charts";
import { InvoiceStatusBadge } from "@/components/status";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";
import { daysBetween, formatDate, todayISO } from "@/lib/dates";
import { integrationModes } from "@/lib/env";
import { AGING_LABELS, type AgingBucket, computeSummary, effectiveStatus, factualSummary } from "@/lib/metrics";
import { formatMoney } from "@/lib/money";
import { getSession } from "@/lib/server";

export const metadata: Metadata = { title: "Insights" };

export default async function InsightsPage() {
  const session = await getSession();
  if (!session) return null;
  const { ctx, profile } = session;
  const [invoices, clients] = await Promise.all([ctx.db.list("invoices"), ctx.db.list("clients")]);
  const cur = profile.default_currency;
  const s = computeSummary(invoices, clients, new Date(), cur);
  const f = (c: number) => formatMoney(c, cur);
  const today = todayISO();
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const collected6m = s.monthly.reduce((a, m) => a + m.collected, 0);

  return (
    <>
      <PageHeader
        title="Cash-flow Intelligence"
        description="Every figure is calculated from stored invoices and recorded payments."
        actions={s.hasDemoData ? <Badge tone="warning">Includes demo data</Badge> : undefined}
      />
      <Card className="mb-4">
        <CardContent className="pt-4">
          <AiSummary initial={factualSummary(s, f)} engine={integrationModes().ai} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Collected (6 months)", f(collected6m), "Confirmed payments"],
          ["Outstanding receivables", f(s.outstandingCents), `${s.outstandingCount} open invoices`],
          ["Overdue balances", f(s.overdueCents), `${s.overdueCount} invoices`],
          ["Due in next 30 days", f(s.expectedNext30Cents), "Estimated by due date"],
        ].map(([l, v, sub]) => (
          <Card key={l} className="p-4">
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className="mt-1 text-lg font-semibold tabular">{v}</p>
            <p className="text-[11px] text-muted-foreground">{sub}</p>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Monthly collections</CardTitle>
              <CardDescription>Invoiced vs collected ({cur})</CardDescription>
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
            <AgingChart currency={cur} data={(Object.keys(AGING_LABELS) as AgingBucket[]).map((k) => ({ label: AGING_LABELS[k], cents: s.aging[k].cents, count: s.aging[k].count }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Client contribution</CardTitle>
              <CardDescription>Collected and outstanding per client</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {s.byClient.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">No issued invoices yet.</p>
            ) : (
              <ClientContributionChart currency={cur} data={s.byClient.map((c) => ({ name: c.name, collected: c.collected, outstanding: c.outstanding }))} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Upcoming due dates</CardTitle>
              <CardDescription>Scheduled due dates of open invoices. These are not confirmed payment dates.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {s.upcoming.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">No upcoming due dates.</p>
            ) : (
              <ul className="divide-y divide-border">
                {s.upcoming.slice(0, 8).map((i) => (
                  <li key={i.id}>
                    <Link href={`/invoices/${i.id}`} className="flex items-center justify-between gap-2 py-2.5 hover:opacity-80">
                      <div>
                        <p className="text-[13px] font-medium">{names.get(i.client_id)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {i.invoice_number} · {formatDate(i.due_date)} · in {daysBetween(today, i.due_date)} day(s)
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] tabular">{formatMoney(i.amount_due_cents, i.currency)}</span>
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
    </>
  );
}
