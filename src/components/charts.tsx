"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const fmt = (currency: string) => (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--foreground)",
};

export function ReceivablesChart({ data, currency }: { data: Array<{ month: string; collected: number; invoiced: number }>; currency: string }) {
  const f = fmt(currency);
  const empty = data.every((d) => d.collected === 0 && d.invoiced === 0);
  if (empty) return <p className="py-16 text-center text-xs text-muted-foreground">No invoices issued in the last six months yet.</p>;
  return (
    <div className="h-64" role="img" aria-label="Invoiced versus collected by month">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={4} margin={{ left: 4, right: 4, top: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
          <YAxis tickFormatter={f} tickLine={false} axisLine={false} fontSize={11} width={64} stroke="var(--muted-foreground)" />
          <Tooltip formatter={(v) => f(Number(v))} labelFormatter={(l) => monthLabel(String(l))} contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="invoiced" name="Invoiced" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="collected" name="Collected" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const AGING_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function AgingChart({ data, currency }: { data: Array<{ label: string; cents: number; count: number }>; currency: string }) {
  const f = fmt(currency);
  return (
    <div className="h-56" role="img" aria-label="Outstanding balance by days overdue">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={80} tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
          <Tooltip formatter={(v, _n, p) => [`${f(Number(v))} · ${(p.payload as { count: number }).count} invoice(s)`, "Outstanding"]} contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="cents" radius={[0, 4, 4, 0]} maxBarSize={22}>
            {data.map((_, i) => (
              <Cell key={i} fill={AGING_COLORS[i]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ClientContributionChart({ data, currency }: { data: Array<{ name: string; collected: number; outstanding: number }>; currency: string }) {
  const f = fmt(currency);
  return (
    <div style={{ height: Math.max(160, data.length * 44) }} role="img" aria-label="Collected and outstanding by client">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }} barGap={2}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
          <Tooltip formatter={(v) => f(Number(v))} contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="collected" name="Collected" stackId="a" fill="var(--chart-1)" maxBarSize={18} />
          <Bar dataKey="outstanding" name="Outstanding" stackId="a" fill="var(--chart-3)" radius={[0, 4, 4, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
