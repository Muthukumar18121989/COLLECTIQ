import type { Metadata } from "next";
import { InvoiceForm } from "@/components/invoice-form";
import { PageHeader } from "@/components/ui/primitives";
import { todayISO } from "@/lib/dates";
import { getSession } from "@/lib/server";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const session = await getSession();
  if (!session) return null;
  const { ctx, profile } = session;
  const { client } = await searchParams;
  const [clients, policies] = await Promise.all([ctx.db.list("clients", undefined, { orderBy: "name" }), ctx.db.list("collection_policies")]);
  const pre = clients.find((c) => c.id === client);
  const today = todayISO();
  return (
    <>
      <PageHeader title="New invoice" description="Create a draft, preview it, then send it through PayPal." />
      <InvoiceForm
        clients={clients.map((c) => ({ id: c.id, name: c.name, email: c.email, company: c.company, currency: c.currency }))}
        policies={policies.map((p) => ({ id: p.id, name: p.name, is_default: p.is_default, status: p.status }))}
        taxRate={profile.tax_rate_percent}
        defaultCurrency={pre?.currency ?? profile.default_currency}
        today={today}
        initial={
          pre
            ? {
                client_id: pre.id,
                project_name: "",
                currency: pre.currency,
                issue_date: today,
                due_date: new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10),
                note: "",
                policy_id: policies.find((p) => p.is_default)?.id ?? "",
                items: [{ description: "", quantity: "1", unit_amount: "" }],
              }
            : undefined
        }
      />
    </>
  );
}
