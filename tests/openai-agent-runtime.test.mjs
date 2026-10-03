import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  assistantMessage,
  functionCall,
  modelResponse,
  ScriptedModel
} from '@openai/agents/testing';
import {
  CapabilityRegistry,
  InMemoryRunLedger,
  OpenAIAgentRuntime
} from '../dist/index.js';

function createRuntime(
  model,
  capabilityRisk = 'read',
  execute = async () => 'checked',
  authorizeCapability
) {
  const capabilities = new CapabilityRegistry();
  capabilities.register({
    name: 'repo.read',
    provider: 'test',
    risk: capabilityRisk
  });
  const ledger = new InMemoryRunLedger();
  const runtime = new OpenAIAgentRuntime({
    ledger,
    capabilities,
    model,
    authorizeCapability,
    now: () => '2026-10-03T00:00:00.000Z',
    tools: {
      'repo.read': {
        parameters: z.object({ path: z.string() }),
        criterionIds: ['repository-inspected'],
        execute
      }
    }
  });
  return { runtime, ledger };
}

test('Architect creates a persisted plan and Builder executes only registered tools before ledger approval', async () => {
  const model = new ScriptedModel([
    modelResponse([assistantMessage(JSON.stringify({
      acceptanceCriteria: ['repository-inspected'],
      requestedCapabilities: ['repo.read']
    }))]),
    modelResponse([functionCall('repo_read', { path: 'README.md' }, { callId: 'call-1' })]),
    modelResponse([assistantMessage('Repository inspected')])
  ]);
  const executedPaths = [];
  const { runtime, ledger } = createRuntime(model, 'read', async ({ path }) => {
    executedPaths.push(path);
    return 'README inspected';
  });

  const planned = await runtime.createRun({
    id: 'run-1',
    objective: 'Inspect the repository'
  });
  assert.equal(planned.status, 'planned');
  assert.deepEqual(planned.acceptanceCriteria, ['repository-inspected']);

  const result = await runtime.execute(planned.id);
  model.assertComplete();

  assert.deepEqual(executedPaths, ['README.md']);
  assert.equal(result.run.status, 'approved');
  assert.deepEqual(result.verification, { approved: true, missing: [], failed: [] });
  assert.equal((await ledger.listEvidence(planned.id))[0].source, 'openai:capability:repo.read');
});

test('rejects a non-read capability without explicit authorization before changing run state', async () => {
  const model = new ScriptedModel([
    modelResponse([assistantMessage(JSON.stringify({
      acceptanceCriteria: ['repository-inspected'],
      requestedCapabilities: ['repo.read']
    }))])
  ]);
  const { runtime, ledger } = createRuntime(model, 'write');
  const planned = await runtime.createRun({
    id: 'run-2',
    objective: 'Inspect the repository'
  });

  await assert.rejects(() => runtime.execute(planned.id), /requires explicit authorization/);
  assert.equal((await ledger.get(planned.id)).status, 'planned');
  model.assertComplete();
});

test('authorizes non-read capability calls with their exact inputs before execution', async () => {
  const model = new ScriptedModel([
    modelResponse([assistantMessage(JSON.stringify({
      acceptanceCriteria: ['repository-inspected'],
      requestedCapabilities: ['repo.read']
    }))]),
    modelResponse([functionCall('repo_read', { path: 'README.md' }, { callId: 'call-2' })]),
    modelResponse([assistantMessage('Repository inspected')])
  ]);
  const calls = [];
  const { runtime } = createRuntime(
    model,
    'write',
    async (input) => {
      calls.push(['execute', input]);
      return 'completed';
    },
    async (capability, input) => {
      calls.push(['authorize', capability.name, input]);
      return true;
    }
  );
  const planned = await runtime.createRun({
    id: 'run-4',
    objective: 'Inspect the repository'
  });

  const result = await runtime.execute(planned.id);
  model.assertComplete();

  assert.equal(result.run.status, 'approved');
  assert.deepEqual(calls, [
    ['authorize', 'repo.read', { path: 'README.md' }],
    ['execute', { path: 'README.md' }]
  ]);
});

test('returns a failed verification to building with a new attempt when the Builder produces no evidence', async () => {
  const model = new ScriptedModel([
    modelResponse([assistantMessage(JSON.stringify({
      acceptanceCriteria: ['repository-inspected'],
      requestedCapabilities: ['repo.read']
    }))]),
    modelResponse([assistantMessage('I could not inspect the repository')])
  ]);
  const { runtime } = createRuntime(model);
  const planned = await runtime.createRun({
    id: 'run-3',
    objective: 'Inspect the repository'
  });

  const result = await runtime.execute(planned.id);
  model.assertComplete();

  assert.equal(result.run.status, 'building');
  assert.equal(result.run.attempt, 2);
  assert.deepEqual(result.verification, {
    approved: false,
    missing: ['repository-inspected'],
    failed: []
  });
});
