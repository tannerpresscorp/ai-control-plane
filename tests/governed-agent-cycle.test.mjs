import test from 'node:test';
import assert from 'node:assert/strict';
import { GovernedAgentCycle } from '../dist/agents/governed-agent-cycle.js';
import { InMemoryRunLedger } from '../dist/ledger/in-memory-run-ledger.js';

function runtime() {
  return {
    async plan() {
      return {
        objective: 'Implement feature',
        acceptanceCriteria: ['tests-pass'],
        requestedCapabilities: ['repo.write'],
        rationale: 'bounded implementation'
      };
    },
    async build() {
      return {
        summary: 'Built',
        artifacts: ['src/feature.ts'],
        requestedEvidence: ['tests-pass']
      };
    },
    async verify() {
      return {
        summary: 'Agent thinks it is ready',
        observations: ['non-authoritative']
      };
    }
  };
}

const times = [
  '2026-10-02T21:00:00.000Z',
  '2026-10-02T21:01:00.000Z',
  '2026-10-02T21:02:00.000Z',
  '2026-10-02T21:03:00.000Z'
];

function clock() {
  let i = 0;
  return () => times[i++] ?? times.at(-1);
}

test('plans and builds a run without granting approval authority to an agent', async () => {
  const ledger = new InMemoryRunLedger();
  const cycle = new GovernedAgentCycle(runtime(), ledger, clock());

  const { run } = await cycle.planRun('run-1', 'Please implement the feature');
  assert.equal(run.status, 'planned');
  assert.deepEqual(run.acceptanceCriteria, ['tests-pass']);

  const built = await cycle.buildRun(run.id);
  assert.equal(built.run.status, 'building');
  assert.equal(built.report.summary, 'Built');
});

test('approves only from ledger evidence even when Verifier says work is ready', async () => {
  const ledger = new InMemoryRunLedger();
  const cycle = new GovernedAgentCycle(runtime(), ledger, clock());

  await cycle.planRun('run-2', 'Build it');
  await cycle.buildRun('run-2');
  await ledger.appendEvidence('run-2', {
    criterionId: 'tests-pass',
    status: 'pass',
    source: 'circleci:test',
    detail: '13 passed',
    attempt: 1
  });

  const result = await cycle.verifyRun('run-2');
  assert.equal(result.decision, 'approved');
  assert.equal(result.run.status, 'approved');
});

test('returns to building when evidence is missing regardless of Verifier narrative', async () => {
  const ledger = new InMemoryRunLedger();
  const cycle = new GovernedAgentCycle(runtime(), ledger, clock());

  await cycle.planRun('run-3', 'Build it');
  await cycle.buildRun('run-3');

  const result = await cycle.verifyRun('run-3');
  assert.equal(result.decision, 'retry');
  assert.equal(result.run.status, 'building');
  assert.match(result.reason, /missing: tests-pass/);
});

test('rejects a plan with no acceptance criteria at the governance boundary', async () => {
  const ledger = new InMemoryRunLedger();
  const badRuntime = {
    ...runtime(),
    async plan() {
      return {
        objective: 'bad',
        acceptanceCriteria: [],
        requestedCapabilities: [],
        rationale: 'bad'
      };
    }
  };
  const cycle = new GovernedAgentCycle(badRuntime, ledger, clock());

  await assert.rejects(
    () => cycle.planRun('run-empty', 'bad plan'),
    /acceptance criteria/i
  );
});

test('reuses an already-building run after verification retry', async () => {
  const ledger = new InMemoryRunLedger();
  const cycle = new GovernedAgentCycle(runtime(), ledger, clock());

  await cycle.planRun('run-retry', 'Build it');
  await cycle.buildRun('run-retry');

  const retry = await cycle.verifyRun('run-retry');
  assert.equal(retry.decision, 'retry');
  assert.equal(retry.run.status, 'building');
  assert.equal(retry.run.attempt, 2);

  const rebuilt = await cycle.buildRun('run-retry');
  assert.equal(rebuilt.run.status, 'building');
  assert.equal(rebuilt.run.attempt, 2);
});

test('retries the Builder from an existing building state after Builder failure', async () => {
  const ledger = new InMemoryRunLedger();
  let calls = 0;
  const flaky = {
    ...runtime(),
    async build() {
      calls += 1;
      if (calls === 1) throw new Error('builder unavailable');
      return {
        summary: 'Recovered',
        artifacts: [],
        requestedEvidence: ['tests-pass']
      };
    }
  };
  const cycle = new GovernedAgentCycle(flaky, ledger, clock());

  await cycle.planRun('run-builder-fail', 'Build it');
  await assert.rejects(
    () => cycle.buildRun('run-builder-fail'),
    /builder unavailable/
  );

  const recovered = await cycle.buildRun('run-builder-fail');
  assert.equal(recovered.report.summary, 'Recovered');
  assert.equal(recovered.run.attempt, 1);
});

