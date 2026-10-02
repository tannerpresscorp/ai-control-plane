# Spec: AI Control Plane v0.2 Supabase Run Ledger

## Objective

Add a durable Supabase persistence boundary for the `RunLedger` port without coupling core orchestration to a specific client-library class.

## Access model

The ledger is server-only. Browser/client roles must not be able to read or mutate control-plane runs or evidence.

- RLS enabled on both tables.
- No `anon` or `authenticated` policies.
- Explicit grants are limited to `service_role`.
- Evidence is append-only through the application port.
- Evidence append validates the active build attempt atomically inside Postgres.

## Data model

### `control_plane_runs`

Stores the current run snapshot:

- id
- objective
- lifecycle status
- acceptance criteria
- requested capabilities
- build attempt
- optimistic revision
- created/updated timestamps

### `control_plane_evidence`

Stores ordered verification evidence:

- generated id
- run id
- build attempt
- criterion id
- pass/fail status
- source
- detail
- timestamp

## Adapter boundary

`SupabaseRunLedger` accepts a narrow `SupabaseClientPort`. The port is intentionally not claimed to be the exported `@supabase/supabase-js` client type.

A later composition adapter must bind a pinned `@supabase/supabase-js` version to this port and include an actual SDK type/runtime contract test before direct compatibility is claimed.

## Atomic evidence append

`appendEvidence()` calls the `append_control_plane_evidence` Postgres RPC. The function:

1. requires a positive attempt;
2. locks the run row with `FOR UPDATE`;
3. compares the requested attempt with the run's current attempt;
4. inserts evidence only when they match.

This makes attempt validation and persistence one database operation and removes the client-side time-of-check/time-of-use race.

## Pagination

Evidence reads advance by the number of rows actually returned and stop only on an empty page. This remains correct when the Supabase Data API maximum is configured below the requested range size.

## Testing

Unit tests verify:

1. run round-trip mapping;
2. optimistic update semantics;
3. positive attempt enforcement;
4. evidence pagination under a lower server row cap;
5. the atomic RPC, row lock, RLS, and least-privilege SQL grants.

## Migration policy

The reviewed SQL lives under `supabase/schema/` until a dedicated project is provisioned. The real migration must be generated with the Supabase CLI rather than inventing a migration filename in the repository.

## Current Supabase references

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/reference/javascript/rpc
- https://supabase.com/docs/reference/javascript/installing
