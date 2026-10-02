import test from 'node:test';
import assert from 'node:assert/strict';
import { approveRun, canTransition, transitionRun } from '../dist/core/lifecycle.js';

const baseRun = {
  id: 'run-1',
  objective: 'Implement a safe feature',
  status: 'planned',
  acceptanceCriteria: ['tests-pass'],
  requestedCapabilities: ['repo.read'],
  attempt: 0,
  revision: 0,
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
  const verifying = { ...baseRun, status: 'verifying', attempt: 1, revision: 2 };

  assert.throws(
    () => approveRun(verifying, [], '2026-10-02T20:02:00.000Z'),
    /missing: tests-pass/
  );
  assert.throws(
    () =>
      approveRun(
        verifying,
        [{
          criterionId: 'tests-pass',
          status: 'fail',
          source: 'ci',
          detail: 'failed',
          attempt: 1
        }],
        '2026-10-02T20:02:00.000Z'
      ),
    /failed: tests-pass/
  );

  const approved = approveRun(
    verifying,
    [{
      criterionId: 'tests-pass',
      status: 'pass',
      source: 'ci',
      detail: 'passed',
      attempt: 1
    }],
    '2026-10-02T20:02:00.000Z'
  );
  assert.equal(approved.status, 'approved');
});

test('allows active runs to fail', () => {
  assert.equal(canTransition('planned', 'failed'), true);
  assert.equal(canTransition('building', 'failed'), true);
  assert.equal(canTransition('verifying', 'failed'), true);
});

test('build attempts and revisions advance deterministically', () => {
  const firstBuild = transitionRun(baseRun, 'building', '2026-10-02T20:03:00.000Z');
  assert.equal(firstBuild.attempt, 1);
  assert.equal(firstBuild.revision, 1);

  const verifying = transitionRun(firstBuild, 'verifying', '2026-10-02T20:04:00.000Z');
  assert.equal(verifying.attempt, 1);
  assert.equal(verifying.revision, 2);

  const retry = transitionRun(verifying, 'building', '2026-10-02T20:05:00.000Z');
  assert.equal(retry.attempt, 2);
  assert.equal(retry.revision, 3);
});

test('lifecycle results detach nested arrays from mutable inputs', () => {
  const acceptanceCriteria = ['tests-pass'];
  const requestedCapabilities = ['repo.read'];
  const run = {
    ...baseRun,
    acceptanceCriteria,
    requestedCapabilities
  };

  const building = transitionRun(run, 'building', '2026-10-02T20:03:00.000Z');
  acceptanceCriteria.push('security');
  requestedCapabilities.push('repo.write');

  assert.deepEqual(building.acceptanceCriteria, ['tests-pass']);
  assert.deepEqual(building.requestedCapabilities, ['repo.read']);
});

test('approval rejects empty criteria and detaches nested arrays', () => {
  const empty = {
    ...baseRun,
    status: 'verifying',
    acceptanceCriteria: [],
    attempt: 1,
    revision: 2
  };
  assert.throws(
    () => approveRun(empty, [], '2026-10-02T20:06:00.000Z'),
    /acceptance criteria/
  );

  const acceptanceCriteria = ['tests-pass'];
  const requestedCapabilities = ['repo.read'];
  const verifying = {
    ...baseRun,
    status: 'verifying',
    acceptanceCriteria,
    requestedCapabilities,
    attempt: 1,
    revision: 2
  };
  const approved = approveRun(
    verifying,
    [{
      criterionId: 'tests-pass',
      status: 'pass',
      source: 'ci',
      detail: 'ok',
      attempt: 1
    }],
    '2026-10-02T20:07:00.000Z'
  );

  acceptanceCriteria.push('security');
  requestedCapabilities.push('repo.write');

  assert.equal(approved.revision, 3);
  assert.deepEqual(approved.acceptanceCriteria, ['tests-pass']);
  assert.deepEqual(approved.requestedCapabilities, ['repo.read']);
});
