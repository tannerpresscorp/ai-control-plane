import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRunLedger } from '../dist/ledger/in-memory-run-ledger.js';
import { SupabaseRunLedger } from '../dist/ledger/supabase-run-ledger.js';

const verifyingRun = {
  id: 'run-approval',
  objective: 'Approve safely',
  status: 'verifying',
  acceptanceCriteria: ['tests-pass'],
  requestedCapabilities: ['repo.read'],
  attempt: 1,
  revision: 2,
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z'
};

function thenable(value) {
  return { then(resolve) { return Promise.resolve(resolve(value)); } };
}

function fakeSupabase() {
  const runs = [structuredClone(verifyingRun)];
  const evidence = [];

  const builder = (selection) => {
    let current = selection;
    return {
      eq(column, value) {
        current = current.filter((row) => row[column] === value);
        return this;
      },
      select() { return this; },
      maybeSingle() {
        return thenable({ data: current[0] ?? null, error: null });
      },
      order(column, { ascending }) {
        current = [...current].sort((a, b) =>
          ascending ? a[column] - b[column] : b[column] - a[column]
        );
        return this;
      },
      range(from, to) {
        return thenable({ data: current.slice(from, to + 1), error: null });
      }
    };
  };

  return {
    rpc(name, args) {
      const run = runs.find((item) => item.id === args.p_run_id);
      if (!run) return thenable({ data: null, error: { message: 'Run not found' } });

      if (name === 'append_control_plane_evidence') {
        if (run.status !== 'building' && run.status !== 'verifying') {
          return thenable({ data: null, error: { message: 'invalid state' } });
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
            .filter(
              (item) =>
                item.run_id === run.id &&
                item.attempt === run.attempt &&
                item.criterion_id === criterion
            )
            .at(-1);
          if (!latest) {
            return thenable({ data: null, error: { message: `Verification did not pass (missing: ${criterion})` } });
          }
          if (latest.status !== 'pass') {
            return thenable({ data: null, error: { message: `Verification did not pass (failed: ${criterion})` } });
          }
        }
        run.status = 'approved';
        run.updated_at = args.p_updated_at;
        run.revision += 1;
        return thenable({ data: structuredClone(run), error: null });
      }

      return thenable({ data: null, error: { message: 'unknown rpc' } });
    },
    from(table) {
      const source = table === 'control_plane_runs' ? runs : evidence;
      return {
        insert(value) {
          const values = Array.isArray(value) ? value : [value];
          source.push(...values.map((item) => structuredClone(item)));
          return thenable({ data: null, error: null });
        },
        select() { return builder(source); },
        update() { return builder(source); }
      };
    }
  };
}

test('in-memory approval uses the ledger latest current-attempt evidence', async () => {
  const ledger = new InMemoryRunLedger();
  await ledger.create(verifyingRun);

  await ledger.appendEvidence(verifyingRun.id, {
    criterionId: 'tests-pass',
    status: 'pass',
    source: 'ci',
    detail: 'first',
    attempt: 1
  });
  await ledger.appendEvidence(verifyingRun.id, {
    criterionId: 'tests-pass',
    status: 'fail',
    source: 'ci',
    detail: 'latest',
    attempt: 1
  });

  await assert.rejects(
    () => ledger.approve(verifyingRun.id, '2026-10-03T00:01:00.000Z'),
    /failed: tests-pass/
  );
});

test('Supabase approval delegates to the atomic approval RPC', async () => {
  const ledger = new SupabaseRunLedger(fakeSupabase());

  await ledger.appendEvidence(verifyingRun.id, {
    criterionId: 'tests-pass',
    status: 'pass',
    source: 'ci',
    detail: 'passed',
    attempt: 1
  });

  const approved = await ledger.approve(
    verifyingRun.id,
    '2026-10-03T00:02:00.000Z'
  );
  assert.equal(approved.status, 'approved');
});

test('generic create/update cannot persist approved state', async () => {
  const ledger = new InMemoryRunLedger();

  await assert.rejects(
    () => ledger.create({ ...verifyingRun, status: 'approved' }),
    /ledger approval/
  );

  await ledger.create(verifyingRun);
  await assert.rejects(
    () =>
      ledger.update({
        ...verifyingRun,
        status: 'approved',
        revision: verifyingRun.revision + 1
      }),
    /ledger approval/
  );
});
