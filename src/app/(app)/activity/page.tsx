import { Activity } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORY_LABEL } from "@/components/activity-feed";
import { ExecutionBadge, PayPalModeBadge } from "@/components/status";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/dates";
import { getSession } from "@/lib/server";
import type { ActivityCategory, AgentActivity } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agent Activity" };

const FILTERS: Array<{ key: string; label: string; match: (a: AgentActivity) => boolean }> = [
  { key: "all", label: "All activity", match: () => true },
  { key: "success", label: "Successful", match: (a) => a.execution_status === "succeeded" },
  { key: "pending", label: "Pending", match: (a) => a.execution_status === "pending" || a.approval_status === "pending" },
  { key: "approval", label: "Approval required", match: (a) => a.execution_status === "approval_required" },
  { key: "failed", label: "Failed", match: (a) => a.execution_status === "failed" },
  { key: "blocked", label: "Blocked", match: (a) => a.execution_status === "blocked" },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === "") return null;
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ filter?: string; category?: string }> }) {
  const session = await getSession();
  if (!session) return null;
  const { ctx } = session;
  const { filter = "all", category } = await searchParams;
  const [activity, invoices, clients] = await Promise.all([
    ctx.db.list("agent_activity", undefined, { orderBy: "created_at", ascending: false, limit: 500 }),
    ctx.db.list("invoices"),
    ctx.db.list("clients"),
  ]);
  const inv = new Map(invoices.map((i) => [i.id, i.invoice_number]));
  const cli = new Map(clients.map((c) => [c.id, c.name]));
  const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0];
  const rows = activity.filter((a) => f.match(a) && (!category || a.category === category));
  const categories = [...new Set(activity.map((a) => a.category))];
  const href = (k: string, c?: string) => `/activity?filter=${k}${c ? `&category=${c}` : ""}`;

  return (
    <>
      <PageHeader title="Agent Activity" description="An audit log of every operation: what the agent saw, why it acted, what the permission check said, and what PayPal returned." />
      <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Filter activity">
        {FILTERS.map((x) => (
          <Link
            key={x.key}
            href={href(x.key, category)}
            role="tab"
            aria-selected={f.key === x.key}
            className={cn(
              "rounded-[10px] border px-2.5 py-1 text-xs font-medium",
              f.key === x.key ? "border-primary bg-primary-soft text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {x.label} <span className="opacity-70">{activity.filter(x.match).length}</span>
          </Link>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-1">
        <Link href={href(f.key)} className={cn("rounded-full px-2 py-0.5 text-[11px]", !category ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>
          Any type
        </Link>
        {categories.map((c) => (
          <Link key={c} href={href(f.key, c)} className={cn("rounded-full px-2 py-0.5 text-[11px]", category === c ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")}>
            {CATEGORY_LABEL[c as ActivityCategory]}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Activity />} title="Nothing here" description="No activity matches this filter." />
        </Card>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((a) => (
            <li key={a.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{CATEGORY_LABEL[a.category]}</span>
                  <ExecutionBadge status={a.execution_status} />
                  <PayPalModeBadge mode={a.mode} />
                  {a.approval_status && a.approval_status !== "not_required" && (
                    <Badge tone={a.approval_status === "approved" ? "success" : a.approval_status === "rejected" ? "neutral" : "warning"}>Approval: {a.approval_status}</Badge>
                  )}
                  <time className="ml-auto text-[11px] text-muted-foreground tabular" dateTime={a.created_at}>
                    {formatDateTime(a.created_at)}
                  </time>
                </div>
                <dl className="mt-3 grid gap-1.5">
                  <Row label="Reference">
                    {a.invoice_id && inv.get(a.invoice_id) ? (
                      <Link href={`/invoices/${a.invoice_id}`} className="text-primary hover:underline">
                        {inv.get(a.invoice_id)}
                      </Link>
                    ) : null}
                    {a.client_id && cli.get(a.client_id) ? (
                      <>
                        {a.invoice_id ? " · " : ""}
                        <Link href={`/clients/${a.client_id}`} className="text-primary hover:underline">
                          {cli.get(a.client_id)}
                        </Link>
                      </>
                    ) : null}
                  </Row>
                  <Row label="Trigger">{a.trigger}</Row>
                  <Row label="Observed">{a.observed_condition}</Row>
                  <Row label="Reasoning">{a.reasoning}</Row>
                  <Row label="Action">{a.proposed_action}</Row>
                  <Row label="Permission check">{a.permission_result}</Row>
                  <Row label={a.mode === "demo" ? "Demo reference" : "PayPal reference"}>{a.paypal_ref ? <span className="font-mono">{a.paypal_ref}</span> : null}</Row>
                  <Row label="Error">{a.error ? <span className="text-danger">{a.error}</span> : null}</Row>
                </dl>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
