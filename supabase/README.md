# Supabase persistence

The control-plane ledger is intentionally server-only.

## Schema source

`schema/control_plane_ledger.sql` is the reviewed SQL source for the first ledger schema.
It is **not** a generated migration file.

When the dedicated Supabase project is provisioned:

1. Authenticate the Supabase CLI.
2. Link the repository to the new project.
3. Create the migration with `supabase migration new control_plane_ledger`.
4. Copy the reviewed schema SQL into that generated migration.
5. Apply it in a non-production environment first.
6. Run database tests and Supabase security/performance advisors.
7. Commit the generated migration and migration metadata.

## Access model

- `anon`: no access
- `authenticated`: no access
- server secret / `service_role`: minimum table/sequence grants required by the ledger adapter
- no client RLS policies are created

This keeps the ledger out of the application-facing Data API while still enabling RLS as defense in depth.
