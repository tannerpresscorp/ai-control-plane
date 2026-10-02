# Supabase persistence

The control-plane ledger is intentionally server-only.

## Schema source

`schema/control_plane_ledger.sql` is the reviewed SQL source for the ledger schema. It is **not** a generated migration file.

When the dedicated Supabase project is provisioned:

1. Authenticate the Supabase CLI.
2. Link the repository to the new project.
3. Create the migration with `supabase migration new control_plane_ledger`.
4. Copy the reviewed schema SQL into that generated migration.
5. Apply it in a non-production environment first.
6. Run database tests and Supabase security/performance advisors.
7. Commit the generated migration and migration metadata.

## Access model

- `anon`: no table or RPC access
- `authenticated`: no table or RPC access
- `service_role`: minimum run/evidence table grants plus execute permission on the evidence RPC
- no client RLS policies are created

## Evidence append

Evidence must be associated with a positive, current build attempt. The application calls `append_control_plane_evidence`, which locks the run row with `FOR UPDATE`, validates the current attempt, and inserts the evidence in the same database operation.

## SDK boundary

The repository currently exposes a narrow `SupabaseClientPort`; it does not claim direct type compatibility with `@supabase/supabase-js`. Direct binding requires a pinned package version, committed lockfile, and an actual SDK contract test.
