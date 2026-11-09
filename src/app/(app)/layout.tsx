import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { integrationModes } from "@/lib/env";
import { getSession } from "@/lib/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { ctx, profile, user } = session;
  const approvals = await ctx.db.list("approvals", { status: "pending" }, { orderBy: "created_at", ascending: false });
  // Manual reviews stay open while the invoice still has a balance.
  const openInvoices = new Set(
    (await ctx.db.list("invoices")).filter((i) => i.amount_due_cents > 0 && !["paid", "cancelled", "refunded"].includes(i.status)).map((i) => i.id),
  );
  const reviews = new Set(
    (await ctx.db.list("agent_activity", { category: "manual_review_requested" })).filter((a) => a.invoice_id && openInvoices.has(a.invoice_id)).map((a) => a.invoice_id),
  );
  const modes = integrationModes();
  return (
    <AppShell
      user={{ name: profile.full_name || profile.business_name || user.email || "You", email: user.email, isDemo: user.isDemo }}
      modes={{ paypal: modes.paypal, data: modes.data, ai: modes.ai }}
      approvals={approvals.map((a) => ({ id: a.id, summary: a.summary, kind: a.kind }))}
      manualReviews={reviews.size}
    >
      {children}
    </AppShell>
  );
}
