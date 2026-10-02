import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAcceptance } from '../dist/core/verifier.js';

test('approves only when every acceptance criterion has passing evidence', () => {
  const result = verifyAcceptance(['unit-tests', 'secret-scan'], [
    {
      criterionId: 'unit-tests',
      status: 'pass',
      source: 'circleci:test',
      detail: '42 tests passed'
    },
    {
      criterionId: 'secret-scan',
      status: 'pass',
      source: 'github:secret-scanning',
      detail: 'no findings'
    }
  ]);
  assert.deepEqual(result, { approved: true, missing: [], failed: [] });
});

test('rejects when evidence is missing or latest evidence is failing', () => {
  const result = verifyAcceptance(['unit-tests', 'secret-scan', 'build'], [
    { criterionId: 'unit-tests', status: 'pass', source: 'ci', detail: 'old pass' },
    { criterionId: 'unit-tests', status: 'fail', source: 'ci', detail: 'latest fail' },
    { criterionId: 'build', status: 'pass', source: 'ci', detail: 'ok' }
  ]);
  assert.deepEqual(result, {
    approved: false,
    missing: ['secret-scan'],
    failed: ['unit-tests']
  });
});

test('newer passing evidence supersedes an earlier failure', () => {
  const result = verifyAcceptance(['unit-tests'], [
    { criterionId: 'unit-tests', status: 'fail', source: 'ci', detail: 'attempt 1' },
    { criterionId: 'unit-tests', status: 'pass', source: 'ci', detail: 'attempt 2' }
  ]);
  assert.deepEqual(result, { approved: true, missing: [], failed: [] });
});
