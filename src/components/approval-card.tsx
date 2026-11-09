"use client";

import { Check, Clock, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { ApiError, apiFetch } from "@/components/use-api";
import type { Approval } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<Approval["kind"], string> = {
  create_invoice: "Create invoice",
  send_invoice: "Send invoice via PayPal",
  send_reminder: "Send reminder",
  escalation: "Escalation",
  cancel_invoice: "Cancel invoice",
  pause_collection: "Collection setting",
  policy_recommendation: "Policy recommendation",
};

export function ApprovalCard({ approval: initial, compact = false, onChange }: { approval: Approval; compact?: boolean; onChange?: (a: Approval) => void }) {
  const [approval, setApproval] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const router = useRouter();
  const decide = async (decision: "approve" | "reject") => {
    setPending(decision);
    try {
      const res = await apiFetch<{ approval: Approval }>(`/api/approvals/${approval.id}`, { decision });
      setApproval(res.approval);
      onChange?.(res.approval);
      toast.success(decision === "approve" ? "Approved and executed" : "Rejected");
    } catch (e) {
      const failed = e instanceof ApiError ? (e.details as { approval?: Approval } | undefined)?.approval : undefined;
      if (failed) setApproval(failed);
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setPending(null);
      router.refresh();
    }
  };
  const result = approval.result as Record<string, unknown> | null;
  return (
    <div className={cn("rounded-[12px] border border-border bg-card p-3.5", approval.status === "pending" && "border-warning/40 bg-warning-soft/30")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={approval.kind === "escalation" ? "danger" : approval.kind === "policy_recommendation" ? "primary" : "info"}>{KIND_LABEL[approval.kind]}</Badge>
        <span className="text-[11px] text-muted-foreground">
          from {approval.source === "scheduler" ? "Autopilot" : approval.source === "chat" ? "AI Command Center" : approval.source === "adaptive" ? "Adaptive analysis" : "you"}
        </span>
        <StatusPill status={approval.status} />
      </div>
      <p className="mt-2 text-sm font-medium leading-snug">{approval.summary}</p>
      {!compact && approval.reasoning ? <p className="mt-1 text-xs text-muted-foreground">Why: {approval.reasoning}</p> : null}
      {!compact && typeof (approval.payload as { note?: string }).note === "string" ? (
        <blockquote className="mt-2 rounded-[10px] border-l-2 border-primary bg-muted/60 px-3 py-2 text-xs italic text-muted-foreground">
          {(approval.payload as { note: string }).note}
        </blockquote>
      ) : null}
      {approval.status === "pending" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => decide("approve")} disabled={pending !== null}>
            <Check /> {pending === "approve" ? "Executing…" : "Approve"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => decide("reject")} disabled={pending !== null}>
            <X /> Reject
          </Button>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <ShieldAlert className="size-3" /> Permissions are re-checked when you approve.
          </span>
        </div>
      ) : null}
      {approval.status === "executed" && result?.invoice_id ? (
        <Link href={`/invoices/${result.invoice_id}`} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
          Open invoice →
        </Link>
      ) : null}
      {approval.status === "failed" && result?.error ? <p className="mt-2 text-xs text-danger">Failed: {String(result.error)}</p> : null}
      {approval.status === "executed" && result?.outcome === "suppressed" ? (
        <p className="mt-2 text-xs text-muted-foreground">Not sent: {String(result.reason)}</p>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: Approval["status"] }) {
  const map = {
    pending: { tone: "warning" as const, label: "Awaiting approval", icon: <Clock className="size-3" /> },
    approved: { tone: "info" as const, label: "Approved", icon: null },
    executed: { tone: "success" as const, label: "Executed", icon: <Check className="size-3" /> },
    rejected: { tone: "neutral" as const, label: "Rejected", icon: null },
    failed: { tone: "danger" as const, label: "Failed", icon: null },
    expired: { tone: "neutral" as const, label: "No longer needed", icon: null },
  }[status];
  return (
    <Badge tone={map.tone} className="ml-auto">
      {map.icon}
      {map.label}
    </Badge>
  );
}
