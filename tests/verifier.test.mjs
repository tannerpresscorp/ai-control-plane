import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAcceptance } from '../dist/core/verifier.js';

test('approves only when every acceptance criterion has passing evidence for the current attempt', () => {
  const result = verifyAcceptance(
    ['unit-tests', 'secret-scan'],
    [
      {
        criterionId: 'unit-tests',
        status: 'pass',
        source: 'circleci:test',
        detail: '42 tests passed',
        attempt: 1
      },
      {
        criterionId: 'secret-scan',
        status: 'pass',
        source: 'github:secret-scanning',
        detail: 'no findings',
        attempt: 1
      }
    ],
    1
  );
  assert.deepEqual(result, { approved: true, missing: [], failed: [] });
});

test('rejects when evidence is missing or latest current-attempt evidence is failing', () => {
  const result = verifyAcceptance(
    ['unit-tests', 'secret-scan', 'build'],
    [
      {
        criterionId: 'unit-tests',
        status: 'pass',
        source: 'ci',
        detail: 'old pass',
        attempt: 1
      },
      {
        criterionId: 'unit-tests',
        status: 'fail',
        source: 'ci',
        detail: 'latest fail',
        attempt: 1
      },
      {
        criterionId: 'build',
        status: 'pass',
        source: 'ci',
        detail: 'ok',
        attempt: 1
      }
    ],
    1
  );
  assert.deepEqual(result, {
    approved: false,
    missing: ['secret-scan'],
    failed: ['unit-tests']
  });
});

test('newer passing evidence supersedes an earlier failure in the same attempt', () => {
  const result = verifyAcceptance(
    ['unit-tests'],
    [
      {
        criterionId: 'unit-tests',
        status: 'fail',
        source: 'ci',
        detail: 'first',
        attempt: 1
      },
      {
        criterionId: 'unit-tests',
        status: 'pass',
        source: 'ci',
        detail: 'second',
        attempt: 1
      }
    ],
    1
  );
  assert.deepEqual(result, { approved: true, missing: [], failed: [] });
});

test('never approves a run with no acceptance criteria', () => {
  const result = verifyAcceptance([], [], 1);
  assert.equal(result.approved, false);
  assert.deepEqual(result.missing, ['acceptance-criteria']);
});

test('uses evidence from only the required build attempt', () => {
  const result = verifyAcceptance(
    ['unit-tests', 'security'],
    [
      {
        criterionId: 'unit-tests',
        status: 'pass',
        source: 'ci',
        detail: 'attempt 1',
        attempt: 1
      },
      {
        criterionId: 'security',
        status: 'pass',
        source: 'ci',
        detail: 'attempt 1',
        attempt: 1
      },
      {
        criterionId: 'unit-tests',
        status: 'pass',
        source: 'ci',
        detail: 'attempt 2',
        attempt: 2
      }
    ],
    2
  );
  assert.deepEqual(result, {
    approved: false,
    missing: ['security'],
    failed: []
  });
});

test('rejects an omitted or non-positive attempt scope', () => {
  const evidence = [{
    criterionId: 'unit-tests',
    status: 'pass',
    source: 'ci',
    detail: 'pass',
    attempt: 1
  }];

  assert.throws(
    () => verifyAcceptance(['unit-tests'], evidence),
    /positive build attempt/
  );
  assert.throws(
    () => verifyAcceptance(['unit-tests'], evidence, 0),
    /positive build attempt/
  );
});
