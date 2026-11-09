import { AlertTriangle, Ban, Bell, CheckCircle2, CircleDollarSign, FilePlus2, Pause, Play, Send, ShieldQuestion, Webhook, Wrench } from "lucide-react";
import Link from "next/link";
import { ExecutionBadge, PayPalModeBadge } from "@/components/status";
import { formatDateTime } from "@/lib/dates";
import type { ActivityCategory, AgentActivity } from "@/lib/types";

export const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  invoice_created: "Invoice created",
  invoice_sent: "Invoice sent",
  invoice_cancelled: "Invoice cancelled",
  reminder_prepared: "Reminder prepared",
  reminder_sent: "Reminder sent",
  payment_received: "Payment received",
  payment_status_updated: "Payment status updated",
  policy_activated: "Policy activated",
  policy_paused: "Policy paused",
  policy_updated: "Policy updated",
  approval_requested: "Approval requested",
  approval_decided: "Approval decided",
  action_blocked: "Action blocked",
  manual_review_requested: "Manual review requested",
  webhook_received: "PayPal event received",
  settings_changed: "Settings changed",
};

const ICON: Record<ActivityCategory, React.ComponentType<{ className?: string }>> = {
  invoice_created: FilePlus2,
  invoice_sent: Send,
  invoice_cancelled: Ban,
  reminder_prepared: ShieldQuestion,
  reminder_sent: Bell,
  payment_received: CircleDollarSign,
  payment_status_updated: CheckCircle2,
  policy_activated: Play,
  policy_paused: Pause,
  policy_updated: Wrench,
  approval_requested: ShieldQuestion,
  approval_decided: CheckCircle2,
  action_blocked: AlertTriangle,
  manual_review_requested: AlertTriangle,
  webhook_received: Webhook,
  settings_changed: Wrench,
};

export function CompactActivity({ items, invoiceNumbers }: { items: AgentActivity[]; invoiceNumbers: Map<string, string> }) {
  if (items.length === 0) return <p className="py-6 text-center text-xs text-muted-foreground">No agent activity yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((a) => {
        const Icon = ICON[a.category];
        return (
          <li key={a.id} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5 rounded-full bg-muted p-1.5 text-muted-foreground">
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[13px] font-medium">{CATEGORY_LABEL[a.category]}</span>
                {a.invoice_id && invoiceNumbers.get(a.invoice_id) ? (
                  <Link href={`/invoices/${a.invoice_id}`} className="text-xs text-primary hover:underline">
                    {invoiceNumbers.get(a.invoice_id)}
                  </Link>
                ) : null}
                <ExecutionBadge status={a.execution_status} />
                <PayPalModeBadge mode={a.mode} />
              </div>
              {a.proposed_action || a.observed_condition ? (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.proposed_action ?? a.observed_condition}</p>
              ) : null}
              {a.error ? <p className="mt-0.5 text-xs text-danger">{a.error}</p> : null}
            </div>
            <time className="shrink-0 text-[11px] text-muted-foreground tabular">{formatDateTime(a.created_at)}</time>
          </li>
        );
      })}
    </ul>
  );
}
