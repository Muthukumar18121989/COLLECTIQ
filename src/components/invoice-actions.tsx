"use client";

import { Ban, BellRing, FlaskConical, Pause, Pencil, Play, RefreshCw, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { useApi } from "@/components/use-api";
import type { InvoiceStatus, PayPalMode } from "@/lib/types";

export function InvoiceActions({
  id,
  status,
  paypalMode,
  hasPayPalId,
  paused,
  sendMode,
  dueLabel,
  clientEmail,
}: {
  id: string;
  status: InvoiceStatus;
  paypalMode: PayPalMode | null;
  hasPayPalId: boolean;
  paused: boolean;
  /** Where a send would go right now: sandbox/live or demo. */
  sendMode: PayPalMode;
  dueLabel: string;
  clientEmail: string;
}) {
  const { run, pending } = useApi();
  const [tone, setTone] = useState("friendly");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const isOpenInvoice = ["sent", "unpaid", "partially_paid", "overdue"].includes(status);
  const closed = ["paid", "cancelled", "refunded"].includes(status);

  const act = async (key: string, url: string, body: unknown, success: string) => {
    const r = await run(key, url, body, { success });
    if (r) setOpen(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && !hasPayPalId && (
        <Button asChild variant="outline">
          <Link href={`/invoices/${id}/edit`}>
            <Pencil /> Edit draft
          </Link>
        </Button>
      )}

      {status === "draft" && (
        <Dialog open={open === "send"} onOpenChange={(o) => setOpen(o ? "send" : null)}>
          <DialogTrigger asChild>
            <Button>
              <Send /> Send via PayPal
            </Button>
          </DialogTrigger>
          <DialogContent
            title="Send this invoice?"
            description={
              sendMode === "demo"
                ? "Demo mode: PayPal is not connected, so this send is simulated. No email is sent and nothing is created in PayPal."
                : `COLLECTIQ will create the invoice in PayPal ${sendMode === "sandbox" ? "Sandbox" : "Live"} and PayPal will email it to ${clientEmail}.`
            }
          >
            <p className="text-sm text-muted-foreground">
              Amount due {dueLabel}.{" "}
              {sendMode === "demo" ? "The invoice gets a DEMO reference, not a PayPal ID." : "The status changes to Sent only after PayPal confirms, and you'll see the PayPal invoice ID."}
            </p>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Not yet</Button>
              </DialogClose>
              <Button onClick={() => act("send", `/api/invoices/${id}/send`, {}, sendMode === "demo" ? "Simulated send recorded (demo)" : "PayPal confirmed: invoice sent")} disabled={pending !== null}>
                {pending === "send" ? "Sending…" : sendMode === "demo" ? "Simulate send" : "Send via PayPal"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {isOpenInvoice && (
        <Dialog open={open === "remind"} onOpenChange={(o) => setOpen(o ? "remind" : null)}>
          <DialogTrigger asChild>
            <Button>
              <BellRing /> Send reminder
            </Button>
          </DialogTrigger>
          <DialogContent title="Send a payment reminder" description="COLLECTIQ checks the latest PayPal status first and will not remind a paid or cancelled invoice.">
            <div className="grid gap-3">
              <Field label="Tone" htmlFor="tone">
                <Select id="tone" value={tone} onChange={(e) => setTone(e.target.value)}>
                  <option value="friendly">Friendly</option>
                  <option value="neutral">Neutral</option>
                  <option value="firm">Firm</option>
                </Select>
              </Field>
              <Field label="Custom note (optional)" htmlFor="note" hint="Leave blank to use the tone's standard wording.">
                <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
              </Field>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={() => act("remind", `/api/invoices/${id}/remind`, { tone, note }, paypalMode === "demo" ? "Simulated reminder recorded (demo)" : "PayPal confirmed: reminder sent")} disabled={pending !== null}>
                {pending === "remind" ? "Sending…" : paypalMode === "demo" ? "Simulate reminder" : "Send reminder"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {hasPayPalId && (
        <Button variant="outline" onClick={() => run("sync", `/api/invoices/${id}/sync`, {}, { success: "Refreshed from PayPal" })} disabled={pending !== null}>
          <RefreshCw className={pending === "sync" ? "animate-spin" : ""} /> {paypalMode === "demo" ? "Refresh" : "Refresh from PayPal"}
        </Button>
      )}

      {isOpenInvoice && (
        <Button variant="outline" onClick={() => run("pause", `/api/invoices/${id}/collection`, { paused: !paused }, { success: paused ? "Reminders resumed" : "Reminders paused" })} disabled={pending !== null}>
          {paused ? <Play /> : <Pause />} {paused ? "Resume reminders" : "Pause reminders"}
        </Button>
      )}

      {isOpenInvoice && paypalMode === "demo" && (
        <Dialog open={open === "pay"} onOpenChange={(o) => setOpen(o ? "pay" : null)}>
          <DialogTrigger asChild>
            <Button variant="outline" className="border-warning/40 text-warning">
              <FlaskConical /> Simulate payment (demo)
            </Button>
          </DialogTrigger>
          <DialogContent title="Simulate a payment (demo only)" description="This runs the same payment-event pipeline a verified PayPal webhook would, on demo data only. No money moves and PayPal is not contacted.">
            <Field label="Amount (leave blank for the full balance)" htmlFor="pay">
              <Input id="pay" type="number" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </Field>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={() => act("pay", `/api/invoices/${id}/simulate-payment`, payAmount ? { amount: Number(payAmount) } : {}, "Demo payment recorded")} disabled={pending !== null}>
                Record demo payment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {!closed && (
        <Dialog open={open === "cancel"} onOpenChange={(o) => setOpen(o ? "cancel" : null)}>
          <DialogTrigger asChild>
            <Button variant="ghost" className="text-danger">
              <Ban /> Cancel invoice
            </Button>
          </DialogTrigger>
          <DialogContent
            title="Cancel this invoice?"
            description={hasPayPalId && paypalMode !== "demo" ? "The invoice will be cancelled in PayPal and the client notified. This cannot be undone." : "The invoice will be marked cancelled. This cannot be undone."}
          >
            <Field label="Reason (optional, shared with the client)" htmlFor="reason">
              <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </Field>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Keep invoice</Button>
              </DialogClose>
              <Button variant="destructive" onClick={() => act("cancel", `/api/invoices/${id}/cancel`, { reason: reason || undefined }, "Invoice cancelled")} disabled={pending !== null}>
                {pending === "cancel" ? "Cancelling…" : "Cancel invoice"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
