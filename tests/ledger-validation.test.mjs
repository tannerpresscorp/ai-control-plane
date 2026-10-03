import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { InMemoryRunLedger } from '../dist/ledger/in-memory-run-ledger.js';

const run = {
  id: 'run-validation',
  objective: 'Validate boundaries',
  status: 'planned',
  acceptanceCriteria: ['tests-pass'],
  requestedCapabilities: [],
  attempt: 0,
  revision: 0,
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z'
};

test('in-memory ledger rejects non-finite or unsafe run revisions', async () => {
  for (const revision of [Infinity, Number.NaN, -1, Number.MAX_SAFE_INTEGER + 1]) {
    const ledger = new InMemoryRunLedger();
    await assert.rejects(
      () => ledger.create({ ...run, revision }),
      /revision.*safe integer/i
    );
  }
});

test('in-memory ledger treats BOM-only acceptance criteria as blank', async () => {
  const ledger = new InMemoryRunLedger();
  await assert.rejects(
    () => ledger.create({ ...run, acceptanceCriteria: ['\uFEFF'] }),
    /acceptance criteria/i
  );
});

test('schema covers BOM-only blanks and both evidence ordering access paths', async () => {
  const sql = await readFile(
    new URL('../supabase/schema/control_plane_ledger.sql', import.meta.url),
    'utf8'
  );

  assert.match(sql, /\\uFEFF/);
  assert.match(
    sql,
    /control_plane_evidence_run_id_idx[\s\S]*\(run_id, id\)/
  );
  assert.match(
    sql,
    /control_plane_evidence_run_attempt_id_idx[\s\S]*\(run_id, attempt, id\)/
  );
});
