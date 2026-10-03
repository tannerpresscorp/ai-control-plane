import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SupabaseRunLedger } from '../dist/ledger/supabase-run-ledger.js';

function thenable(value) {
  return { then(resolve) { return Promise.resolve(resolve(value)); } };
}

function dbRow(input) {
  return {
    id: input.id,
    objective: input.objective,
    status: input.status,
    acceptance_criteria: [...input.acceptanceCriteria],
    requested_capabilities: [...input.requestedCapabilities],
    attempt: input.attempt,
    revision: input.revision,
    created_at: input.createdAt,
    updated_at: input.updatedAt
  };
}

function canTransition(current, next) {
  return (
    (current === 'planned' && ['building', 'failed'].includes(next)) ||
    (current === 'building' && ['building', 'verifying', 'failed'].includes(next)) ||
    (current === 'verifying' && ['building', 'failed'].includes(next)) ||
    (current === 'approved' && ['completed', 'failed'].includes(next))
  );
}

function fakeClient({ pageSize = 1000, approveReturnsArray = false } = {}) {
  const tables = new Map();
  const rows = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };

  function builder(table, selection = rows(table)) {
    let current = selection;
    return {
      eq(column, value) {
        current = current.filter((row) => row[column] === value);
        return this;
      },
      select() { return this; },
      maybeSingle() { return thenable({ data: current[0] ?? null, error: null }); },
      order(column, { ascending }) {
        current = [...current].sort((a, b) => ascending ? a[column] - b[column] : b[column] - a[column]);
        return this;
      },
      range(from, to) {
        const cappedTo = Math.min(to, from + pageSize - 1);
        return thenable({ data: current.slice(from, cappedTo + 1), error: null });
      }
    };
  }

  return {
    rpc(name, args) {
      const runs = rows('control_plane_runs');
      const evidence = rows('control_plane_evidence');

      if (name === 'create_control_plane_run') {
        if (args.p_status !== 'planned') {
          return thenable({ data: null, error: { message: `Run must be created in planned state: ${args.p_status}` } });
        }
        if (args.p_attempt !== 0) {
          return thenable({ data: null, error: { message: 'Run must be created at attempt 0' } });
        }
        if (args.p_revision !== 0) {
          return thenable({ data: null, error: { message: 'Run must be created at revision 0' } });
        }
        if (runs.some((row) => row.id === args.p_run_id)) {
          return thenable({ data: null, error: { message: `Run already exists: ${args.p_run_id}` } });
        }
        runs.push({
          id: args.p_run_id,
          objective: args.p_objective,
          status: args.p_status,
          acceptance_criteria: [...args.p_acceptance_criteria],
          requested_capabilities: [...args.p_requested_capabilities],
          attempt: args.p_attempt,
          revision: args.p_revision,
          created_at: args.p_created_at,
          updated_at: args.p_updated_at
        });
        return thenable({ data: null, error: null });
      }

      const run = runs.find((row) => row.id === args.p_run_id);
      if (!run) return thenable({ data: null, error: { message: `Run not found: ${args.p_run_id}` } });

      if (name === 'update_control_plane_run') {
        if (args.p_status === 'approved') {
          return thenable({ data: null, error: { message: 'Approved state must be entered through ledger approval' } });
        }
        if (!canTransition(run.status, args.p_status)) {
          return thenable({ data: null, error: { message: `Illegal run transition: ${run.status} -> ${args.p_status}` } });
        }
        const expectedAttempt = args.p_status === 'building' && run.status !== 'building'
          ? run.attempt + 1
          : run.attempt;
        if (args.p_attempt !== expectedAttempt) {
          return thenable({ data: null, error: { message: `Invalid run attempt transition: expected ${expectedAttempt}, got ${args.p_attempt}` } });
        }
        if (args.p_revision !== run.revision + 1) {
          return thenable({ data: null, error: { message: `Stale run update: ${args.p_run_id} expected revision ${run.revision + 1}, got ${args.p_revision}` } });
        }
        Object.assign(run, {
          objective: args.p_objective,
          status: args.p_status,
          acceptance_criteria: [...args.p_acceptance_criteria],
          requested_capabilities: [...args.p_requested_capabilities],
          attempt: args.p_attempt,
          revision: args.p_revision,
          updated_at: args.p_updated_at
        });
        return thenable({ data: null, error: null });
      }

      if (name === 'append_control_plane_evidence') {
        if (run.status !== 'building' && run.status !== 'verifying') {
          return thenable({ data: null, error: { message: 'Evidence can only be appended while run is building or verifying' } });
        }
        if (args.p_attempt <= 0) {
          return thenable({ data: null, error: { message: 'Evidence attempt must be positive' } });
        }
        if (run.attempt !== args.p_attempt) {
          return thenable({ data: null, error: { message: `Evidence attempt mismatch: ${args.p_run_id}` } });
        }
        evidence.push({
          id: evidence.length + 1,
          run_id: args.p_run_id,
          attempt: args.p_attempt,
          criterion_id: args.p_criterion_id,
          status: args.p_status,
          source: args.p_source,
          detail: args.p_detail
        });
        run.revision += 1;
        return thenable({ data: null, error: null });
      }

      if (name === 'approve_control_plane_run') {
        if (run.status !== 'verifying') {
          return thenable({ data: null, error: { message: 'Run must be verifying before approval' } });
        }
        for (const criterion of run.acceptance_criteria) {
          const latest = evidence
            .filter((item) => item.run_id === run.id && item.attempt === run.attempt && item.criterion_id === criterion)
            .at(-1);
          if (!latest) return thenable({ data: null, error: { message: `Verification did not pass (missing: ${criterion})` } });
          if (latest.status !== 'pass') return thenable({ data: null, error: { message: `Verification did not pass (failed: ${criterion})` } });
        }
        run.status = 'approved';
        run.updated_at = args.p_updated_at;
        run.revision += 1;
        return thenable({ data: approveReturnsArray ? [structuredClone(run)] : structuredClone(run), error: null });
      }

      return thenable({ data: null, error: { message: 'unknown rpc' } });
    },
    from(table) {
      return { select() { return builder(table); } };
    }
  };
}

