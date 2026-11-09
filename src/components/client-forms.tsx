"use client";

import { AlertOctagon, Pause, Play, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { useApi } from "@/components/use-api";
import { CURRENCIES } from "@/lib/types";

export function AddClientDialog({ defaultCurrency }: { defaultCurrency: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", company: "", phone: "", currency: defaultCurrency, notes: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const { run, pending } = useApi();
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "Name is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = "Enter a valid email (PayPal sends invoices here)";
    setErr(e);
    if (Object.keys(e).length) return;
    const r = await run("add", "/api/clients", f, { success: "Client added" });
    if (r) {
      setOpen(false);
      setF({ name: "", email: "", company: "", phone: "", currency: defaultCurrency, notes: "" });
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add client
        </Button>
      </DialogTrigger>
      <DialogContent title="Add client" description="PayPal emails invoices and reminders to this address.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="cname" error={err.name}>
            <Input id="cname" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} />
          </Field>
          <Field label="Email" htmlFor="cemail" error={err.email}>
            <Input id="cemail" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Company (optional)" htmlFor="ccompany">
            <Input id="ccompany" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} maxLength={120} />
          </Field>
          <Field label="Phone (optional)" htmlFor="cphone">
            <Input id="cphone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={40} />
          </Field>
          <Field label="Currency" htmlFor="ccur">
            <Select id="ccur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Notes (optional)" htmlFor="cnotes" className="sm:col-span-2">
            <Textarea id="cnotes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} />
          </Field>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={pending !== null}>
            {pending ? "Saving…" : "Add client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClientCollectionControls({ id, paused, disputeOpen, disputeNote }: { id: string; paused: boolean; disputeOpen: boolean; disputeNote: string | null }) {
  const { run, pending } = useApi();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={pending !== null} onClick={() => run("p", `/api/clients/${id}`, { collection_paused: !paused }, { method: "PATCH", success: paused ? "Reminders resumed" : "Reminders paused for this client" })}>
        {paused ? <Play /> : <Pause />} {paused ? "Resume reminders" : "Pause reminders"}
      </Button>
      {disputeOpen ? (
        <Button variant="outline" size="sm" disabled={pending !== null} onClick={() => run("d", `/api/clients/${id}`, { dispute_open: false }, { method: "PATCH", success: "Dispute marked resolved" })}>
          Resolve dispute{disputeNote ? ` (“${disputeNote.slice(0, 30)}”)` : ""}
        </Button>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-danger">
              <AlertOctagon /> Record dispute / objection
            </Button>
          </DialogTrigger>
          <DialogContent title="Record a dispute or objection" description="All automated collection for this client stops until you resolve it.">
            <Field label="What did the client say?" htmlFor="dnote">
              <Textarea id="dnote" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
            </Field>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={async () => {
                  const r = await run("d", `/api/clients/${id}`, { dispute_open: true, dispute_note: note || null }, { method: "PATCH", success: "Collection stopped for this client" });
                  if (r) setOpen(false);
                }}
              >
                Stop collection
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
