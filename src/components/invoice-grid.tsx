"use client";

import { AllCommunityModule, type ColDef, ModuleRegistry, themeQuartz } from "ag-grid-community";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { InvoiceStatusBadge, PayPalModeBadge, invoiceStatusLabel } from "@/components/status";
import { Input } from "@/components/ui/primitives";
import type { InvoiceStatus, PayPalMode } from "@/lib/types";
import { cn } from "@/lib/utils";

ModuleRegistry.registerModules([AllCommunityModule]);

export interface InvoiceRow {
  id: string;
  number: string;
  client: string;
  clientId: string;
  project: string;
  totalCents: number;
  dueCents: number;
  currency: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  policy: string;
  paused: boolean;
  paypalMode: PayPalMode | null;
  isDemo: boolean;
}

const theme = themeQuartz.withParams({
  backgroundColor: "var(--card)",
  foregroundColor: "var(--foreground)",
  borderColor: "var(--border)",
  headerBackgroundColor: "var(--muted)",
  headerTextColor: "var(--muted-foreground)",
  accentColor: "var(--primary)",
  oddRowBackgroundColor: "var(--card)",
  rowHoverColor: "var(--muted)",
  fontFamily: "inherit",
  fontSize: 13,
  headerFontSize: 12,
  wrapperBorderRadius: 14,
  rowHeight: 48,
  headerHeight: 40,
});

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const date = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function NumberCell(p: CustomCellRendererProps<InvoiceRow>) {
  if (!p.data) return null;
  return (
    <Link href={`/invoices/${p.data.id}`} className="font-medium text-primary hover:underline">
      {p.data.number}
    </Link>
  );
}
function StatusCell(p: CustomCellRendererProps<InvoiceRow>) {
  return p.data ? <InvoiceStatusBadge status={p.data.status} /> : null;
}
function PolicyCell(p: CustomCellRendererProps<InvoiceRow>) {
  if (!p.data) return null;
  return (
    <span className={cn("text-xs", p.data.paused ? "text-warning" : "text-muted-foreground")}>
      {p.data.paused ? "Paused" : p.data.policy}
    </span>
  );
}
function PayPalCell(p: CustomCellRendererProps<InvoiceRow>) {
  if (!p.data) return null;
  return p.data.paypalMode ? <PayPalModeBadge mode={p.data.paypalMode} /> : <span className="text-xs text-muted-foreground">Not sent</span>;
}
function ActionsCell(p: CustomCellRendererProps<InvoiceRow>) {
  if (!p.data) return null;
  const label = p.data.status === "draft" ? "Review & send" : ["overdue", "sent", "unpaid", "partially_paid"].includes(p.data.status) ? "Remind / manage" : "View";
  return (
    <Link href={`/invoices/${p.data.id}`} className="text-xs font-medium text-foreground underline-offset-2 hover:underline">
      {label}
    </Link>
  );
}

const FILTERS: Array<{ key: string; label: string; match: (s: InvoiceStatus) => boolean }> = [
  { key: "all", label: "All", match: () => true },
  { key: "open", label: "Open", match: (s) => ["sent", "unpaid", "partially_paid", "overdue"].includes(s) },
  { key: "overdue", label: "Overdue", match: (s) => s === "overdue" },
  { key: "draft", label: "Drafts", match: (s) => s === "draft" },
  { key: "paid", label: "Paid", match: (s) => s === "paid" },
  { key: "cancelled", label: "Cancelled", match: (s) => s === "cancelled" || s === "refunded" },
];

export function InvoiceGrid({ rows, initialFilter = "all" }: { rows: InvoiceRow[]; initialFilter?: string }) {
  const [quick, setQuick] = useState("");
  const [filter, setFilter] = useState(FILTERS.some((f) => f.key === initialFilter) ? initialFilter : "all");
  const visible = useMemo(() => rows.filter((r) => FILTERS.find((f) => f.key === filter)!.match(r.status)), [rows, filter]);

  const cols = useMemo<ColDef<InvoiceRow>[]>(
    () => [
      { field: "number", headerName: "Invoice", cellRenderer: NumberCell, minWidth: 150, pinned: "left" },
      { field: "client", headerName: "Client", minWidth: 140, flex: 1 },
      { field: "project", headerName: "Project", minWidth: 150, flex: 1 },
      {
        field: "totalCents",
        headerName: "Amount",
        type: "rightAligned",
        minWidth: 120,
        valueFormatter: (p) => (p.data ? money(p.data.totalCents, p.data.currency) : ""),
        cellClass: "tabular ag-right-aligned-cell",
      },
      {
        field: "dueCents",
        headerName: "Balance due",
        type: "rightAligned",
        minWidth: 120,
        valueFormatter: (p) => (p.data ? money(p.data.dueCents, p.data.currency) : ""),
        cellClass: "tabular ag-right-aligned-cell",
      },
      { field: "currency", headerName: "Currency", width: 100 },
      { field: "issueDate", headerName: "Issued", minWidth: 120, valueFormatter: (p) => (p.value ? date(p.value) : "") },
      { field: "dueDate", headerName: "Due", minWidth: 120, sort: "asc", valueFormatter: (p) => (p.value ? date(p.value) : "") },
      { field: "status", headerName: "Status", minWidth: 130, cellRenderer: StatusCell, filterValueGetter: (p) => (p.data ? invoiceStatusLabel(p.data.status) : "") },
      { field: "policy", headerName: "Collection policy", minWidth: 160, cellRenderer: PolicyCell },
      { field: "paypalMode", headerName: "PayPal", minWidth: 150, cellRenderer: PayPalCell },
      { headerName: "Actions", minWidth: 140, cellRenderer: ActionsCell, sortable: false, filter: false },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter invoices by status">
          {FILTERS.map((f) => {
            const count = rows.filter((r) => f.match(r.status)).length;
            return (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-[10px] border px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === f.key ? "border-primary bg-primary-soft text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label} <span className="ml-0.5 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="relative sm:ml-auto sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Search invoices, clients, projects" className="pl-9" aria-label="Search invoices" />
        </div>
      </div>
      <div className="w-full">
        <AgGridReact<InvoiceRow>
          theme={theme}
          rowData={visible}
          columnDefs={cols}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          quickFilterText={quick}
          domLayout="autoHeight"
          pagination
          paginationPageSize={20}
          paginationPageSizeSelector={[20, 50, 100]}
          overlayNoRowsTemplate="<span style='font-size:13px;color:var(--muted-foreground)'>No invoices match.</span>"
          getRowId={(p) => p.data.id}
        />
      </div>
    </div>
  );
}
