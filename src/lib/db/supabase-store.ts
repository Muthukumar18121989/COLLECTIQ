import type { SupabaseClient } from "@supabase/supabase-js";
import type { TableName } from "@/lib/types";
import {
  type Filter,
  type ListOptions,
  type NewRow,
  type Row,
  type Store,
  NotFoundError,
  UniqueViolationError,
} from "./store";

function raise(table: string, error: { code?: string; message: string; details?: string | null }): never {
  if (error.code === "23505") {
    const key = /\((.+?)\)=/.exec(error.details ?? "")?.[1] ?? "unique";
    throw new UniqueViolationError(table, key);
  }
  throw new Error(`Database error on ${table}: ${error.message}`);
}

/**
 * Postgres-backed store. When constructed with a user-session client, Row Level
 * Security enforces ownership; the service-role client is only used by the
 * scheduler and webhook handler, which always add explicit user_id filters.
 */
export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  constructor(private readonly sb: SupabaseClient) {}

  async list<T extends TableName>(table: T, filter?: Filter<T>, opts?: ListOptions<T>) {
    let q = this.sb.from(table).select("*");
    if (filter) {
      const clean = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined));
      for (const [k, v] of Object.entries(clean)) {
        q = v === null ? q.is(k, null) : q.eq(k, v as string);
      }
    }
    if (opts?.orderBy) q = q.order(opts.orderBy, { ascending: opts.ascending !== false });
    if (opts?.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) raise(table, error);
    return (data ?? []) as Row<T>[];
  }

  async get<T extends TableName>(table: T, id: string) {
    const { data, error } = await this.sb.from(table).select("*").eq("id", id).maybeSingle();
    if (error) raise(table, error);
    return (data as Row<T>) ?? null;
  }

  async findOne<T extends TableName>(table: T, filter: Filter<T>) {
    const rows = await this.list(table, filter, { limit: 1 });
    return rows[0] ?? null;
  }

  async insert<T extends TableName>(table: T, row: NewRow<T>) {
    const { data, error } = await this.sb.from(table).insert(row).select("*").single();
    if (error) raise(table, error);
    return data as Row<T>;
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) {
    const { id: _ignored, created_at: _c, ...rest } = patch as Record<string, unknown>;
    void _ignored;
    void _c;
    const { data, error } = await this.sb
      .from(table)
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) raise(table, error);
    if (!data) throw new NotFoundError(`${table} ${id}`);
    return data as Row<T>;
  }

  async remove<T extends TableName>(table: T, id: string) {
    const { error } = await this.sb.from(table).delete().eq("id", id);
    if (error) raise(table, error);
  }
}
