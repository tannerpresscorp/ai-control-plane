# Spec: AI Control Plane v0.2 Supabase Run Ledger

## Objective

Add a durable Supabase persistence boundary for the `RunLedger` port without coupling core orchestration to a specific client-library class.

## Access model

The ledger is server-only. Browser/client roles must not be able to read or mutate control-plane runs or evidence.

- RLS enabled on both tables.
- No `anon` or `authenticated` policies.
- `service_role` can read evidence but cannot insert directly into the evidence table.
- Evidence writes are exposed only through the atomic `append_control_plane_evidence` RPC.
- Evidence may be appended only while the run is `building` or `verifying`.

## Adapter boundary

`SupabaseRunLedger` accepts a narrow `SupabaseClientPort`. The port is intentionally not claimed to be the exported `@supabase/supabase-js` client type.

A later composition adapter must bind a pinned `@supabase/supabase-js` version to this port and include an actual SDK type/runtime contract test before direct compatibility is claimed.

## Atomic evidence append

`appendEvidence()` calls the `append_control_plane_evidence` Postgres RPC. The function:

1. runs as a tightly scoped `SECURITY DEFINER` function owned by `postgres`;
2. uses an empty `search_path` and fully qualified object names;
3. locks the run row with `FOR UPDATE`;
4. requires the run to be `building` or `verifying`;
5. requires a positive attempt matching the run's current attempt;
6. inserts the evidence;
7. increments the run revision in the same transaction.

Because `service_role` has no direct evidence-table `INSERT` grant, application writes cannot bypass those invariants through the normal server client.

## Pagination

Evidence reads advance by the number of rows actually returned and stop only on an empty page. This remains correct when the Supabase Data API maximum is configured below the requested range size.

## Verification

Unit tests cover optimistic updates, positive attempt enforcement, governed run states, capped pagination, revision invalidation, and the RPC-only SQL privilege boundary.

## Migration policy

The reviewed SQL lives under `supabase/schema/` until a dedicated project is provisioned. The real migration must be generated with the Supabase CLI, applied first in a non-production project, and followed by Supabase security/performance advisors.

## Current Supabase references

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/reference/javascript/rpc
- https://supabase.com/docs/reference/javascript/installing
