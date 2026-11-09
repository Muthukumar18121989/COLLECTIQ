import type { TableMap, TableName } from "@/lib/types";

// A deliberately small persistence contract. Two implementations exist:
//  - SupabaseStore: Postgres via Supabase (production)
//  - MemoryStore:   a JSON-file store used only in clearly labelled demo mode and tests
// Business rules live in services, never in the store.

export type Row<T extends TableName> = TableMap[T];
export type Filter<T extends TableName> = Partial<Row<T>>;
export type NewRow<T extends TableName> = Omit<Row<T>, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

export interface ListOptions<T extends TableName> {
  orderBy?: keyof Row<T> & string;
  ascending?: boolean;
  limit?: number;
}

export interface Store {
  readonly kind: "supabase" | "memory";
  list<T extends TableName>(table: T, filter?: Filter<T>, opts?: ListOptions<T>): Promise<Row<T>[]>;
  get<T extends TableName>(table: T, id: string): Promise<Row<T> | null>;
  findOne<T extends TableName>(table: T, filter: Filter<T>): Promise<Row<T> | null>;
  insert<T extends TableName>(table: T, row: NewRow<T>): Promise<Row<T>>;
  update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>>;
  remove<T extends TableName>(table: T, id: string): Promise<void>;
}

/** Thrown when a unique constraint (idempotency key, webhook event id…) is violated. */
export class UniqueViolationError extends Error {
  constructor(public readonly table: string, public readonly key: string) {
    super(`Unique constraint violated on ${table}.${key}`);
    this.name = "UniqueViolationError";
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/** Unique columns enforced by both stores (mirrors the SQL migration). */
export const UNIQUE_KEYS: Partial<Record<TableName, string[]>> = {
  agent_tasks: ["idempotency_key"],
  webhook_events: ["paypal_event_id"],
};
