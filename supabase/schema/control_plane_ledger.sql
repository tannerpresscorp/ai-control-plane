create table if not exists public.control_plane_runs (
  id text primary key,
  objective text not null,
  status text not null check (
    status in ('planned', 'building', 'verifying', 'approved', 'completed', 'failed')
  ),
  acceptance_criteria jsonb not null default '[]'::jsonb
    check (jsonb_typeof(acceptance_criteria) = 'array'),
  requested_capabilities jsonb not null default '[]'::jsonb
    check (jsonb_typeof(requested_capabilities) = 'array'),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.control_plane_evidence (
  id bigint generated always as identity primary key,
  run_id text not null
    references public.control_plane_runs(id)
    on delete cascade,
  criterion_id text not null,
  status text not null check (status in ('pass', 'fail')),
  source text not null,
  detail text not null,
  created_at timestamptz not null default now()
);

create index if not exists control_plane_evidence_run_id_id_idx
  on public.control_plane_evidence (run_id, id);

alter table public.control_plane_runs enable row level security;
alter table public.control_plane_evidence enable row level security;

revoke all on table public.control_plane_runs from anon, authenticated;
revoke all on table public.control_plane_evidence from anon, authenticated;
revoke all on sequence public.control_plane_evidence_id_seq from anon, authenticated;

grant select, insert, update on table public.control_plane_runs to service_role;
grant select, insert on table public.control_plane_evidence to service_role;
grant usage, select on sequence public.control_plane_evidence_id_seq to service_role;

comment on table public.control_plane_runs is
  'Server-only control-plane run ledger. No client RLS policies by design.';

comment on table public.control_plane_evidence is
  'Append-only server evidence for control-plane verification.';
