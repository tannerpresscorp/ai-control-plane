create table if not exists public.control_plane_runs (
  id text primary key,
  objective text not null,
  status text not null check (status in ('planned','building','verifying','approved','completed','failed')),
  acceptance_criteria jsonb not null check (
    jsonb_typeof(acceptance_criteria)='array' and jsonb_array_length(acceptance_criteria)>0
    and not jsonb_path_exists(acceptance_criteria,'$[*] ? (@.type() != "string" || @ like_regex "^[\\s\\uFEFF]*$")')
  ),
  requested_capabilities jsonb not null default '[]'::jsonb check (jsonb_typeof(requested_capabilities)='array'),
  attempt integer not null default 0 check (attempt>=0),
  revision bigint not null default 0 check (revision>=0 and revision<=9007199254740991),
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create table if not exists public.control_plane_evidence (
  id bigint generated always as identity primary key,
  run_id text not null references public.control_plane_runs(id) on delete cascade,
  attempt integer not null check (attempt>0),
  criterion_id text not null,
  status text not null check (status in ('pass','fail')),
  source text not null, detail text not null,
  created_at timestamptz not null default now()
);
create index if not exists control_plane_evidence_run_id_idx on public.control_plane_evidence (run_id, id);
create index if not exists control_plane_evidence_run_attempt_id_idx on public.control_plane_evidence (run_id, attempt, id);
create index if not exists control_plane_evidence_run_attempt_criterion_id_idx on public.control_plane_evidence (run_id, attempt, criterion_id, id);

create or replace function public.create_control_plane_run(
 p_run_id text,p_objective text,p_status text,p_acceptance_criteria jsonb,
 p_requested_capabilities jsonb,p_attempt integer,p_revision bigint,p_created_at timestamptz,p_updated_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
begin
 if p_status <> 'planned' then raise exception 'Run must be created in planned state: %',p_status using errcode='23514'; end if;
 if p_attempt <> 0 then raise exception 'Run must be created at attempt 0' using errcode='23514'; end if;
 if p_revision <> 0 then raise exception 'Run must be created at revision 0' using errcode='23514'; end if;
 insert into public.control_plane_runs(id,objective,status,acceptance_criteria,requested_capabilities,attempt,revision,created_at,updated_at)
 values(p_run_id,p_objective,p_status,p_acceptance_criteria,p_requested_capabilities,p_attempt,p_revision,p_created_at,p_updated_at);
end; $$;

create or replace function public.update_control_plane_run(
 p_run_id text,p_status text,p_attempt integer,p_revision bigint,p_objective text,
 p_acceptance_criteria jsonb,p_requested_capabilities jsonb,p_updated_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare current_run public.control_plane_runs%rowtype; expected_attempt integer;
begin
 select * into current_run from public.control_plane_runs where id=p_run_id for update;
 if not found then raise exception 'Run not found: %',p_run_id using errcode='P0002'; end if;
 if p_status='approved' then raise exception 'Approved state must be entered through ledger approval' using errcode='23514'; end if;
 if not (
   (current_run.status='planned' and p_status in ('building','failed')) or
   (current_run.status='building' and p_status in ('building','verifying','failed')) or
   (current_run.status='verifying' and p_status in ('building','failed')) or
   (current_run.status='approved' and p_status in ('completed','failed'))
 ) then raise exception 'Illegal run transition: % -> %',current_run.status,p_status using errcode='23514'; end if;
 expected_attempt:=case when p_status='building' and current_run.status<>'building' then current_run.attempt+1 else current_run.attempt end;
 if p_attempt<>expected_attempt then raise exception 'Invalid run attempt transition: expected %, got %',expected_attempt,p_attempt using errcode='23514'; end if;
 if p_revision<>current_run.revision+1 then raise exception 'Stale run update: % expected revision %, got %',p_run_id,current_run.revision+1,p_revision using errcode='40001'; end if;
 update public.control_plane_runs set objective=p_objective,status=p_status,acceptance_criteria=p_acceptance_criteria,
   requested_capabilities=p_requested_capabilities,attempt=p_attempt,revision=p_revision,updated_at=p_updated_at
 where id=p_run_id;
end; $$;

create or replace function public.append_control_plane_evidence(
 p_run_id text,p_attempt integer,p_criterion_id text,p_status text,p_source text,p_detail text
) returns void language plpgsql security definer set search_path = '' as $$
declare current_attempt integer; current_status text;
begin
 if p_attempt<=0 then raise exception 'Evidence attempt must be positive' using errcode='23514'; end if;
 select attempt,status into current_attempt,current_status from public.control_plane_runs where id=p_run_id for update;
 if not found then raise exception 'Run not found: %',p_run_id using errcode='P0002'; end if;
 if current_status not in ('building', 'verifying') then raise exception 'Evidence can only be appended while run is building or verifying' using errcode='23514'; end if;
 if current_attempt<>p_attempt then raise exception 'Evidence attempt mismatch for run %: expected %, got %',p_run_id,current_attempt,p_attempt using errcode='23514'; end if;
 insert into public.control_plane_evidence(run_id,attempt,criterion_id,status,source,detail)
 values(p_run_id,p_attempt,p_criterion_id,p_status,p_source,p_detail);
 update public.control_plane_runs set revision = revision + 1 where id=p_run_id;
end; $$;

create or replace function public.approve_control_plane_run(p_run_id text,p_updated_at timestamptz)
returns public.control_plane_runs language plpgsql security definer set search_path = '' as $$
declare current_run public.control_plane_runs%rowtype; criterion text; latest_status text;
begin
 select * into current_run from public.control_plane_runs where id=p_run_id for update;
 if not found then raise exception 'Run not found: %',p_run_id using errcode='P0002'; end if;
 if current_run.status<>'verifying' then raise exception 'Run must be verifying before approval: %',current_run.status using errcode='23514'; end if;
 for criterion in select jsonb_array_elements_text(current_run.acceptance_criteria) loop
   latest_status:=null;
   select status into latest_status from public.control_plane_evidence
    where run_id=p_run_id and attempt=current_run.attempt and criterion_id=criterion order by id desc limit 1;
   if latest_status is null then raise exception 'Verification did not pass (missing: %)',criterion using errcode='23514'; end if;
   if latest_status<>'pass' then raise exception 'Verification did not pass (failed: %)',criterion using errcode='23514'; end if;
 end loop;
 update public.control_plane_runs set status='approved',updated_at=p_updated_at,revision = revision + 1
 where id=p_run_id returning * into current_run;
 return current_run;
end; $$;

alter function public.create_control_plane_run(text,text,text,jsonb,jsonb,integer,bigint,timestamptz,timestamptz) owner to postgres;
alter function public.update_control_plane_run(text,text,integer,bigint,text,jsonb,jsonb,timestamptz) owner to postgres;
alter function public.append_control_plane_evidence(text,integer,text,text,text,text) owner to postgres;
alter function public.approve_control_plane_run(text,timestamptz) owner to postgres;
alter table public.control_plane_runs enable row level security;
alter table public.control_plane_evidence enable row level security;
revoke all on table public.control_plane_runs from anon,authenticated,service_role;
revoke all on table public.control_plane_evidence from anon,authenticated,service_role;
revoke all on sequence public.control_plane_evidence_id_seq from anon,authenticated,service_role;
revoke all on function public.create_control_plane_run(text,text,text,jsonb,jsonb,integer,bigint,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.update_control_plane_run(text,text,integer,bigint,text,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.append_control_plane_evidence(text,integer,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.approve_control_plane_run(text,timestamptz) from public,anon,authenticated,service_role;
grant select on table public.control_plane_runs to service_role;
grant select on table public.control_plane_evidence to service_role;
grant execute on function public.create_control_plane_run(text,text,text,jsonb,jsonb,integer,bigint,timestamptz,timestamptz) to service_role;
grant execute on function public.update_control_plane_run(text,text,integer,bigint,text,jsonb,jsonb,timestamptz) to service_role;
grant execute on function public.append_control_plane_evidence(text,integer,text,text,text,text) to service_role;
grant execute on function public.approve_control_plane_run(text,timestamptz) to service_role;
comment on function public.create_control_plane_run(text,text,text,jsonb,jsonb,integer,bigint,timestamptz,timestamptz) is 'Atomically creates a run only in the governed initial state.';
comment on function public.update_control_plane_run(text,text,integer,bigint,text,jsonb,jsonb,timestamptz) is 'Atomically enforces lifecycle, attempt, and optimistic revision invariants.';
comment on function public.append_control_plane_evidence(text,integer,text,text,text,text) is 'Atomically validates governed state and attempt, appends evidence, and invalidates stale snapshots.';
comment on function public.approve_control_plane_run(text,timestamptz) is 'Atomically evaluates current-attempt evidence and enters approved.';
