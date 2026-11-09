import fs from "node:fs";
import path from "node:path";
import type { TableName } from "@/lib/types";
import {
  type Filter,
  type ListOptions,
  type NewRow,
  type Row,
  type Store,
  NotFoundError,
  UNIQUE_KEYS,
  UniqueViolationError,
} from "./store";

type Tables = { [K in TableName]: Row<K>[] };

const EMPTY: () => Tables = () => ({
  profiles: [],
  clients: [],
  projects: [],
  invoices: [],
  invoice_items: [],
  collection_policies: [],
  agent_tasks: [],
  agent_activity: [],
  approvals: [],
  webhook_events: [],
  conversations: [],
  conversation_messages: [],
});

function matches<T extends TableName>(row: Row<T>, filter?: Filter<T>): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(
    ([k, v]) => v === undefined || (row as unknown as Record<string, unknown>)[k] === v,
  );
}

/**
 * Demo-mode store. Data lives in memory and (optionally) in a local JSON file so
 * it survives dev-server restarts. It is never used when Supabase is configured.
 */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private tables: Tables;

  constructor(private readonly file: string | null = null) {
    this.tables = EMPTY();
    if (file && fs.existsSync(/*turbopackIgnore: true*/ file)) {
      try {
        this.tables = { ...EMPTY(), ...JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")) };
      } catch {
        this.tables = EMPTY();
      }
    }
  }

  private persist() {
    if (!this.file) return;
    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(this.file), { recursive: true });
    fs.writeFileSync(/*turbopackIgnore: true*/ this.file, JSON.stringify(this.tables));
  }

  reset() {
    this.tables = EMPTY();
    this.persist();
  }

  async list<T extends TableName>(table: T, filter?: Filter<T>, opts?: ListOptions<T>) {
    let rows = (this.tables[table] as Row<T>[]).filter((r) => matches(r, filter));
    if (opts?.orderBy) {
      const key = opts.orderBy;
      const dir = opts.ascending === false ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        const av = a[key] as unknown as string | number;
        const bv = b[key] as unknown as string | number;
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }
    if (opts?.limit) rows = rows.slice(0, opts.limit);
    return structuredClone(rows);
  }

  async get<T extends TableName>(table: T, id: string) {
    const row = (this.tables[table] as Row<T>[]).find((r) => (r as { id: string }).id === id);
    return row ? structuredClone(row) : null;
  }

  async findOne<T extends TableName>(table: T, filter: Filter<T>) {
    const row = (this.tables[table] as Row<T>[]).find((r) => matches(r, filter));
    return row ? structuredClone(row) : null;
  }

  async insert<T extends TableName>(table: T, row: NewRow<T>) {
    const now = new Date().toISOString();
    const full = {
      ...row,
      id: row.id ?? crypto.randomUUID(),
      created_at: (row as { created_at?: string }).created_at ?? now,
      updated_at: now,
    } as unknown as Row<T>;
    const rows = this.tables[table] as Row<T>[];
    for (const key of UNIQUE_KEYS[table] ?? []) {
      const val = (full as unknown as Record<string, unknown>)[key];
      if (val != null && rows.some((r) => (r as unknown as Record<string, unknown>)[key] === val)) {
        throw new UniqueViolationError(table, key);
      }
    }
    if (rows.some((r) => (r as { id: string }).id === (full as { id: string }).id)) {
      throw new UniqueViolationError(table, "id");
    }
    rows.push(full);
    this.persist();
    return structuredClone(full);
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) {
    const rows = this.tables[table] as Row<T>[];
    const idx = rows.findIndex((r) => (r as { id: string }).id === id);
    if (idx < 0) throw new NotFoundError(`${table} ${id}`);
    const { id: _ignored, ...rest } = patch as Record<string, unknown>;
    void _ignored;
    rows[idx] = { ...rows[idx], ...rest, updated_at: new Date().toISOString() } as Row<T>;
    this.persist();
    return structuredClone(rows[idx]);
  }

  async remove<T extends TableName>(table: T, id: string) {
    const rows = this.tables[table] as Row<T>[];
    const idx = rows.findIndex((r) => (r as { id: string }).id === id);
    if (idx >= 0) rows.splice(idx, 1);
    this.persist();
  }
}
