import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRunLedger } from '../dist/ledger/in-memory-run-ledger.js';

const run = {
  id: 'run-1',
  objective: 'test',
  status: 'planned',
  acceptanceCriteria: ['tests'],
  requestedCapabilities: ['repo.read'],
  createdAt: '2026-10-02T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z'
};

test('create/get/update enforce run existence and duplicate rules', async () => {
  const ledger = new InMemoryRunLedger();
  await ledger.create(run);
  assert.deepEqual(await ledger.get(run.id), run);
  await assert.rejects(() => ledger.create(run), /already exists/);

  await ledger.update({ ...run, status: 'building' });
  assert.equal((await ledger.get(run.id))?.status, 'building');
  await assert.rejects(() => ledger.update({ ...run, id: 'missing' }), /not found/);
});

test('evidence append/list preserves order and rejects unknown runs', async () => {
  const ledger = new InMemoryRunLedger();
  await ledger.create(run);

  const first = { criterionId: 'tests', status: 'fail', source: 'ci', detail: 'first' };
  const second = { criterionId: 'tests', status: 'pass', source: 'ci', detail: 'second' };

  await ledger.appendEvidence(run.id, first);
  await ledger.appendEvidence(run.id, second);

  assert.deepEqual(await ledger.listEvidence(run.id), [first, second]);
  await assert.rejects(() => ledger.appendEvidence('missing', first), /not found/);
});

test('returned values are clone-isolated from ledger state', async () => {
  const ledger = new InMemoryRunLedger();
  await ledger.create(run);

  const fetched = await ledger.get(run.id);
  fetched.acceptanceCriteria.push?.('mutated');
  assert.deepEqual((await ledger.get(run.id))?.acceptanceCriteria, ['tests']);

  const evidence = {
    criterionId: 'tests',
    status: 'pass',
    source: 'ci',
    detail: 'ok'
  };
  await ledger.appendEvidence(run.id, evidence);

  const listed = await ledger.listEvidence(run.id);
  listed[0].detail = 'mutated';
  assert.equal((await ledger.listEvidence(run.id))[0].detail, 'ok');
});
