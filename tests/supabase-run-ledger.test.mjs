import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SupabaseRunLedger } from '../dist/ledger/supabase-run-ledger.js';

function thenable(value) {
  return { then(resolve) { return Promise.resolve(resolve(value)); } };
}

function fakeClient({ pageSize = 1000 } = {}) {
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
      const run = runs.find((row) => row.id === args.p_run_id);

      if (!run) return thenable({ data: null, error: { message: `Run not found: ${args.p_run_id}` } });

      if (name === 'update_control_plane_run') {
        if (args.p_status === 'approved') {
          return thenable({ data: null, error: { message: 'Approved state must be entered through ledger approval' } });
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
        return thenable({ data: structuredClone(run), error: null });
      }

      return thenable({ data: null, error: { message: 'unknown rpc' } });
    },
    from(table) {
      return {
        insert(value) {
          const list = rows(table);
          const input = Array.isArray(value) ? value : [value];
          for (const row of input) list.push({ id: row.id ?? list.length + 1, ...structuredClone(row) });
          return thenable({ data: null, error: null });
        },
        select() { return builder(table); }
      };
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

test('works with the narrow Supabase client port', async () => {
  const ledger = new SupabaseRunLedger(fakeClient());
  await ledger.create(run);
  assert.deepEqual(await ledger.get(run.id), run);
});

test('uses governed optimistic revision checks for updates', async () => {
  const ledger = new SupabaseRunLedger(fakeClient());
  await ledger.create(run);

  await ledger.update({ ...run, status: 'building', attempt: 1, revision: 1 });

  await assert.rejects(
    () => ledger.update({ ...run, status: 'failed', attempt: 1, revision: 1 }),
    /Stale run update/
  );
  await assert.rejects(
    () => ledger.update({ ...run, status: 'building', attempt: 0, revision: 2 }),
    /Invalid run attempt transition/
  );
});

test('evidence append increments the run revision', async () => {
  const ledger = new SupabaseRunLedger(fakeClient());
  await ledger.create({ ...run, status: 'building', attempt: 1 });

  await ledger.appendEvidence(run.id, {
    criterionId: 'tests-pass', status: 'pass', source: 'ci', detail: 'passed', attempt: 1
  });

  assert.equal((await ledger.get(run.id))?.revision, 1);
});

test('rejects evidence outside building and verifying states', async () => {
  const ledger = new SupabaseRunLedger(fakeClient());
  await ledger.create({ ...run, status: 'verifying', attempt: 1, revision: 2 });
  await ledger.appendEvidence(run.id, {
    criterionId: 'tests-pass', status: 'pass', source: 'ci', detail: 'passed', attempt: 1
  });
  await ledger.approve(run.id, '2026-10-02T21:01:00.000Z');

  await assert.rejects(
    () => ledger.appendEvidence(run.id, {
      criterionId: 'tests-pass', status: 'fail', source: 'ci', detail: 'late', attempt: 1
    }),
    /building or verifying/
  );
});

test('paginates all evidence when the server caps responses below the requested range', async () => {
  const ledger = new SupabaseRunLedger(fakeClient({ pageSize: 2 }));
  const firstAttempt = { ...run, status: 'building', attempt: 1, revision: 0 };
  await ledger.create(firstAttempt);

  await ledger.appendEvidence(run.id, {
    criterionId: 'old', status: 'pass', source: 'ci', detail: 'old attempt', attempt: 1
  });

  await ledger.update({ ...firstAttempt, status: 'verifying', attempt: 1, revision: 2 });
  await ledger.update({ ...firstAttempt, status: 'building', attempt: 2, revision: 3 });

  for (let i = 0; i < 5; i += 1) {
    await ledger.appendEvidence(run.id, {
      criterionId: `criterion-${i}`, status: 'pass', source: 'ci', detail: `row-${i}`, attempt: 2
    });
  }

  const evidence = await ledger.listEvidence(run.id, 2);
  assert.equal(evidence.length, 5);
  assert.equal(evidence[0].criterionId, 'criterion-0');
  assert.equal(evidence.at(-1).criterionId, 'criterion-4');
  assert.ok(evidence.every((item) => item.attempt === 2));
});

test('schema enforces RPC-only governed evidence writes', async () => {
  const sql = (await readFile(new URL('../supabase/schema/control_plane_ledger.sql', import.meta.url), 'utf8')).toLowerCase();

  assert.match(sql, /attempt integer not null/);
  assert.match(sql, /revision bigint not null/);
  assert.match(sql, /jsonb_path_exists/);
  assert.match(sql, /like_regex/);
  assert.match(sql, /control_plane_evidence[\s\S]*attempt integer not null/);
  assert.match(sql, /create or replace function public\.update_control_plane_run/);
  assert.match(sql, /create or replace function public\.append_control_plane_evidence/);
  assert.match(sql, /create or replace function public\.approve_control_plane_run/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /for update/);
  assert.match(sql, /current_status not in \('building', 'verifying'\)/);
  assert.match(sql, /set revision = revision \+ 1/);
  assert.match(sql, /alter function public\.update_control_plane_run[\s\S]*owner to postgres/);
  assert.match(sql, /alter function public\.append_control_plane_evidence[\s\S]*owner to postgres/);
  assert.match(sql, /grant execute on function public\.update_control_plane_run/);
  assert.match(sql, /grant execute on function public\.append_control_plane_evidence/);
  assert.match(sql, /grant select on table public\.control_plane_evidence to service_role/);
  assert.doesNotMatch(sql, /grant select, insert on table public\.control_plane_evidence to service_role/);
  assert.doesNotMatch(sql, /grant usage, select on sequence public\.control_plane_evidence_id_seq to service_role/);
});