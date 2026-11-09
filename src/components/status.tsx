import { FlaskConical, ShieldCheck } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/primitives";
import type { ExecutionStatus, InvoiceStatus, PayPalMode } from "@/lib/types";

const STATUS: Record<InvoiceStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  unpaid: { label: "Unpaid", tone: "info" },
  partially_paid: { label: "Partially paid", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  overdue: { label: "Overdue", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  refunded: { label: "Refunded", tone: "neutral" },
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function invoiceStatusLabel(status: InvoiceStatus) {
  return STATUS[status].label;
}

export function PayPalModeBadge({ mode }: { mode: PayPalMode | "internal" | null }) {
  if (!mode || mode === "internal") return null;
  if (mode === "demo") {
    return (
      <Badge tone="warning" title="Demo mode: no PayPal API call was made">
        <FlaskConical className="size-3" /> Demo · not PayPal
      </Badge>
    );
  }
  return (
    <Badge tone="info" title={`PayPal ${mode}`}>
      <ShieldCheck className="size-3" /> PayPal {mode === "sandbox" ? "Sandbox" : "Live"}
    </Badge>
  );
}

const EXEC: Record<ExecutionStatus, { label: string; tone: BadgeTone }> = {
  succeeded: { label: "Succeeded", tone: "success" },
  pending: { label: "Pending", tone: "info" },
  approval_required: { label: "Needs approval", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  blocked: { label: "Blocked", tone: "danger" },
  info: { label: "Recorded", tone: "neutral" },
};

export function ExecutionBadge({ status }: { status: ExecutionStatus }) {
  const s = EXEC[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
