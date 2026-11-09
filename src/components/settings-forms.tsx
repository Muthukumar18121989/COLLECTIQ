"use client";

import { Database, FlaskConical, PlugZap, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/components/use-api";
import type { AutonomyMode, Profile } from "@/lib/types";
import { CURRENCIES } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ProfileForm({ profile }: { profile: Profile }) {
  const [f, setF] = useState({
    full_name: profile.full_name ?? "",
    business_name: profile.business_name ?? "",
    default_currency: profile.default_currency,
    tax_rate_percent: String(profile.tax_rate_percent),
  });
  const { run, pending } = useApi();
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run("save", "/api/settings", { ...f, tax_rate_percent: Number(f.tax_rate_percent) || 0 }, { method: "PATCH", success: "Settings saved" });
      }}
    >
      <Field label="Your name" htmlFor="fn">
        <Input id="fn" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} maxLength={120} />
      </Field>
      <Field label="Business name" htmlFor="bn">
        <Input id="bn" value={f.business_name} onChange={(e) => setF({ ...f, business_name: e.target.value })} maxLength={120} />
      </Field>
      <Field label="Reporting currency" htmlFor="dc" hint="Dashboard totals use this currency. Other currencies are not converted.">
        <Select id="dc" value={f.default_currency} onChange={(e) => setF({ ...f, default_currency: e.target.value as Profile["default_currency"] })}>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <Field label="Tax rate (%)" htmlFor="tax" hint="Applied to new invoices. 0 = no tax line.">
        <Input id="tax" type="number" min={0} max={50} step="0.01" value={f.tax_rate_percent} onChange={(e) => setF({ ...f, tax_rate_percent: e.target.value })} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending !== null}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

const MODES: Array<{ key: AutonomyMode; title: string; text: string }> = [
  { key: "assisted", title: "Assisted", text: "The agent prepares actions and asks you to approve every one." },
  { key: "policy_driven", title: "Policy-driven", text: "The agent executes low-risk reminders your active policies explicitly allow. Escalations and sensitive actions need approval." },
  { key: "adaptive", title: "Adaptive", text: "Policy-driven, plus recommendations to improve your policies from collection history. Recommendations need approval." },
];

export function AutonomyForm({ mode, paused }: { mode: AutonomyMode; paused: boolean }) {
  const { run, pending } = useApi();
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="Autonomy mode">
        {MODES.map((m) => (
          <button
            key={m.key}
            role="radio"
            aria-checked={mode === m.key}
            disabled={pending !== null}
            onClick={() => mode !== m.key && run("mode", "/api/settings", { autonomy_mode: m.key }, { method: "PATCH", success: `Autonomy set to ${m.title}` })}
            className={cn("rounded-[12px] border p-3 text-left transition-colors", mode === m.key ? "border-primary bg-primary-soft/60" : "border-border hover:border-primary/40")}
          >
            <p className="text-sm font-medium">{m.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{m.text}</p>
          </button>
        ))}
      </div>
      <label className="flex items-center justify-between gap-3 rounded-[12px] border border-border p-3">
        <span>
          <span className="block text-sm font-medium">Pause all agent activity</span>
          <span className="block text-xs text-muted-foreground">Emergency stop. The scheduler and AI can no longer execute anything until you turn this off.</span>
        </span>
        <Switch checked={paused} disabled={pending !== null} onCheckedChange={(v) => run("pause", "/api/settings", { agent_paused: v }, { method: "PATCH", success: v ? "Agent paused" : "Agent resumed" })} aria-label="Pause all agent activity" />
      </label>
    </div>
  );
}

export function TestPayPalButton({ configured }: { configured: boolean }) {
  const { run, pending } = useApi();
  const [res, setRes] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={!configured || pending !== null}
        onClick={async () => {
          const r = await run<{ mode: string; total_invoices: number | null }>("t", "/api/integrations/paypal", {}, { refresh: false });
          if (r) setRes(`Connected to PayPal ${r.mode}. ${r.total_invoices ?? "Unknown number of"} invoice(s) visible.`);
        }}
      >
        <PlugZap /> {pending ? "Testing…" : "Test PayPal connection"}
      </Button>
      {res && <span className="text-xs text-success">{res}</span>}
    </div>
  );
}

export function DemoDataControls({ dataMode }: { dataMode: string }) {
  const { run, pending } = useApi();
  const router = useRouter();
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={pending !== null} onClick={() => run<{ message: string }>("seed", "/api/demo/seed", {}).then((r) => r && toast.success(r.message))}>
        <Database /> Load demo data
      </Button>
      {dataMode === "demo" && (
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <RotateCcw /> Reset demo database
            </Button>
          </DialogTrigger>
          <DialogContent title="Reset the demo database?" description="All local demo data (invoices, clients, activity, conversations) is deleted and the demo fixtures are loaded again.">
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={async () => {
                  const r = await run("reset", "/api/demo/reset", {}, { refresh: false });
                  if (r) {
                    toast.success("Demo database reset");
                    router.push("/");
                    router.refresh();
                  }
                }}
              >
                <FlaskConical /> Reset
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
