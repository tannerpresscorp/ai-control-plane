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
        const cappedTo = Math.min(to, from + pageSize - 1);
        return thenable({ data: current.slice(from, cappedTo + 1), error: null });
      }
    };
  }

  return {
    from(table) {
      return {
        insert(value) {
          const list = rows(table);
          const input = Array.isArray(value) ? value : [value];
          for (const row of input) list.push({ id: row.id ?? list.length + 1, ...row });
          return thenable({ data: null, error: null });
        },
        select() { return builder(table); },
        update(value) {
          const root = rows(table);
          let matches = root.map((row, index) => ({ row, index }));
          return {
            eq(column, expected) {
              matches = matches.filter(({ row }) => row[column] === expected);
              return this;
            },
            select() {
              for (const { row, index } of matches) root[index] = { ...row, ...value };
              return builder(table, matches.map(({ index }) => root[index]));
            }
          };
        }
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

test('works with PromiseLike Supabase-shaped query builders', async () => {
  const ledger = new SupabaseRunLedger(fakeClient());
  await ledger.create(run);
  assert.deepEqual(await ledger.get(run.id), run);
});

test('uses optimistic revision checks for updates', async () => {
  const ledger = new SupabaseRunLedger(fakeClient());
  await ledger.create(run);
  const current = { ...run, status: 'building', attempt: 1, revision: 1 };
  await ledger.update(current);
  await assert.rejects(
    () => ledger.update({ ...run, status: 'failed', revision: 1 }),
    /Stale run update/
  );
});

test('paginates all evidence and scopes it to the requested attempt', async () => {
  const ledger = new SupabaseRunLedger(fakeClient({ pageSize: 1000 }));
  const firstAttempt = { ...run, status: 'building', attempt: 1, revision: 0 };
  await ledger.create(firstAttempt);
  await ledger.appendEvidence(run.id, {
    criterionId: 'old', status: 'pass', source: 'ci', detail: 'old attempt', attempt: 1
  });

  await ledger.update({ ...firstAttempt, attempt: 2, revision: 1 });
  for (let i = 0; i < 1001; i += 1) {
    await ledger.appendEvidence(run.id, {
      criterionId: `criterion-${i}`,
      status: 'pass',
      source: 'ci',
      detail: `row-${i}`,
      attempt: 2
    });
  }

  const evidence = await ledger.listEvidence(run.id, 2);
  assert.equal(evidence.length, 1001);
  assert.equal(evidence[0].criterionId, 'criterion-0');
  assert.equal(evidence.at(-1).criterionId, 'criterion-1000');
  assert.ok(evidence.every((item) => item.attempt === 2));
});

test('schema stores revision/attempt and enforces service-role least privilege', async () => {
  const sql = (
    await readFile(new URL('../supabase/schema/control_plane_ledger.sql', import.meta.url), 'utf8')
  ).toLowerCase();

  assert.match(sql, /attempt integer not null/);
  assert.match(sql, /revision bigint not null/);
  assert.match(sql, /control_plane_evidence[\s\S]*attempt integer not null/);
  assert.match(sql, /revoke all on table public\.control_plane_runs from anon, authenticated, service_role/);
  assert.match(sql, /revoke all on table public\.control_plane_evidence from anon, authenticated, service_role/);
  assert.match(sql, /revoke all on sequence public\.control_plane_evidence_id_seq from anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /grant usage, select on sequence public\.control_plane_evidence_id_seq to service_role/);
  assert.match(sql, /grant select, insert, update on table public\.control_plane_runs to service_role/);
  assert.match(sql, /grant select, insert on table public\.control_plane_evidence to service_role/);
});