const run = {
  id: 'run-42',
  objective: 'Persist evidence',
  status: 'planned',
  acceptanceCriteria: ['tests-pass'],
  requestedCapabilities: ['db.query'],
  attempt: 0,
  revision: 0,
  createdAt: '2026-10-02T21:00:00.000Z',
  updatedAt: '2026-10-02T21:00:00.000Z'
};

async function createBuildingRun(ledger) {
  await ledger.create(run);
  await ledger.update({ ...run, status: 'building', attempt: 1, revision: 1 });
}

async function createVerifyingRun(ledger) {
  await createBuildingRun(ledger);
  await ledger.update({ ...run, status: 'verifying', attempt: 1, revision: 2 });
}

test('works with the narrow Supabase client port', async () => {
  const ledger = new SupabaseRunLedger(fakeClient());
  await ledger.create(run);
  assert.deepEqual(await ledger.get(run.id), run);
});

test('rejects unsafe persisted numeric boundaries', async () => {
  const unsafeRow = {
    id: 'unsafe', objective: 'unsafe', status: 'planned',
    acceptance_criteria: ['tests-pass'], requested_capabilities: [],
    attempt: 0, revision: '9007199254740992',
    created_at: '2026-10-02T21:00:00.000Z', updated_at: '2026-10-02T21:00:00.000Z'
  };
  const ledger = new SupabaseRunLedger({
    rpc() { return thenable({ data: null, error: { message: 'unused' } }); },
    from() {
      return {
        select() {
          return {
            eq() { return this; }, select() { return this; },
            maybeSingle() { return thenable({ data: unsafeRow, error: null }); },
            order() { return this; }, range() { return thenable({ data: [], error: null }); }
          };
        }
      };
    }
  });

  await assert.rejects(() => ledger.get('unsafe'), /revision.*safe integer/);
  await assert.rejects(() => ledger.create({ ...run, revision: Number.MAX_SAFE_INTEGER + 1 }), /revision.*safe integer/);
});

test('governed create rejects non-initial states', async () => {
  const ledger = new SupabaseRunLedger(fakeClient());
  await assert.rejects(() => ledger.create({ ...run, status: 'approved' }), /ledger approval/);
  await assert.rejects(() => ledger.create({ ...run, status: 'building', attempt: 1 }), /planned state/);
});

test('uses governed optimistic revision checks for updates', async () => {
  const ledger = new SupabaseRunLedger(fakeClient());
  await ledger.create(run);

  await assert.rejects(
    () => ledger.update({ ...run, status: 'verifying', attempt: 0, revision: 1 }),
    /Illegal run transition/
  );

  await ledger.update({ ...run, status: 'building', attempt: 1, revision: 1 });

  await assert.rejects(() => ledger.update({ ...run, status: 'failed', attempt: 1, revision: 1 }), /Stale run update/);
  await assert.rejects(() => ledger.update({ ...run, status: 'building', attempt: 0, revision: 2 }), /Invalid run attempt transition/);
});

