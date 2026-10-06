# Supabase persistence

The control-plane ledger is intentionally server-only.

## Live project

Dedicated project provisioned on 2026-10-06:

- Project name: `ai-control-plane`
- Project ref: `qfjbjpsdhlrgtcuejehh`
- Region: `us-east-1`
- Migration: `20261006175830_control_plane_ledger`

The source-controlled migration lives at `migrations/20261006175830_control_plane_ledger.sql` and mirrors the reviewed schema source in `schema/control_plane_ledger.sql`.

## Schema source

`schema/control_plane_ledger.sql` remains the reviewed SQL source for the ledger schema. `migrations/20261006175830_control_plane_ledger.sql` is the live migration artifact applied to the dedicated Supabase project.

When provisioning another Supabase environment:

1. Authenticate the Supabase CLI or MCP connection.
2. Link to the target project or create a development branch.
3. Apply `migrations/20261006175830_control_plane_ledger.sql` as a migration.
4. Run database smoke tests and Supabase security/performance advisors.
5. Confirm RLS, grants, and RPC ownership match this document before wiring runtime credentials.

## Access model

- `anon`: no table or RPC access
- `authenticated`: no table or RPC access
- `service_role`: run-table `SELECT`, evidence-table `SELECT`, and execute permission on the governed run-create, run-update, evidence-append, and approval RPCs
- direct `INSERT` and `UPDATE` on `control_plane_runs` are intentionally denied; run creation must use `create_control_plane_run`, lifecycle updates must use `update_control_plane_run`, and approval must use `approve_control_plane_run`
- direct `INSERT` on `control_plane_evidence` is intentionally denied; evidence writes must use `append_control_plane_evidence`
- no client RLS policies are created

## Run creation

The application calls `create_control_plane_run` to create a run. The function permits only the governed initial state: `planned`, attempt `0`, and revision `0`.

## Evidence append

Evidence must be associated with a positive, current build attempt and may be written only while a run is `building` or `verifying`.

The application calls `append_control_plane_evidence`, a `SECURITY DEFINER` function owned by `postgres` with an empty `search_path`. It locks the run row with `FOR UPDATE`, validates run state and attempt, inserts evidence, and increments the run revision in the same database operation.

## Approval

The application calls `approve_control_plane_run` to enter `approved`. This keeps approval ledger-owned: the database locks the current run row, evaluates current-attempt evidence, and advances the run state in one operation.

## SDK boundary

The repository exposes a narrow `SupabaseClientPort` plus a pinned `@supabase/supabase-js` adapter. Runtime composition should keep privileged Supabase credentials server-side and pass the SDK client through `createSupabaseRunLedgerClient()` or `adaptSupabaseRunLedgerClient()`.

## Live verification notes

After applying the live migration, verification confirmed:

- both ledger tables have RLS enabled;
- all four governed RPC functions are `SECURITY DEFINER` with `search_path = ''`;
- only `service_role` has ledger table `SELECT` and RPC `EXECUTE` grants;
- live smoke test passed create/build/evidence/verify/approve and cleaned up all smoke rows;
- security advisor reported `rls_enabled_no_policy` as informational for both tables, which is expected because this server-only ledger intentionally creates no client policies;
- performance advisor reported the new evidence indexes as unused, which is expected before production traffic.