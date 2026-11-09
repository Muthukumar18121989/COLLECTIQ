import { addDays, daysBetween, monthKey, todayISO } from "@/lib/dates";
import type { Client, Invoice, InvoiceStatus } from "@/lib/types";

// All dashboard numbers are computed here from persisted invoice rows. Nothing
// is estimated except where explicitly labelled (expected = due dates of open
// invoices, which are not a promise to pay).

const OPEN = new Set<InvoiceStatus>(["sent", "unpaid", "partially_paid", "overdue"]);

export function effectiveStatus(inv: Pick<Invoice, "status" | "due_date" | "amount_due_cents">, today = todayISO()): InvoiceStatus {
  if ((inv.status === "sent" || inv.status === "unpaid") && inv.due_date < today && inv.amount_due_cents > 0) {
    return "overdue";
  }
  return inv.status;
}

export function isOpen(inv: Invoice) {
  return OPEN.has(inv.status) && inv.amount_due_cents > 0;
}

export type AgingBucket = "current" | "1-7" | "8-14" | "15-30" | "30+";
export const AGING_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  "1-7": "1–7 days",
  "8-14": "8–14 days",
  "15-30": "15–30 days",
  "30+": "30+ days",
};

export function agingBucket(dueDate: string, today: string): AgingBucket {
  const d = daysBetween(dueDate, today);
  if (d <= 0) return "current";
  if (d <= 7) return "1-7";
  if (d <= 14) return "8-14";
  if (d <= 30) return "15-30";
  return "30+";
}

export interface Summary {
  currency: string;
  outstandingCents: number;
  outstandingCount: number;
  overdueCents: number;
  overdueCount: number;
  collectedThisMonthCents: number;
  expectedNext30Cents: number;
  expectedNext30Count: number;
  collectionRate: number | null;
  activeClients: number;
  attentionCount: number;
  aging: Record<AgingBucket, { cents: number; count: number }>;
  monthly: Array<{ month: string; collected: number; invoiced: number }>;
  byClient: Array<{ clientId: string; name: string; outstanding: number; overdue: number; collected: number; invoiced: number }>;
  upcoming: Invoice[];
  hasDemoData: boolean;
}

export function computeSummary(invoices: Invoice[], clients: Client[], now = new Date(), currency = "USD"): Summary {
  const today = todayISO(now);
  const thisMonth = monthKey(today);
  const inCurrency = invoices.filter((i) => i.currency === currency);
  const open = inCurrency.filter(isOpen);
  const overdue = open.filter((i) => i.due_date < today);

  const aging: Summary["aging"] = {
    current: { cents: 0, count: 0 },
    "1-7": { cents: 0, count: 0 },
    "8-14": { cents: 0, count: 0 },
    "15-30": { cents: 0, count: 0 },
    "30+": { cents: 0, count: 0 },
  };
  for (const i of open) {
    const b = agingBucket(i.due_date, today);
    aging[b].cents += i.amount_due_cents;
    aging[b].count += 1;
  }

  const horizon = addDays(today, 30);
  const expected = open.filter((i) => i.due_date >= today && i.due_date <= horizon);

  const collectedThisMonth = inCurrency
    .filter((i) => i.paid_at && monthKey(i.paid_at) === thisMonth)
    .reduce((s, i) => s + i.amount_paid_cents, 0);

  // Collection rate: of invoices whose due date has passed (and were issued),
  // how much of the billed value has been collected.
  const matured = inCurrency.filter((i) => i.status !== "draft" && i.status !== "cancelled" && i.due_date < today);
  const maturedTotal = matured.reduce((s, i) => s + i.total_cents, 0);
  const maturedPaid = matured.reduce((s, i) => s + i.amount_paid_cents, 0);

  const months: string[] = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - k);
    months.push(d.toISOString().slice(0, 7));
  }
  const monthly = months.map((m) => ({
    month: m,
    collected: inCurrency.filter((i) => i.paid_at && monthKey(i.paid_at) === m).reduce((s, i) => s + i.amount_paid_cents, 0),
    invoiced: inCurrency
      .filter((i) => i.status !== "draft" && i.status !== "cancelled" && monthKey(i.issue_date) === m)
      .reduce((s, i) => s + i.total_cents, 0),
  }));

  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const byClientMap = new Map<string, Summary["byClient"][number]>();
  for (const i of inCurrency) {
    if (i.status === "draft" || i.status === "cancelled") continue;
    const row =
      byClientMap.get(i.client_id) ??
      { clientId: i.client_id, name: clientName.get(i.client_id) ?? "Unknown client", outstanding: 0, overdue: 0, collected: 0, invoiced: 0 };
    row.invoiced += i.total_cents;
    row.collected += i.amount_paid_cents;
    if (isOpen(i)) {
      row.outstanding += i.amount_due_cents;
      if (i.due_date < today) row.overdue += i.amount_due_cents;
    }
    byClientMap.set(i.client_id, row);
  }

  const activeClientIds = new Set(open.map((i) => i.client_id));

  return {
    currency,
    outstandingCents: open.reduce((s, i) => s + i.amount_due_cents, 0),
    outstandingCount: open.length,
    overdueCents: overdue.reduce((s, i) => s + i.amount_due_cents, 0),
    overdueCount: overdue.length,
    collectedThisMonthCents: collectedThisMonth,
    expectedNext30Cents: expected.reduce((s, i) => s + i.amount_due_cents, 0),
    expectedNext30Count: expected.length,
    collectionRate: maturedTotal > 0 ? maturedPaid / maturedTotal : null,
    activeClients: activeClientIds.size,
    attentionCount: overdue.length,
    aging,
    monthly,
    byClient: [...byClientMap.values()].sort((a, b) => b.outstanding - a.outstanding),
    upcoming: open.filter((i) => i.due_date >= today).sort((a, b) => a.due_date.localeCompare(b.due_date)),
    hasDemoData: invoices.some((i) => i.is_demo),
  };
}

/** A factual, template-based summary used when Claude is not configured and as grounding for Claude. */
export function factualSummary(s: Summary, fmt: (c: number) => string): string {
  const parts: string[] = [];
  parts.push(`You currently have ${fmt(s.outstandingCents)} outstanding across ${s.outstandingCount} invoice${s.outstandingCount === 1 ? "" : "s"}.`);
  if (s.overdueCount > 0) parts.push(`${s.overdueCount} ${s.overdueCount === 1 ? "is" : "are"} overdue, totalling ${fmt(s.overdueCents)}.`);
  else parts.push("Nothing is overdue.");
  const top = s.byClient.find((c) => c.outstanding > 0);
  if (top) parts.push(`Your highest outstanding client balance is ${top.name} at ${fmt(top.outstanding)}.`);
  if (s.expectedNext30Count > 0) {
    parts.push(`${fmt(s.expectedNext30Cents)} across ${s.expectedNext30Count} invoice${s.expectedNext30Count === 1 ? "" : "s"} falls due in the next 30 days (due dates, not confirmed payments).`);
  }
  parts.push(`Collected this month: ${fmt(s.collectedThisMonthCents)}.`);
  return parts.join(" ");
}
