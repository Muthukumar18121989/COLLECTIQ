"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/components/use-api";
import type { CollectionPolicy, PolicyStep } from "@/lib/types";

type Draft = Pick<CollectionPolicy, "name" | "status" | "auto_execute" | "is_default" | "max_reminders_per_invoice" | "min_days_between_reminders"> & { steps: PolicyStep[] };

const NEW_POLICY: Draft = {
  name: "",
  status: "active",
  auto_execute: false,
  is_default: false,
  max_reminders_per_invoice: 3,
  min_days_between_reminders: 3,
  steps: [{ id: "step_1", offset_days: 1, action: "reminder", tone: "friendly", requires_approval: false, label: "Reminder 1 day after due" }],
};

export function PolicyEditor({ policy, trigger }: { policy?: CollectionPolicy; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Draft>(policy ? { ...policy, steps: policy.steps.map((s) => ({ ...s })) } : NEW_POLICY);
  const { run, pending } = useApi();
  const setStep = (i: number, patch: Partial<PolicyStep>) => setD((p) => ({ ...p, steps: p.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  const save = async () => {
    const body = { ...d, steps: [...d.steps].sort((a, b) => a.offset_days - b.offset_days) };
    const r = policy
      ? await run("save", `/api/policies/${policy.id}`, body, { method: "PATCH", success: "Policy saved" })
      : await run("save", "/api/policies", body, { success: "Policy created" });
    if (r) setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setD(policy ? { ...policy, steps: policy.steps.map((s) => ({ ...s })) } : NEW_POLICY);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={policy ? `Edit "${policy.name}"` : "New collection policy"} description="Steps run relative to each invoice's due date. Escalations and manual reviews always require your approval." className="max-w-2xl">
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="pname">
              <Input id="pname" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={80} placeholder="e.g. Gentle for retainers" />
            </Field>
            <Field label="Status" htmlFor="pstatus">
              <Select id="pstatus" value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as Draft["status"] })}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </Select>
            </Field>
            <Field label="Max reminders per invoice" htmlFor="pmax">
              <Input id="pmax" type="number" min={1} max={10} value={d.max_reminders_per_invoice} onChange={(e) => setD({ ...d, max_reminders_per_invoice: Number(e.target.value) })} />
            </Field>
            <Field label="Minimum days between reminders" htmlFor="pmin">
              <Input id="pmin" type="number" min={1} max={30} value={d.min_days_between_reminders} onChange={(e) => setD({ ...d, min_days_between_reminders: Number(e.target.value) })} />
            </Field>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-[10px] border border-border p-3">
            <span>
              <span className="block text-sm font-medium">Automatic execution</span>
              <span className="block text-xs text-muted-foreground">Let the agent send low-risk reminders without asking (Policy-driven mode). Off = every reminder waits for approval.</span>
            </span>
            <Switch checked={d.auto_execute} onCheckedChange={(v) => setD({ ...d, auto_execute: v })} aria-label="Automatic execution" />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-[10px] border border-border p-3">
            <span className="text-sm font-medium">Default policy for new invoices</span>
            <Switch checked={Boolean(d.is_default)} onCheckedChange={(v) => setD({ ...d, is_default: v })} aria-label="Default policy" />
          </label>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Steps</p>
            <div className="flex flex-col gap-2">
              {d.steps.map((s, i) => (
                <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-[10px] border border-border p-2.5">
                  <Field label="Days vs due" htmlFor={`off-${i}`} className="col-span-4 sm:col-span-2">
                    <Input id={`off-${i}`} type="number" min={-60} max={180} value={s.offset_days} onChange={(e) => setStep(i, { offset_days: Number(e.target.value) })} />
                  </Field>
                  <Field label="Action" htmlFor={`act-${i}`} className="col-span-8 sm:col-span-3">
                    <Select id={`act-${i}`} value={s.action} onChange={(e) => setStep(i, { action: e.target.value as PolicyStep["action"], requires_approval: e.target.value !== "reminder" ? true : s.requires_approval })}>
                      <option value="reminder">Reminder</option>
                      <option value="escalation">Escalation</option>
                      <option value="manual_review">Notify me (manual review)</option>
                    </Select>
                  </Field>
                  <Field label="Tone" htmlFor={`tone-${i}`} className="col-span-6 sm:col-span-2">
                    <Select id={`tone-${i}`} value={s.tone} onChange={(e) => setStep(i, { tone: e.target.value as PolicyStep["tone"] })}>
                      <option value="friendly">Friendly</option>
                      <option value="neutral">Neutral</option>
                      <option value="firm">Firm</option>
                    </Select>
                  </Field>
                  <Field label="Label" htmlFor={`lbl-${i}`} className="col-span-6 sm:col-span-3">
                    <Input id={`lbl-${i}`} value={s.label} maxLength={120} onChange={(e) => setStep(i, { label: e.target.value })} />
                  </Field>
                  <div className="col-span-12 flex items-center justify-between gap-2 sm:col-span-2 sm:justify-end">
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Switch checked={s.action !== "reminder" || s.requires_approval} disabled={s.action !== "reminder"} onCheckedChange={(v) => setStep(i, { requires_approval: v })} aria-label="Requires approval" />
                      Approval
                    </label>
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove step" disabled={d.steps.length === 1} onClick={() => setD((p) => ({ ...p, steps: p.steps.filter((_, j) => j !== i) }))}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() =>
                setD((p) => ({
                  ...p,
                  steps: [...p.steps, { id: `step_${Date.now().toString(36)}`, offset_days: (p.steps.at(-1)?.offset_days ?? 0) + 7, action: "reminder", tone: "neutral", requires_approval: false, label: "Follow-up reminder" }],
                }))
              }
            >
              <Plus /> Add step
            </Button>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={save} disabled={pending !== null || !d.name.trim()}>
            {pending ? "Saving…" : "Save policy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
