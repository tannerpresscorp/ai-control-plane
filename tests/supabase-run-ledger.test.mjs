import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SupabaseRunLedger } from '../dist/ledger/supabase-run-ledger.js';

function fakeClient() {
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
      select() {
        return this;
      },
      async maybeSingle() {
        return { data: current[0] ?? null, error: null };
      },
      async order(column, { ascending }) {
        const sorted = [...current].sort((a, b) =>
          ascending ? a[column] - b[column] : b[column] - a[column]
        );
        return { data: sorted, error: null };
      }
    };
  }

  return {
    from(table) {
      return {
        async insert(value) {
          const list = rows(table);
          const input = Array.isArray(value) ? value : [value];
          for (const row of input) list.push({ id: row.id ?? list.length + 1, ...row });
          return { data: null, error: null };
        },
        select() {
          return builder(table);
        },
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
              return builder(
                table,
                matches.map(({ index }) => root[index])
              );
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
  createdAt: '2026-10-02T21:00:00.000Z',
  updatedAt: '2026-10-02T21:00:00.000Z'
};

test('persists and reconstructs run records using Supabase-shaped rows', async () => {
  const ledger = new SupabaseRunLedger(fakeClient());
  await ledger.create(run);
  assert.deepEqual(await ledger.get(run.id), run);
});

test('updates a run and rejects updates for unknown ids', async () => {
  const ledger = new SupabaseRunLedger(fakeClient());
  await ledger.create(run);
  await ledger.update({
    ...run,
    status: 'building',
    updatedAt: '2026-10-02T21:01:00.000Z'
  });

  assert.equal((await ledger.get(run.id))?.status, 'building');
  await assert.rejects(() => ledger.update({ ...run, id: 'missing' }), /Run not found/);
});

test('appends evidence and returns it in insertion order', async () => {
  const ledger = new SupabaseRunLedger(fakeClient());
  await ledger.create(run);

  await ledger.appendEvidence(run.id, {
    criterionId: 'tests-pass',
    status: 'pass',
    source: 'circleci:test',
    detail: 'ok'
  });
  await ledger.appendEvidence(run.id, {
    criterionId: 'security',
    status: 'fail',
    source: 'scanner',
    detail: 'finding'
  });

  assert.deepEqual(await ledger.listEvidence(run.id), [
    {
      criterionId: 'tests-pass',
      status: 'pass',
      source: 'circleci:test',
      detail: 'ok'
    },
    {
      criterionId: 'security',
      status: 'fail',
      source: 'scanner',
      detail: 'finding'
    }
  ]);
});

test('schema is server-only with RLS and explicit least-privilege grants', async () => {
  const sql = (
    await readFile(
      new URL('../supabase/schema/control_plane_ledger.sql', import.meta.url),
      'utf8'
    )
  ).toLowerCase();

  assert.match(sql, /alter table public\.control_plane_runs enable row level security/);
  assert.match(sql, /alter table public\.control_plane_evidence enable row level security/);
  assert.match(
    sql,
    /revoke all on table public\.control_plane_runs from anon, authenticated/
  );
  assert.match(
    sql,
    /revoke all on table public\.control_plane_evidence from anon, authenticated/
  );
  assert.match(
    sql,
    /grant select, insert, update on table public\.control_plane_runs to service_role/
  );
  assert.match(
    sql,
    /grant select, insert on table public\.control_plane_evidence to service_role/
  );
  assert.doesNotMatch(sql, /create policy/);
});
