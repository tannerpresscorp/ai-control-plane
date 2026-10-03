import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, transitionRun } from '../dist/core/lifecycle.js';

const baseRun = {
  id: 'run-1', objective: 'Implement a safe feature', status: 'planned',
  acceptanceCriteria: ['tests-pass'], requestedCapabilities: ['repo.read'],
  attempt: 0, revision: 0,
  createdAt: '2026-10-02T20:00:00.000Z', updatedAt: '2026-10-02T20:00:00.000Z'
};

test('allows governed build and verification transitions including idempotent building reuse', () => {
  assert.equal(canTransition('planned', 'building'), true);
  assert.equal(canTransition('building', 'building'), true);
  assert.equal(canTransition('building', 'verifying'), true);
  assert.equal(canTransition('verifying', 'building'), true);
  assert.equal(canTransition('approved', 'completed'), true);
});

test('reusing building keeps attempt and advances revision', () => {
  const reused = transitionRun({ ...baseRun, status:'building', attempt:1, revision:1 }, 'building', '2026-10-02T20:00:30.000Z');
  assert.equal(reused.attempt,1); assert.equal(reused.revision,2);
});

test('generic transitions cannot approve a run', () => {
  assert.equal(canTransition('verifying','approved'), false);
  assert.throws(() => transitionRun({ ...baseRun, status:'verifying' }, 'approved', '2026-10-02T20:01:00.000Z'), /ledger-owned/);
});

test('build attempts and revisions advance deterministically', () => {
  const build=transitionRun(baseRun,'building','2026-10-02T20:03:00.000Z');
  const verifying=transitionRun(build,'verifying','2026-10-02T20:04:00.000Z');
  const retry=transitionRun(verifying,'building','2026-10-02T20:05:00.000Z');
  assert.deepEqual([build.attempt,build.revision],[1,1]);
  assert.deepEqual([verifying.attempt,verifying.revision],[1,2]);
  assert.deepEqual([retry.attempt,retry.revision],[2,3]);
});

test('lifecycle results detach nested arrays', () => {
  const acceptanceCriteria=['tests-pass']; const requestedCapabilities=['repo.read'];
  const building=transitionRun({...baseRun,acceptanceCriteria,requestedCapabilities},'building','2026-10-02T20:03:00.000Z');
  acceptanceCriteria.push('security'); requestedCapabilities.push('repo.write');
  assert.deepEqual(building.acceptanceCriteria,['tests-pass']);
  assert.deepEqual(building.requestedCapabilities,['repo.read']);
});

test('transitionRun rejects unsafe revision overflow', () => {
  assert.throws(
    () => transitionRun({ ...baseRun, revision: Number.MAX_SAFE_INTEGER }, 'building', '2026-10-02T20:06:00.000Z'),
    /revision cannot be incremented safely/
  );
});
