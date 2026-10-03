import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIAgentsRuntime } from '../dist/agents/openai-agents-runtime.js';

function productionShapedExecutor(outputs) {
  const calls = [];
  return {
    calls,
    executor: {
      async run(definition, input) {
        calls.push({ definition, input });
        return outputs[definition.name];
      }
    }
  };
}

test('runs structured agent definitions through the executor boundary', async () => {
  const { executor, calls } = productionShapedExecutor({
    Architect: {
      objective: 'Ship governed runtime',
      acceptanceCriteria: ['tests-pass'],
      requestedCapabilities: ['repo.read'],
      rationale: 'Keep work bounded'
    },
    Builder: {
      summary: 'Implemented',
      artifacts: ['src/a.ts'],
      requestedEvidence: ['tests-pass']
    },
    Verifier: {
      summary: 'Evidence reviewed',
      observations: ['CI passed']
    }
  });

  const runtime = new OpenAIAgentsRuntime(executor, {
    architect: 'gpt-test',
    builder: 'gpt-test',
    verifier: 'gpt-test'
  });

  const plan = await runtime.plan({ request: 'Build it' });
  assert.equal(plan.objective, 'Ship governed runtime');
  assert.equal(calls[0].definition.name, 'Architect');
  assert.equal(calls[0].definition.model, 'gpt-test');
  assert.equal(calls[0].definition.outputType.type, 'json_schema');
  assert.equal(calls[0].definition.outputType.schema.type, 'object');
  assert.equal(calls[0].definition.outputType.schema.additionalProperties, false);
  assert.ok(Array.isArray(calls[0].definition.outputType.schema.required));
});

test('rejects malformed raw JSON-schema output returned by the executor', async () => {
  const { executor } = productionShapedExecutor({
    Architect: {
      objective: 'bad',
      acceptanceCriteria: 'not-an-array'
    }
  });

  const runtime = new OpenAIAgentsRuntime(executor);
  await assert.rejects(
    () => runtime.plan({ request: 'Build it' }),
    /Invalid Architect output/
  );
});