test('evidence append increments the run revision', async () => {
  const ledger = new SupabaseRunLedger(fakeClient());
  await createBuildingRun(ledger);

  await ledger.appendEvidence(run.id, { criterionId: 'tests-pass', status: 'pass', source: 'ci', detail: 'passed', attempt: 1 });
  assert.equal((await ledger.get(run.id))?.revision, 2);
});

test('rejects evidence outside building and verifying states', async () => {
  const ledger = new SupabaseRunLedger(fakeClient());
  await createVerifyingRun(ledger);
  await ledger.appendEvidence(run.id, { criterionId: 'tests-pass', status: 'pass', source: 'ci', detail: 'passed', attempt: 1 });
  await ledger.approve(run.id, '2026-10-02T21:01:00.000Z');

  await assert.rejects(
    () => ledger.appendEvidence(run.id, { criterionId: 'tests-pass', status: 'fail', source: 'ci', detail: 'late', attempt: 1 }),
    /building or verifying/
  );
});



test('approval unwraps PostgREST one-row RPC arrays', async () => {
  const ledger = new SupabaseRunLedger(fakeClient({ approveReturnsArray: true }));
  await createVerifyingRun(ledger);
  await ledger.appendEvidence(run.id, { criterionId: 'tests-pass', status: 'pass', source: 'ci', detail: 'passed', attempt: 1 });

  const approved = await ledger.approve(run.id, '2026-10-02T21:01:00.000Z');
  assert.equal(approved.status, 'approved');
  assert.equal(approved.id, run.id);
});

test('paginates all evidence when the server caps responses below the requested range', async () => {
  const ledger = new SupabaseRunLedger(fakeClient({ pageSize: 2 }));
  await createBuildingRun(ledger);

  await ledger.appendEvidence(run.id, { criterionId: 'old', status: 'pass', source: 'ci', detail: 'old attempt', attempt: 1 });

  await ledger.update({ ...run, status: 'verifying', attempt: 1, revision: 3 });
  await ledger.update({ ...run, status: 'building', attempt: 2, revision: 4 });

  for (let i = 0; i < 5; i += 1) {
    await ledger.appendEvidence(run.id, { criterionId: `criterion-${i}`, status: 'pass', source: 'ci', detail: `row-${i}`, attempt: 2 });
  }

  const evidence = await ledger.listEvidence(run.id, 2);
  assert.equal(evidence.length, 5);
  assert.equal(evidence[0].criterionId, 'criterion-0');
  assert.equal(evidence.at(-1).criterionId, 'criterion-4');
  assert.ok(evidence.every((item) => item.attempt === 2));
});

test('schema enforces RPC-only governed writes', async () => {
  const sql = (await readFile(new URL('../supabase/schema/control_plane_ledger.sql', import.meta.url), 'utf8')).toLowerCase();

  assert.match(sql, /attempt integer not null/);
  assert.match(sql, /revision bigint not null/);
  assert.match(sql, /revision<=9007199254740991/);
  assert.match(sql, /jsonb_path_exists/);
  assert.match(sql, /like_regex/);
  assert.match(sql, /control_plane_evidence[\s\S]*attempt integer not null/);
  assert.match(sql, /create or replace function public\.create_control_plane_run/);
  assert.match(sql, /create or replace function public\.update_control_plane_run/);
  assert.match(sql, /create or replace function public\.append_control_plane_evidence/);
  assert.match(sql, /create or replace function public\.approve_control_plane_run/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /for update/);
  assert.match(sql, /current_status not in \('building', 'verifying'\)/);
  assert.match(sql, /set revision = revision \+ 1/);
  assert.match(sql, /alter function public\.create_control_plane_run[\s\S]*owner to postgres/);
  assert.match(sql, /alter function public\.update_control_plane_run[\s\S]*owner to postgres/);
  assert.match(sql, /alter function public\.append_control_plane_evidence[\s\S]*owner to postgres/);
  assert.match(sql, /grant execute on function public\.create_control_plane_run/);
  assert.match(sql, /grant execute on function public\.update_control_plane_run/);
  assert.match(sql, /grant execute on function public\.append_control_plane_evidence/);
  assert.match(sql, /grant select on table public\.control_plane_runs to service_role/);
  assert.match(sql, /grant select on table public\.control_plane_evidence to service_role/);
  assert.doesNotMatch(sql, /grant select,insert on table public\.control_plane_runs to service_role/);
  assert.doesNotMatch(sql, /grant select, insert on table public\.control_plane_runs to service_role/);
  assert.doesNotMatch(sql, /grant select, insert on table public\.control_plane_evidence to service_role/);
  assert.doesNotMatch(sql, /grant usage, select on sequence public\.control_plane_evidence_id_seq to service_role/);
});
