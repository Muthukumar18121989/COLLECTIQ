import type { Client } from "@/lib/types";

// Deterministic intent extraction used when Claude is not configured
// ("Demo AI" mode, clearly labelled in the UI) and as a test oracle. It maps a
// message to the same tool calls Claude would make. It never invents data: if a
// client or amount is missing it returns a clarifying question instead.

export type IntentKind =
  | "create_invoice"
  | "list_overdue"
  | "top_debtor"
  | "prepare_reminders"
  | "expected_income"
  | "pause_reminders"
  | "resume_reminders"
  | "due_this_week"
  | "explain_outstanding"
  | "send_invoice"
  | "list_invoices"
  | "summary"
  | "unknown";

export interface ParsedIntent {
  kind: IntentKind;
  client?: Client;
  clientCandidates?: Client[];
  requestedClientName?: string;
  amount?: number;
  currency?: string;
  description?: string;
  dueInDays?: number;
  dueDate?: string;
  invoiceNumber?: string;
  /** Present when the request cannot proceed without more information. */
  clarification?: string;
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, sixty: 60, ninety: 90,
};

function parseNumberWord(s: string): number | undefined {
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  return NUMBER_WORDS[s.toLowerCase()];
}

export function extractAmount(text: string): { amount?: number; currency?: string } {
  const m =
    /(?:(\$|€|£|usd|eur|gbp)\s?)([\d,]+(?:\.\d{1,2})?)/i.exec(text) ??
    /([\d,]+(?:\.\d{1,2})?)\s?(usd|eur|gbp|dollars|euros|pounds)\b/i.exec(text);
  if (!m) return {};
  const symbolFirst = /^[\d,]/.test(m[1]) === false;
  const raw = symbolFirst ? m[2] : m[1];
  const unit = (symbolFirst ? m[1] : m[2]).toLowerCase();
  const amount = Number(raw.replace(/,/g, ""));
  const currency = unit === "€" || unit.startsWith("eur") ? "EUR" : unit === "£" || unit === "gbp" || unit === "pounds" ? "GBP" : "USD";
  return Number.isFinite(amount) && amount > 0 ? { amount, currency } : {};
}

export function extractDue(text: string): { dueInDays?: number; dueDate?: string } {
  const iso = /due\s+(?:on\s+|by\s+)?(\d{4}-\d{2}-\d{2})/i.exec(text);
  if (iso) return { dueDate: iso[1] };
  const inDays = /(?:due\s+)?in\s+([a-z]+|\d+)\s+days?/i.exec(text);
  if (inDays) {
    const n = parseNumberWord(inDays[1]);
    if (n != null) return { dueInDays: n };
  }
  const weeks = /in\s+([a-z]+|\d+)\s+weeks?/i.exec(text);
  if (weeks) {
    const n = parseNumberWord(weeks[1]);
    if (n != null) return { dueInDays: n * 7 };
  }
  if (/due\s+(?:on\s+)?receipt|due\s+today/i.test(text)) return { dueInDays: 0 };
  return {};
}

/** Find clients mentioned in the text by full name, first name or company. */
export function matchClients(text: string, clients: Client[]): Client[] {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9@.\s'-]/g, " ")} `;
  const full = clients.filter((c) => t.includes(` ${c.name.toLowerCase()} `) || (c.company && t.includes(` ${c.company.toLowerCase()} `)));
  if (full.length) return full;
  return clients.filter((c) => {
    const first = c.name.split(/\s+/)[0]?.toLowerCase();
    return first && new RegExp(`\\b${first}('s)?\\b`).test(t);
  });
}

function requestedName(text: string): string | undefined {
  const m = /(?:for|to|bill|invoice)\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/.exec(text);
  return m?.[1];
}

