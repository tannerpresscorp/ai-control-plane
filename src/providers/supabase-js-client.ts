import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseClientPort } from '../ledger/supabase-run-ledger.js';

export type SupabaseRunLedgerClientOptions = {
  readonly auth?: unknown;
  readonly db?: unknown;
  readonly global?: {
    readonly fetch?: unknown;
    readonly headers?: Readonly<Record<string, string>>;
  };
  readonly realtime?: unknown;
};

export type SupabaseRunLedgerSdkClient = Pick<SupabaseClient, 'from' | 'rpc'>;

type SupabaseTablePort = ReturnType<SupabaseClientPort['from']>;
type SupabaseRpcPort = ReturnType<SupabaseClientPort['rpc']>;

type ShallowSupabaseSdkClient = {
  from(table: string): unknown;
  rpc(name: string, args: Readonly<Record<string, unknown>>): unknown;
};

type CreateSupabaseSdkClient = (
  supabaseUrl: string,
  supabaseKey: string,
  options?: SupabaseRunLedgerClientOptions
) => SupabaseRunLedgerSdkClient;

const createSupabaseSdkClient = createClient as unknown as CreateSupabaseSdkClient;

export function adaptSupabaseRunLedgerClient(client: SupabaseRunLedgerSdkClient): SupabaseClientPort {
  const sdk = client as unknown as ShallowSupabaseSdkClient;
  return {
    from(table) {
      return sdk.from(table) as SupabaseTablePort;
    },
    rpc(name, args) {
      return sdk.rpc(name, args) as SupabaseRpcPort;
    }
  };
}

export function createSupabaseRunLedgerClient(
  supabaseUrl: string,
  supabaseKey: string,
  options?: SupabaseRunLedgerClientOptions
): SupabaseClientPort {
  return adaptSupabaseRunLedgerClient(createSupabaseSdkClient(supabaseUrl, supabaseKey, options));
}
