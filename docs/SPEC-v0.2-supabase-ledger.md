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

The composition adapter binds pinned `@supabase/supabase-js` to this port through installed-SDK contract tests in `tests/supabase-js-client.test.mjs`.

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

Live project verification also confirmed RLS, function `SECURITY DEFINER` configuration, table/RPC grants, migration history, and the create/build/evidence/verify/approve path.

## Live deployment status

The dedicated Supabase project is provisioned and migrated:

- Project name: `ai-control-plane`
- Project ref: `qfjbjpsdhlrgtcuejehh`
- Region: `us-east-1`
- Migration: `20261006175830_control_plane_ledger`
- Source-controlled migration: `supabase/migrations/20261006175830_control_plane_ledger.sql`

Advisor notes after migration:

- `rls_enabled_no_policy` appears as informational for the two ledger tables. This is expected because the ledger is server-only and intentionally has no client policies.
- New evidence indexes appear as unused until production traffic exercises them.
- Auth connection strategy advisory is project-level and not caused by this ledger schema.

## Current Supabase references

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/reference/javascript/rpc
- https://supabase.com/docs/reference/javascript/installing