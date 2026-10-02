import test from 'node:test';
import assert from 'node:assert/strict';
import { approveRun, canTransition, transitionRun } from '../dist/core/lifecycle.js';

const baseRun = {
  id: 'run-1',
  objective: 'Implement a safe feature',
  status: 'planned',
  acceptanceCriteria: ['tests-pass'],
  requestedCapabilities: ['repo.read'],
  createdAt: '2026-10-02T20:00:00.000Z',
  updatedAt: '2026-10-02T20:00:00.000Z'
};

test('allows governed build and verification transitions including retry', () => {
  assert.equal(canTransition('planned', 'building'), true);
  assert.equal(canTransition('building', 'verifying'), true);
  assert.equal(canTransition('verifying', 'building'), true);
  assert.equal(canTransition('approved', 'completed'), true);
});

test('generic transitions cannot approve a run', () => {
  assert.equal(canTransition('verifying', 'approved'), false);
  assert.throws(
    () =>
      transitionRun(
        { ...baseRun, status: 'verifying' },
        'approved',
        '2026-10-02T20:01:00.000Z'
      ),
    /approveRun/
  );
});

test('approveRun requires passing evidence for every criterion', () => {
  const verifying = { ...baseRun, status: 'verifying' };

  assert.throws(
    () => approveRun(verifying, [], '2026-10-02T20:02:00.000Z'),
    /missing: tests-pass/
  );
  assert.throws(
    () =>
      approveRun(
        verifying,
        [{ criterionId: 'tests-pass', status: 'fail', source: 'ci', detail: 'failed' }],
        '2026-10-02T20:02:00.000Z'
      ),
    /failed: tests-pass/
  );

  const approved = approveRun(
    verifying,
    [{ criterionId: 'tests-pass', status: 'pass', source: 'ci', detail: 'passed' }],
    '2026-10-02T20:02:00.000Z'
  );
  assert.equal(approved.status, 'approved');
});

test('allows active runs to fail', () => {
  assert.equal(canTransition('planned', 'failed'), true);
  assert.equal(canTransition('building', 'failed'), true);
  assert.equal(canTransition('verifying', 'failed'), true);
});
