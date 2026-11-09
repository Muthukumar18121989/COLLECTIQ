import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { InvoiceForm } from "@/components/invoice-form";
import { PageHeader } from "@/components/ui/primitives";
import { todayISO } from "@/lib/dates";
import { fromCents } from "@/lib/money";
import { getSession } from "@/lib/server";

export const metadata: Metadata = { title: "Edit draft" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return null;
  const { ctx, profile } = session;
  const { id } = await params;
  const invoice = await ctx.db.get("invoices", id);
  if (!invoice) notFound();
  if (invoice.status !== "draft" || invoice.paypal_invoice_id) redirect(`/invoices/${id}`);
  const [clients, policies, items, project] = await Promise.all([
    ctx.db.list("clients", undefined, { orderBy: "name" }),
    ctx.db.list("collection_policies"),
    ctx.db.list("invoice_items", { invoice_id: id }, { orderBy: "position" }),
    invoice.project_id ? ctx.db.get("projects", invoice.project_id) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader title={`Edit ${invoice.invoice_number}`} description="Drafts can be edited until they are sent." />
      <InvoiceForm
        invoiceId={id}
        today={todayISO()}
        clients={clients.map((c) => ({ id: c.id, name: c.name, email: c.email, company: c.company, currency: c.currency }))}
        policies={policies.map((p) => ({ id: p.id, name: p.name, is_default: p.is_default, status: p.status }))}
        taxRate={profile.tax_rate_percent}
        defaultCurrency={invoice.currency}
        initial={{
          client_id: invoice.client_id,
          project_name: project?.name ?? "",
          currency: invoice.currency,
          issue_date: invoice.issue_date,
          due_date: invoice.due_date,
          note: invoice.note ?? "",
          policy_id: invoice.policy_id ?? "",
          items: items.map((it) => ({ description: it.description, quantity: String(it.quantity), unit_amount: fromCents(it.unit_amount_cents) })),
        }}
      />
    </>
  );
}
