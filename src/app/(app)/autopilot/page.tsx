import { ArrowRight, Bot, Pencil, Plus, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ApprovalCard } from "@/components/approval-card";
import { PolicyStatusToggle, RecommendButton, RunAutopilotButton } from "@/components/autopilot-controls";
import { PolicyEditor } from "@/components/policy-editor";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui/primitives";
import { integrationModes } from "@/lib/env";
import { getSession } from "@/lib/server";

export const metadata: Metadata = { title: "Autopilot" };

const MODE_COPY = {
  assisted: { label: "Assisted", text: "The agent prepares every action and asks you to approve it." },
  policy_driven: { label: "Policy-driven", text: "The agent sends low-risk reminders your active policies allow. Escalations still need approval." },
  adaptive: { label: "Adaptive", text: "Policy-driven, plus the agent analyses your collection history and recommends policy changes for your approval." },
};

function offsetLabel(d: number) {
  if (d < 0) return `${-d}d before due`;
  if (d === 0) return "On due date";
  return `${d}d overdue`;
}

export default async function AutopilotPage() {
  const session = await getSession();
  if (!session) return null;
  const { ctx, profile } = session;
  const [policies, approvals, tasks, invoices] = await Promise.all([
    ctx.db.list("collection_policies", undefined, { orderBy: "created_at" }),
    ctx.db.list("approvals", { status: "pending" }, { orderBy: "created_at", ascending: false }),
    ctx.db.list("agent_tasks"),
    ctx.db.list("invoices"),
  ]);
  const mode = MODE_COPY[profile.autonomy_mode];
  const cronReady = integrationModes().cronConfigured;
  const count = (s: string) => tasks.filter((t) => t.status === s).length;
  const usage = (id: string) => invoices.filter((i) => i.policy_id === id && ["sent", "unpaid", "partially_paid"].includes(i.status)).length;

  return (
    <>
      <PageHeader title="Collection Autopilot" description="Policies decide what should happen. The permission service decides what may happen. PayPal executes. Everything is logged." actions={<RunAutopilotButton />} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="rounded-[10px] bg-primary-soft p-2 text-primary">
                <Bot className="size-5" />
              </span>
              <div>
                <CardTitle className="flex items-center gap-2">
                  Autonomy: {mode.label}
                  {profile.agent_paused && <Badge tone="danger">Agent paused</Badge>}
                </CardTitle>
                <CardDescription className="max-w-xl">{mode.text}</CardDescription>
              </div>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/settings#autonomy">
                Change <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Reminders sent", tasks.filter((t) => t.status === "succeeded" && (t.kind === "reminder" || t.kind === "escalation")).length],
                ["Awaiting approval", count("pending_approval")],
                ["Blocked by rules", count("blocked")],
                ["Suppressed (paid/cancelled)", count("suppressed")],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-[10px] bg-muted/60 px-3 py-2.5">
                  <p className="text-lg font-semibold tabular">{v}</p>
                  <p className="text-[11px] text-muted-foreground">{l}</p>
                </div>
              ))}
            </div>
            {profile.autonomy_mode === "adaptive" && (
              <div className="mt-4">
                <RecommendButton />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" /> Guardrails
              </CardTitle>
              <CardDescription>Enforced by the backend, never by the AI</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>• Never reminds paid or cancelled invoices</li>
              <li>• Checks PayPal&apos;s latest status before every reminder</li>
              <li>• One action per invoice per policy step (idempotency keys)</li>
              <li>• Respects max reminders and minimum spacing</li>
              <li>• Stops when a dispute or objection is recorded</li>
              <li>• Escalations always need your approval</li>
              <li>• Never moves money, refunds or edits amounts</li>
            </ul>
            <div className="mt-3 rounded-[10px] border border-border px-3 py-2 text-xs">
              Scheduled runs: {cronReady ? <Badge tone="success">CRON_SECRET set</Badge> : <Badge tone="warning">Not configured</Badge>}
              <p className="mt-1 text-muted-foreground">
                {cronReady ? "Point a Render Cron Job at /api/cron/run-collections." : "Set CRON_SECRET and add a Render Cron Job. You can still run cycles manually."}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4" id="approvals">
        <CardHeader>
          <div>
            <CardTitle>Approval queue</CardTitle>
            <CardDescription>Prepared by the scheduler, the AI Command Center or adaptive analysis</CardDescription>
          </div>
          {approvals.length > 0 && <Badge tone="warning">{approvals.length} pending</Badge>}
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2">
          {approvals.length === 0 ? (
            <p className="col-span-full py-6 text-center text-xs text-muted-foreground">No pending approvals.</p>
          ) : (
            approvals.map((a) => <ApprovalCard key={a.id} approval={a} />)
          )}
        </CardContent>
      </Card>

      <div className="mt-6 mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Collection policies</h2>
        <PolicyEditor
          trigger={
            <Button size="sm">
              <Plus /> New policy
            </Button>
          }
        />
      </div>
      {policies.length === 0 ? (
        <Card>
          <EmptyState title="No policies" description="Create a policy to automate reminders." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {policies.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {p.name}
                    {p.is_default && <Badge tone="primary">Default</Badge>}
                    <Badge tone={p.status === "active" ? "success" : "neutral"}>{p.status === "active" ? "Active" : "Paused"}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {p.auto_execute ? "Automatic execution on" : "Every reminder needs approval"} · max {p.max_reminders_per_invoice} reminders · at least {p.min_days_between_reminders}d apart · {usage(p.id)} open invoice(s)
                  </CardDescription>
                </div>
                <div className="flex gap-1">
                  <PolicyStatusToggle id={p.id} status={p.status} />
                  <PolicyEditor
                    policy={p}
                    trigger={
                      <Button variant="outline" size="sm" aria-label={`Edit ${p.name}`}>
                        <Pencil />
                      </Button>
                    }
                  />
                </div>
              </CardHeader>
              <CardContent>
                <ol className="relative space-y-3 border-l border-border pl-4">
                  {[...p.steps]
                    .sort((a, b) => a.offset_days - b.offset_days)
                    .map((s) => (
                      <li key={s.id} className="relative">
                        <span className={`absolute -left-[21px] top-1 size-2.5 rounded-full ${s.action === "reminder" ? "bg-primary" : s.action === "escalation" ? "bg-warning" : "bg-danger"}`} />
                        <p className="text-xs font-medium">{s.label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {offsetLabel(s.offset_days)} · {s.action.replace("_", " ")} · {s.tone} · {s.action !== "reminder" || s.requires_approval ? "needs approval" : p.auto_execute && profile.autonomy_mode !== "assisted" ? "automatic" : "needs approval"}
                        </p>
                      </li>
                    ))}
                </ol>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