function extractDescription(text: string): string | undefined {
  const m =
    /\bfor\s+(?:the\s+)?([a-z][a-z0-9 &/'-]{2,80}?)(?:\s+work)?(?:,|\.|\s+due\b|\s+in\s+\d|\s+by\b|$)/i.exec(
      text.replace(/^.*?(?:\$|usd|eur|gbp|€|£)\s?[\d,.]+\s*/i, ""),
    );
  if (!m) return undefined;
  const d = m[1].trim();
  return d.length > 0 ? d.charAt(0).toUpperCase() + d.slice(1) : undefined;
}

export function parseIntent(message: string, clients: Client[]): ParsedIntent {
  const text = message.trim();
  const lower = text.toLowerCase();
  const mentioned = matchClients(text, clients);
  const single = mentioned.length === 1 ? mentioned[0] : undefined;
  const invoiceNumber = /\b((?:CIQ|DEMO)-[A-Z0-9-]+)\b/i.exec(text)?.[1]?.toUpperCase();

  if (/\b(pause|stop|hold)\b.*\b(remind|chas|collect|follow)/.test(lower) || /\bpause\b.*\bfor\b/.test(lower)) {
    if (!single) return { kind: "pause_reminders", clientCandidates: mentioned, clarification: mentioned.length > 1 ? `Which client do you mean: ${mentioned.map((c) => c.name).join(" or ")}?` : "Which client should I pause reminders for? I couldn't match a saved client." };
    return { kind: "pause_reminders", client: single };
  }
  if (/\b(resume|restart|unpause|turn on)\b.*\b(remind|chas|collect)/.test(lower)) {
    if (!single) return { kind: "resume_reminders", clarification: "Which client should I resume reminders for?" };
    return { kind: "resume_reminders", client: single };
  }
  const wantsInvoice = /\b(create|make|draft|new|raise|prepare|send)\b.*\binvoice\b|\bbill\b/.test(lower) || /\b[Ii]nvoice\s+[A-Z]/.test(text);
  if (wantsInvoice && !/remind/.test(lower) && !(invoiceNumber && /\bsend\b/.test(lower))) {
    const { amount, currency } = extractAmount(text);
    const due = extractDue(text);
    const base: ParsedIntent = { kind: "create_invoice", amount, currency, description: extractDescription(text), ...due };
    if (!single) {
      const name = requestedName(text);
      return {
        ...base,
        requestedClientName: name,
        clientCandidates: mentioned,
        clarification:
          mentioned.length > 1
            ? `I found more than one matching client: ${mentioned.map((c) => c.name).join(", ")}. Which one?`
            : name
              ? `I don't have a client called "${name}" saved. Add them on the Clients page (name and email), then ask again. I won't create an invoice for a client that doesn't exist.`
              : "Who is the invoice for? Please name a saved client.",
      };
    }
    if (amount == null) return { ...base, client: single, clarification: `How much should the invoice to ${single.name} be for?` };
    if (!base.description) return { ...base, client: single, clarification: `What is the invoice to ${single.name} for? A short description of the work is needed for the line item.` };
    return { ...base, client: single };
  }
  if (/\bsend\b/.test(lower) && invoiceNumber && !/remind/.test(lower)) return { kind: "send_invoice", invoiceNumber };
  if (/\bremind/.test(lower) || /\bfollow[- ]?up/.test(lower) || /\bchase\b/.test(lower)) return { kind: "prepare_reminders", client: single, invoiceNumber };
  if (/\boverdue\b|\blate\b/.test(lower) && !/why|explain/.test(lower)) return { kind: "list_overdue", client: single };
  if (/\bowes?\b.*\bmost\b|\bhighest\b.*\bbalance\b|\bbiggest\b.*\b(debtor|balance)\b|\bwho owes\b/.test(lower)) return { kind: "top_debtor" };
  if (/\bdue\b.*\b(this|next) week\b|\bdue soon\b/.test(lower)) return { kind: "due_this_week" };
  if (/\b(why|explain)\b.*\b(outstanding|balance|receivable)/.test(lower)) return { kind: "explain_outstanding" };
  if (/\bexpect|\bincoming\b|\bcoming in\b|\bforecast\b/.test(lower)) return { kind: "expected_income" };
  if (/\b(show|list|find)\b.*\binvoices?\b/.test(lower)) return { kind: "list_invoices", client: single };
  if (/\bsummary\b|\bhow am i doing\b|\boutstanding\b|\bcash ?flow\b/.test(lower)) return { kind: "summary" };
  return { kind: "unknown" };
}
