import type { SupabaseClientLike } from '../../src/ledger/supabase-run-ledger.js';

type Response<T> =
  | { data: T; error: null }
  | { data: null; error: { message: string } };

type Thenable<T> = PromiseLike<Response<T>>;

type RealishFilter = {
  eq(column: string, value: unknown): RealishFilter;
  select(columns?: string): RealishFilter;
  maybeSingle(): Thenable<Record<string, unknown>>;
  order(column: string, options: { ascending: boolean }): RealishFilter;
  range(from: number, to: number): Thenable<Record<string, unknown>[]>;
};

type RealishTable = {
  insert(value: unknown): Thenable<unknown>;
  select(columns?: string): RealishFilter;
  update(value: unknown): RealishFilter;
};

declare const realishClient: { from(table: string): RealishTable };
const compatible: SupabaseClientLike = realishClient;
void compatible;
