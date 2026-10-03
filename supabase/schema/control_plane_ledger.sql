create table if not exists public.control_plane_runs (
  id text primary key,
  objective text not null,
  status text not null check (
    status in ('planned', 'building', 'verifying', 'approved', 'completed', 'failed')
  ),
  acceptance_criteria jsonb not null
    check (
      jsonb_typeof(acceptance_criteria) = 'array'
      and jsonb_array_length(acceptance_criteria) > 0
      and not jsonb_path_exists(
        acceptance_criteria,
        '$[*] ? (@.type() != "string" || @ like_regex "^\\s*$")'
      )
    ),
  requested_capabilities jsonb not null default '[]'::jsonb
    check (jsonb_typeof(requested_capabilities) = 'array'),
  attempt integer not null default 0 check (attempt >= 0),
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.control_plane_evidence (
  id bigint generated always as identity primary key,
  run_id text not null
    references public.control_plane_runs(id)
    on delete cascade,
  attempt integer not null check (attempt > 0),
  criterion_id text not null,
  status text not null check (status in ('pass', 'fail')),
  source text not null,
  detail text not null,
  created_at timestamptz not null default now()
);

create index if not exists control_plane_evidence_run_attempt_id_idx
  on public.control_plane_evidence (run_id, attempt, id);

create or replace function public.append_control_plane_evidence(
  p_run_id text,
  p_attempt integer,
  p_criterion_id text,
  p_status text,
  p_source text,
  p_detail text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_attempt integer;
  current_status text;
begin
  if p_attempt <= 0 then
    raise exception 'Evidence attempt must be positive'
      using errcode = '23514';
  end if;

  select attempt, status
    into current_attempt, current_status
    from public.control_plane_runs
    where id = p_run_id
    for update;

  if not found then
    raise exception 'Run not found: %', p_run_id
      using errcode = 'P0002';
  end if;

  if current_status not in ('building', 'verifying') then
    raise exception 'Evidence can only be appended while run is building or verifying'
      using errcode = '23514';
  end if;

  if current_attempt <> p_attempt then
    raise exception 'Evidence attempt mismatch for run %: expected %, got %',
      p_run_id, current_attempt, p_attempt
      using errcode = '23514';
  end if;

  insert into public.control_plane_evidence (
    run_id,
    attempt,
    criterion_id,
    status,
    source,
    detail
  ) values (
    p_run_id,
    p_attempt,
    p_criterion_id,
    p_status,
    p_source,
    p_detail
  );

  update public.control_plane_runs
    set revision = revision + 1
    where id = p_run_id;
end;
$$;

alter function public.append_control_plane_evidence(text, integer, text, text, text, text)
  owner to postgres;

alter table public.control_plane_runs enable row level security;
alter table public.control_plane_evidence enable row level security;

revoke all on table public.control_plane_runs from anon, authenticated, service_role;
revoke all on table public.control_plane_evidence from anon, authenticated, service_role;
revoke all on sequence public.control_plane_evidence_id_seq from anon, authenticated, service_role;
revoke all on function public.append_control_plane_evidence(text, integer, text, text, text, text)
  from public, anon, authenticated, service_role;

grant select, insert, update on table public.control_plane_runs to service_role;
grant select on table public.control_plane_evidence to service_role;
grant execute on function public.append_control_plane_evidence(text, integer, text, text, text, text)
  to service_role;

comment on table public.control_plane_runs is
  'Server-only control-plane run ledger with optimistic revision and build-attempt tracking.';

comment on table public.control_plane_evidence is
  'Append-only server evidence scoped to a specific build attempt. Direct service-role insert is intentionally denied.';

comment on function public.append_control_plane_evidence(text, integer, text, text, text, text) is
  'Atomically validates governed run state and build attempt, appends evidence, and invalidates stale run snapshots.';
