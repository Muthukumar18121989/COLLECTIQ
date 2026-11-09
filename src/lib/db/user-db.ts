import type { Profile, TableName } from "@/lib/types";
import { type Filter, type ListOptions, type NewRow, type Row, type Store, NotFoundError } from "./store";

type OwnedTable = Exclude<TableName, "profiles">;
type OwnedNew<T extends OwnedTable> = Omit<NewRow<T>, "user_id">;

/**
 * A user-scoped view over a Store. Every read is filtered by user_id and every
 * write is stamped with it, so services cannot accidentally touch another
 * user's rows even when running with the service-role client.
 */
export class UserDb {
  constructor(public readonly store: Store, public readonly userId: string) {}

  list<T extends OwnedTable>(table: T, filter?: Filter<T>, opts?: ListOptions<T>): Promise<Row<T>[]> {
    return this.store.list(table, { ...(filter ?? {}), user_id: this.userId } as Filter<T>, opts);
  }

  async get<T extends OwnedTable>(table: T, id: string): Promise<Row<T> | null> {
    const row = await this.store.get(table, id);
    if (!row || (row as { user_id: string }).user_id !== this.userId) return null;
    return row;
  }

  async require<T extends OwnedTable>(table: T, id: string): Promise<Row<T>> {
    const row = await this.get(table, id);
    if (!row) throw new NotFoundError(`${table.replace(/_/g, " ")} ${id}`);
    return row;
  }

  findOne<T extends OwnedTable>(table: T, filter: Filter<T>): Promise<Row<T> | null> {
    return this.store.findOne(table, { ...filter, user_id: this.userId } as Filter<T>);
  }

  insert<T extends OwnedTable>(table: T, row: OwnedNew<T>): Promise<Row<T>> {
    return this.store.insert(table, { ...row, user_id: this.userId } as unknown as NewRow<T>);
  }

  async update<T extends OwnedTable>(table: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>> {
    await this.require(table, id);
    const { user_id: _u, ...rest } = patch as Record<string, unknown>;
    void _u;
    return this.store.update(table, id, rest as Partial<Row<T>>);
  }

  async remove<T extends OwnedTable>(table: T, id: string): Promise<void> {
    await this.require(table, id);
    await this.store.remove(table, id);
  }

  async profile(): Promise<Profile> {
    const p = await this.store.get("profiles", this.userId);
    if (!p) throw new NotFoundError("profile");
    return p;
  }

  updateProfile(patch: Partial<Profile>): Promise<Profile> {
    const { id: _i, ...rest } = patch;
    void _i;
    return this.store.update("profiles", this.userId, rest);
  }
}
