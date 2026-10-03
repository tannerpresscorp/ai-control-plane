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
- `service_role`: run-table `SELECT`/`INSERT`, evidence-table `SELECT`, and execute permission on the governed run-update, evidence-append, and approval RPCs
- direct `UPDATE` on `control_plane_runs` is intentionally denied; lifecycle updates must use `update_control_plane_run`
- direct `INSERT` on `control_plane_evidence` is intentionally denied; evidence writes must use `append_control_plane_evidence`
- no client RLS policies are created

## Evidence append

Evidence must be associated with a positive, current build attempt and may be written only while a run is `building` or `verifying`.

The application calls `append_control_plane_evidence`, a `SECURITY DEFINER` function owned by `postgres` with an empty `search_path`. It locks the run row with `FOR UPDATE`, validates run state and attempt, inserts evidence, and increments the run revision in the same database operation.

## Approval

The application calls `approve_control_plane_run` to enter `approved`. This keeps approval ledger-owned: the database locks the current run row, evaluates current-attempt evidence, and advances the run state in one operation.

## SDK boundary

The repository currently exposes a narrow `SupabaseClientPort`; it does not claim direct type compatibility with `@supabase/supabase-js`. Direct binding requires a pinned package version, committed lockfile, and an actual SDK contract test.
