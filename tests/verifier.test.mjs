import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAcceptance } from '../dist/core/verifier.js';

test('approves only when every acceptance criterion has passing evidence', () => {
  const result = verifyAcceptance(['unit-tests', 'secret-scan'], [
    { criterionId: 'unit-tests', status: 'pass', source: 'circleci:test', detail: '42 tests passed' },
    { criterionId: 'secret-scan', status: 'pass', source: 'github:secret-scanning', detail: 'no findings' }
  ]);
  assert.deepEqual(result, { approved: true, missing: [], failed: [] });
});

test('rejects when evidence is missing or explicitly failing', () => {
  const result = verifyAcceptance(['unit-tests', 'secret-scan', 'build'], [
    { criterionId: 'unit-tests', status: 'fail', source: 'circleci:test', detail: '1 failed' },
    { criterionId: 'build', status: 'pass', source: 'circleci:build', detail: 'ok' }
  ]);
  assert.deepEqual(result, { approved: false, missing: ['secret-scan'], failed: ['unit-tests'] });
});
