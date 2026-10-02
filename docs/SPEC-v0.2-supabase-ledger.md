# Spec: AI Control Plane v0.2 Supabase Run Ledger

## Objective

Add a durable Supabase-compatible implementation of the `RunLedger` port without coupling
core orchestration to Supabase APIs.

## Access model

The ledger is server-only. Browser/client roles must not be able to read or mutate control-plane
runs or evidence.

- RLS enabled on both tables.
- No `anon` or `authenticated` policies.
- Explicit grants are limited to the server role.
- Evidence is append-only through the application port.

## Data model

### `control_plane_runs`

Stores the current run snapshot:
- id
- objective
- lifecycle status
- acceptance criteria
- requested capabilities
- created/updated timestamps

### `control_plane_evidence`

Stores ordered verification evidence:
- generated id
- run id
- criterion id
- pass/fail status
- source
- detail
- timestamp

## Adapter boundary

`SupabaseRunLedger` accepts a structural `SupabaseClientLike` dependency. This keeps
`@supabase/supabase-js` out of the domain/core layer and lets the composition root create the
real client later.

## Testing

Unit tests use a deterministic in-memory fake with Supabase-shaped query semantics. They verify:

1. run round-trip mapping;
2. update semantics and missing-run rejection;
3. evidence append ordering;
4. RLS and explicit least-privilege SQL grants.

## Migration policy

The reviewed SQL lives under `supabase/schema/` until a dedicated project is provisioned.
The real migration must be generated with the Supabase CLI rather than inventing a migration
filename in the repository.

## Current Supabase constraints

Supabase now requires explicit Data API grants for newly created tables when automatic exposure
is disabled/default-off. RLS and grants are separate layers, so both are represented in the
schema source.

References:
- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/reference/javascript/installing
