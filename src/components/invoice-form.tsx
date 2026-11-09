"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ApiError, apiFetch } from "@/components/use-api";
import { CURRENCIES } from "@/lib/types";

interface ClientOpt {
  id: string;
  name: string;
  email: string;
  company: string | null;
  currency: string;
}
interface PolicyOpt {
  id: string;
  name: string;
  is_default: boolean;
  status: string;
}
export interface InvoiceFormValues {
  client_id: string;
  project_name: string;
  currency: string;
  issue_date: string;
  due_date: string;
  note: string;
  policy_id: string;
  items: Array<{ description: string; quantity: string; unit_amount: string }>;
}

function addDays(iso: string, d: number) {
  const x = new Date(`${iso}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
}

export function InvoiceForm({
  clients,
  policies,
  taxRate,
  defaultCurrency,
  initial,
  invoiceId,
  today,
}: {
  clients: ClientOpt[];
  policies: PolicyOpt[];
  taxRate: number;
  defaultCurrency: string;
  initial?: InvoiceFormValues;
  invoiceId?: string;
  today: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<InvoiceFormValues>(
    initial ?? {
      client_id: "",
      project_name: "",
      currency: defaultCurrency,
      issue_date: today,
      due_date: addDays(today, 14),
      note: "",
      policy_id: policies.find((p) => p.is_default)?.id ?? "",
      items: [{ description: "", quantity: "1", unit_amount: "" }],
    },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const client = clients.find((c) => c.id === v.client_id);

  const subtotal = useMemo(
    () => v.items.reduce((s, it) => s + Math.round((Number(it.quantity) || 0) * Math.round((Number(it.unit_amount) || 0) * 100)), 0),
    [v.items],
  );
  const tax = Math.round((subtotal * taxRate) / 100);
  const money = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: v.currency }).format(c / 100);
  const set = <K extends keyof InvoiceFormValues>(k: K, val: InvoiceFormValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const setItem = (i: number, k: "description" | "quantity" | "unit_amount", val: string) =>
    setV((p) => ({ ...p, items: p.items.map((it, j) => (j === i ? { ...it, [k]: val } : it)) }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!v.client_id) e.client_id = "Choose a client";
    if (!v.due_date) e.due_date = "Choose a due date";
    else if (v.due_date < v.issue_date) e.due_date = "Due date must be on or after the issue date";
    v.items.forEach((it, i) => {
      if (!it.description.trim()) e[`items.${i}.description`] = "Describe the work";
      if (!(Number(it.quantity) > 0)) e[`items.${i}.quantity`] = "Must be > 0";
      if (!(Number(it.unit_amount) > 0)) e[`items.${i}.unit_amount`] = "Enter an amount";
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const body = {
        ...v,
        project_name: v.project_name || null,
        note: v.note || null,
        policy_id: v.policy_id || null,
        items: v.items.map((it) => ({ description: it.description, quantity: Number(it.quantity), unit_amount: Number(it.unit_amount) })),
      };
      const res = invoiceId
        ? await apiFetch<{ invoice: { id: string } }>(`/api/invoices/${invoiceId}`, body, "PATCH")
        : await apiFetch<{ invoice: { id: string } }>("/api/invoices", body);
      toast.success(invoiceId ? "Draft updated" : "Draft created. Review it, then send via PayPal.");
      router.push(`/invoices/${res.invoice.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        const fe: Record<string, string> = {};
        for (const issue of err.details as Array<{ path: Array<string | number>; message: string }>) fe[issue.path.join(".")] = issue.message;
        setErrors(fe);
      }
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  if (clients.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm font-medium">Add a client first</p>
        <p className="mt-1 text-xs text-muted-foreground">Invoices need a saved client with an email address for PayPal.</p>
        <Button asChild className="mt-4">
          <Link href="/clients">Go to Clients</Link>
        </Button>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-5" noValidate>
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client" htmlFor="client" error={errors.client_id}>
              <Select
                id="client"
                value={v.client_id}
                onChange={(e) => {
                  const c = clients.find((x) => x.id === e.target.value);
                  setV((p) => ({ ...p, client_id: e.target.value, currency: c?.currency ?? p.currency }));
                }}
              >
                <option value="">Select a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.company ? ` · ${c.company}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Project (optional)" htmlFor="project">
              <Input id="project" value={v.project_name} onChange={(e) => set("project_name", e.target.value)} placeholder="e.g. Brand refresh" maxLength={120} />
            </Field>
            <Field label="Issue date" htmlFor="issue">
              <Input id="issue" type="date" value={v.issue_date} onChange={(e) => set("issue_date", e.target.value)} />
            </Field>
            <Field label="Due date" htmlFor="due" error={errors.due_date}>
              <Input id="due" type="date" value={v.due_date} min={v.issue_date} onChange={(e) => set("due_date", e.target.value)} />
            </Field>
            <Field label="Currency" htmlFor="currency" hint={client && client.currency !== v.currency ? `${client.name} usually pays in ${client.currency}` : undefined}>
              <Select id="currency" value={v.currency} onChange={(e) => set("currency", e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Collection policy" htmlFor="policy">
              <Select id="policy" value={v.policy_id} onChange={(e) => set("policy_id", e.target.value)}>
                <option value="">No automated collection</option>
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.status === "paused" ? " (paused)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Line items</p>
            <div className="flex flex-col gap-2">
              {v.items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <div className="col-span-12 sm:col-span-6">
                    <Input aria-label={`Item ${i + 1} description`} placeholder="Description" value={it.description} onChange={(e) => setItem(i, "description", e.target.value)} maxLength={200} />
                    {errors[`items.${i}.description`] && <p className="mt-1 text-xs text-danger">{errors[`items.${i}.description`]}</p>}
                  </div>
                  <div className="col-span-3 sm:col-span-2">
                    <Input aria-label={`Item ${i + 1} quantity`} type="number" min="0" step="0.5" value={it.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} />
                    {errors[`items.${i}.quantity`] && <p className="mt-1 text-xs text-danger">{errors[`items.${i}.quantity`]}</p>}
                  </div>
                  <div className="col-span-7 sm:col-span-3">
                    <Input aria-label={`Item ${i + 1} unit price`} type="number" min="0" step="0.01" placeholder="Unit price" value={it.unit_amount} onChange={(e) => setItem(i, "unit_amount", e.target.value)} />
                    {errors[`items.${i}.unit_amount`] && <p className="mt-1 text-xs text-danger">{errors[`items.${i}.unit_amount`]}</p>}
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove item ${i + 1}`} disabled={v.items.length === 1} onClick={() => setV((p) => ({ ...p, items: p.items.filter((_, j) => j !== i) }))}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setV((p) => ({ ...p, items: [...p.items, { description: "", quantity: "1", unit_amount: "" }] }))}>
              <Plus /> Add item
            </Button>
          </div>

          <Field label="Note to client (optional)" htmlFor="note">
            <Textarea id="note" value={v.note} onChange={(e) => set("note", e.target.value)} maxLength={4000} placeholder="Thanks for your business!" />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-[12px] border border-border bg-background p-4 text-sm">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Bill to</span>
                <span>Due {v.due_date || "—"}</span>
              </div>
              <p className="mt-1 font-medium">{client?.name ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{client?.email}</p>
              <div className="mt-3 divide-y divide-border border-y border-border">
                {v.items.map((it, i) => (
                  <div key={i} className="flex justify-between gap-3 py-2 text-xs">
                    <span className="truncate">
                      {it.description || "Item"} × {it.quantity || 0}
                    </span>
                    <span className="tabular">{money(Math.round((Number(it.quantity) || 0) * Math.round((Number(it.unit_amount) || 0) * 100)))}</span>
                  </div>
                ))}
              </div>
              <dl className="mt-3 space-y-1 text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular">{money(subtotal)}</dd>
                </div>
                {taxRate > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Tax ({taxRate}%)</dt>
                    <dd className="tabular">{money(tax)}</dd>
                  </div>
                )}
                <div className="flex justify-between pt-1 text-sm font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular">{money(subtotal + tax)}</dd>
                </div>
              </dl>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Saving creates a draft only. Nothing is sent to PayPal or the client until you press Send on the next screen.</p>
          </CardContent>
        </Card>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={saving}>
            {saving ? "Saving…" : invoiceId ? "Save draft" : "Create draft"}
          </Button>
        </div>
      </div>
    </form>
  );
}
