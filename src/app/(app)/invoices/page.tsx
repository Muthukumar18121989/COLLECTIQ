import { FileText, Plus, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { InvoiceGrid, type InvoiceRow } from "@/components/invoice-grid";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { todayISO } from "@/lib/dates";
import { effectiveStatus } from "@/lib/metrics";
import { getSession } from "@/lib/server";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await getSession();
  if (!session) return null;
  const { ctx } = session;
  const { status } = await searchParams;
  const [invoices, clients, projects, policies] = await Promise.all([
    ctx.db.list("invoices", undefined, { orderBy: "created_at", ascending: false }),
    ctx.db.list("clients"),
    ctx.db.list("projects"),
    ctx.db.list("collection_policies"),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const policyName = new Map(policies.map((p) => [p.id, `${p.name}${p.status === "paused" ? " (paused)" : ""}`]));
  const today = todayISO();
  const rows: InvoiceRow[] = invoices.map((i) => ({
    id: i.id,
    number: i.invoice_number,
    client: clientName.get(i.client_id)?.name ?? "Unknown",
    clientId: i.client_id,
    project: (i.project_id && projectName.get(i.project_id)) || "—",
    totalCents: i.total_cents,
    dueCents: i.amount_due_cents,
    currency: i.currency,
    issueDate: i.issue_date,
    dueDate: i.due_date,
    status: effectiveStatus(i, today),
    policy: (i.policy_id && policyName.get(i.policy_id)) || "None",
    paused: i.collection_paused || Boolean(clientName.get(i.client_id)?.collection_paused),
    paypalMode: i.paypal_mode,
    isDemo: i.is_demo,
  }));

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Every invoice, its PayPal status and its collection policy."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/command?q=Create%20an%20invoice%20for%20">
                <Sparkles /> Create with AI
              </Link>
            </Button>
            <Button asChild>
              <Link href="/invoices/new">
                <Plus /> New invoice
              </Link>
            </Button>
          </>
        }
      />
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText />}
            title="No invoices yet"
            description={clients.length === 0 ? "Add a client first, then create your first invoice." : "Create your first invoice manually or by asking your agent."}
            action={
              <Button asChild>
                <Link href={clients.length === 0 ? "/clients" : "/invoices/new"}>{clients.length === 0 ? "Add a client" : "New invoice"}</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <InvoiceGrid rows={rows} initialFilter={status} />
      )}
    </>
  );
}
