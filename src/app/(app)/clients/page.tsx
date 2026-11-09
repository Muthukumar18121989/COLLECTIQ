import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AddClientDialog } from "@/components/client-forms";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { todayISO } from "@/lib/dates";
import { isOpen } from "@/lib/metrics";
import { formatMoney } from "@/lib/money";
import { getSession } from "@/lib/server";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session) return null;
  const { ctx, profile } = session;
  const { q } = await searchParams;
  const [clients, invoices, projects] = await Promise.all([ctx.db.list("clients", undefined, { orderBy: "name" }), ctx.db.list("invoices"), ctx.db.list("projects")]);
  const today = todayISO();
  const query = (q ?? "").toLowerCase();
  const rows = clients
    .filter((c) => !query || [c.name, c.email, c.company ?? ""].some((s) => s.toLowerCase().includes(query)))
    .map((c) => {
      const inv = invoices.filter((i) => i.client_id === c.id && i.currency === c.currency && !["draft", "cancelled"].includes(i.status));
      return {
        c,
        invoiced: inv.reduce((s, i) => s + i.total_cents, 0),
        collected: inv.reduce((s, i) => s + i.amount_paid_cents, 0),
        outstanding: inv.filter(isOpen).reduce((s, i) => s + i.amount_due_cents, 0),
        overdue: inv.filter((i) => isOpen(i) && i.due_date < today).reduce((s, i) => s + i.amount_due_cents, 0),
        projects: projects.filter((p) => p.client_id === c.id && p.status === "active").length,
      };
    });

  return (
    <>
      <PageHeader title="Clients" description="Balances are computed from each client's invoices in their billing currency." actions={<AddClientDialog defaultCurrency={profile.default_currency} />} />
      <form className="mb-3 max-w-sm">
        <input name="q" defaultValue={q} placeholder="Search clients" aria-label="Search clients" className="h-9 w-full rounded-[10px] border border-border bg-card px-3 text-sm" />
      </form>
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Users />} title={query ? "No clients match" : "No clients yet"} description="Add the people and companies you bill." />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Client</th>
                <th className="px-4 py-2.5 font-medium">Active projects</th>
                <th className="px-4 py-2.5 text-right font-medium">Invoiced</th>
                <th className="px-4 py-2.5 text-right font-medium">Collected</th>
                <th className="px-4 py-2.5 text-right font-medium">Outstanding</th>
                <th className="px-4 py-2.5 text-right font-medium">Overdue</th>
                <th className="px-4 py-2.5 font-medium">Collection</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, invoiced, collected, outstanding, overdue, projects: pc }) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link href={`/clients/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{c.company ? `${c.company} · ` : ""}{c.email}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{pc}</td>
                  <td className="px-4 py-3 text-right tabular">{formatMoney(invoiced, c.currency)}</td>
                  <td className="px-4 py-3 text-right tabular text-success">{formatMoney(collected, c.currency)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular">{formatMoney(outstanding, c.currency)}</td>
                  <td className={`px-4 py-3 text-right tabular ${overdue > 0 ? "text-danger" : "text-muted-foreground"}`}>{formatMoney(overdue, c.currency)}</td>
                  <td className="px-4 py-3">
                    {c.dispute_open ? <Badge tone="danger">Dispute</Badge> : c.collection_paused ? <Badge tone="warning">Paused</Badge> : <Badge tone="success">Active</Badge>}
                    {c.is_demo && <Badge tone="neutral" className="ml-1">Demo</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
