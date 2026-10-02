import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, transitionRun } from '../dist/core/lifecycle.js';

const baseRun = {
  id: 'run-1', objective: 'Implement a safe feature', status: 'planned',
  acceptanceCriteria: ['tests-pass'], requestedCapabilities: ['repo.read'],
  createdAt: '2026-10-02T20:00:00.000Z', updatedAt: '2026-10-02T20:00:00.000Z'
};

test('allows the governed happy-path run lifecycle', () => {
  assert.equal(canTransition('planned', 'building'), true);
  assert.equal(canTransition('building', 'verifying'), true);
  assert.equal(canTransition('verifying', 'approved'), true);
  assert.equal(canTransition('approved', 'completed'), true);
});

test('prevents a builder from skipping verification', () => {
  assert.equal(canTransition('building', 'approved'), false);
  assert.throws(() => transitionRun({ ...baseRun, status: 'building' }, 'approved', '2026-10-02T20:01:00.000Z'));
});

test('allows any active run to fail without inventing success', () => {
  assert.equal(canTransition('planned', 'failed'), true);
  assert.equal(canTransition('building', 'failed'), true);
  assert.equal(canTransition('verifying', 'failed'), true);
});