test('reloads run revision and evidence after advisory verification before retry', async () => {
  const ledger = new InMemoryRunLedger();
  const dynamic = {
    ...runtime(),
    async verify({ run }) {
      await ledger.appendEvidence(run.id, {
        criterionId: 'tests-pass',
        status: 'fail',
        source: 'ci',
        detail: 'new failure',
        attempt: run.attempt
      });
      return { summary: 'Reviewed', observations: [] };
    }
  };
  const cycle = new GovernedAgentCycle(dynamic, ledger, clock());

  await cycle.planRun('run-fresh-evidence', 'Build it');
  await cycle.buildRun('run-fresh-evidence');
  await ledger.appendEvidence('run-fresh-evidence', {
    criterionId: 'tests-pass',
    status: 'pass',
    source: 'ci',
    detail: 'old pass',
    attempt: 1
  });

  const result = await cycle.verifyRun('run-fresh-evidence');
  assert.equal(result.decision, 'retry');
  assert.equal(result.run.attempt, 2);
  assert.match(result.reason, /failed: tests-pass/);
});

test('deterministic evidence can approve even when the advisory Verifier fails', async () => {
  const ledger = new InMemoryRunLedger();
  const brokenVerifier = {
    ...runtime(),
    async verify() {
      throw new Error('verifier API down');
    }
  };
  const cycle = new GovernedAgentCycle(brokenVerifier, ledger, clock());

  await cycle.planRun('run-verifier-pass', 'Build it');
  await cycle.buildRun('run-verifier-pass');
  await ledger.appendEvidence('run-verifier-pass', {
    criterionId: 'tests-pass',
    status: 'pass',
    source: 'ci',
    detail: 'passed',
    attempt: 1
  });

  const result = await cycle.verifyRun('run-verifier-pass');
  assert.equal(result.decision, 'approved');
  assert.equal(result.report, null);
  assert.match(result.verifierError, /verifier API down/);
});

test('missing evidence still retries when the advisory Verifier fails', async () => {
  const ledger = new InMemoryRunLedger();
  const brokenVerifier = {
    ...runtime(),
    async verify() {
      throw new Error('verifier API down');
    }
  };
  const cycle = new GovernedAgentCycle(brokenVerifier, ledger, clock());

  await cycle.planRun('run-verifier-retry', 'Build it');
  await cycle.buildRun('run-verifier-retry');

  const result = await cycle.verifyRun('run-verifier-retry');
  assert.equal(result.decision, 'retry');
  assert.equal(result.report, null);
  assert.match(result.verifierError, /verifier API down/);
  assert.match(result.reason, /missing: tests-pass/);
});


test('returns authoritative ledger run after Builder mutates its input snapshot', async () => {
  const ledger = new InMemoryRunLedger();
  const mutatingBuilder = {
    ...runtime(),
    async build({ run }) {
      run.status = 'approved';
      run.id = 'agent-controlled';
      run.attempt = 999;
      return {
        summary: 'Mutated input',
        artifacts: [],
        requestedEvidence: []
      };
    }
  };
  const cycle = new GovernedAgentCycle(mutatingBuilder, ledger, clock());

  await cycle.planRun('run-builder-mutation', 'Build it');
  const built = await cycle.buildRun('run-builder-mutation');

  assert.equal(built.run.id, 'run-builder-mutation');
  assert.equal(built.run.status, 'building');
  assert.equal(built.run.attempt, 1);
  assert.equal((await ledger.get('run-builder-mutation'))?.status, 'building');
});

test('advisory Verifier cannot mutate the authoritative approval run', async () => {
  const ledger = new InMemoryRunLedger();
  const mutatingVerifier = {
    ...runtime(),
    async verify({ run }) {
      run.attempt = 999;
      run.acceptanceCriteria.length = 0;
      return { summary: 'Mutated input', observations: [] };
    }
  };
  const cycle = new GovernedAgentCycle(mutatingVerifier, ledger, clock());

  await cycle.planRun('run-verifier-mutation', 'Build it');
  await cycle.buildRun('run-verifier-mutation');
  await ledger.appendEvidence('run-verifier-mutation', {
    criterionId: 'tests-pass',
    status: 'pass',
    source: 'ci',
    detail: 'passed',
    attempt: 1
  });

  const result = await cycle.verifyRun('run-verifier-mutation');
  assert.equal(result.decision, 'approved');
  assert.equal(result.run.id, 'run-verifier-mutation');
  assert.equal(result.run.attempt, 1);
  assert.deepEqual(result.run.acceptanceCriteria, ['tests-pass']);
});

test('stalled advisory Verifier times out and deterministic evidence still approves', async () => {
  const ledger = new InMemoryRunLedger();
  const stalledVerifier = {
    ...runtime(),
    async verify() {
      return new Promise(() => {});
    }
  };
  const cycle = new GovernedAgentCycle(stalledVerifier, ledger, clock(), {
    verifierTimeoutMs: 1
  });

  await cycle.planRun('run-verifier-timeout', 'Build it');
  await cycle.buildRun('run-verifier-timeout');
  await ledger.appendEvidence('run-verifier-timeout', {
    criterionId: 'tests-pass',
    status: 'pass',
    source: 'ci',
    detail: 'passed',
    attempt: 1
  });

  const result = await cycle.verifyRun('run-verifier-timeout');
  assert.equal(result.decision, 'approved');
  assert.equal(result.report, null);
  assert.match(result.verifierError, /timed out/i);
});
