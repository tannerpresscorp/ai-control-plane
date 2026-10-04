import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, Runner, Usage } from '@openai/agents';
import { OpenAIAgentsSdkBoundary } from '../dist/providers/openai-agents-sdk-boundary.js';
import { OpenAIAgentsExecutor } from '../dist/providers/openai-agents-executor.js';
import { OpenAIAgentsRuntime } from '../dist/agents/openai-agents-runtime.js';
import { ARCHITECT_OUTPUT_SCHEMA } from '../dist/agents/schemas.js';

// Contract tests against the installed, pinned @openai/agents SDK. The real SDK
// `Agent` and `Runner` are exercised; only the SDK's own `ModelProvider`/`Model`
// port is replaced, so no API key or network access is required.
const originalApiKey = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;
after(() => {
  if (originalApiKey !== undefined) {
    process.env.OPENAI_API_KEY = originalApiKey;
  }
});

function fakeModelProvider(respond) {
  const requestedModels = [];
  const requests = [];
  return {
    requestedModels,
    requests,
    provider: {
      getModel(modelName) {
        requestedModels.push(modelName);
        return {
          async getResponse(request) {
            requests.push(request);
            return {
              usage: new Usage(),
              responseId: `resp_${requests.length}`,
              output: [
                {
                  type: 'message',
                  role: 'assistant',
                  status: 'completed',
                  content: [{ type: 'output_text', text: respond(request) }]
                }
              ]
            };
          },
          getStreamedResponse() {
            throw new Error('streaming is not used by the boundary');
          }
        };
      }
    }
  };
}

function sdkRunner(provider) {
  return new Runner({ modelProvider: provider, tracingDisabled: true });
}

const architectDefinition = {
  name: 'Architect',
  instructions: 'Plan bounded work.',
  outputType: ARCHITECT_OUTPUT_SCHEMA,
  model: 'gpt-test'
};

test('constructs a real SDK Agent with name, instructions, model, and output schema', () => {
  const boundary = new OpenAIAgentsSdkBoundary(sdkRunner(fakeModelProvider(() => '{}').provider));

  const agent = boundary.createAgent(architectDefinition);

  assert.ok(agent instanceof Agent);
  assert.equal(agent.name, 'Architect');
  assert.equal(agent.instructions, 'Plan bounded work.');
  assert.equal(agent.model, 'gpt-test');
  assert.deepEqual(agent.outputType, ARCHITECT_OUTPUT_SCHEMA);
  assert.notEqual(agent.outputType, ARCHITECT_OUTPUT_SCHEMA);
  assert.deepEqual(agent.tools, []);
  assert.deepEqual(agent.handoffs, []);
});

test('leaves the SDK default model in place when no model is specified', async () => {
  const { provider, requestedModels } = fakeModelProvider(() => '{"ok":true}');
  const boundary = new OpenAIAgentsSdkBoundary(sdkRunner(provider));
  const { model, ...withoutModel } = architectDefinition;

  const agent = boundary.createAgent(withoutModel);
  await boundary.run(agent, 'in');

  assert.equal(agent.model, '');
  assert.equal(requestedModels.includes(model), false);
});

test('runs through the real SDK Runner and maps finalOutput into the normalized shape', async () => {
  const output = {
    objective: 'Ship governed runtime',
    acceptanceCriteria: ['tests-pass'],
    requestedCapabilities: ['repo.read'],
    rationale: 'Keep work bounded'
  };
  const { provider, requestedModels, requests } = fakeModelProvider(() => JSON.stringify(output));
  const boundary = new OpenAIAgentsSdkBoundary(sdkRunner(provider));

  const result = await boundary.run(boundary.createAgent(architectDefinition), 'Build it');

  assert.deepEqual(result, { finalOutput: output });
  assert.deepEqual(Object.keys(result), ['finalOutput']);
  assert.deepEqual(requestedModels, ['gpt-test']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].systemInstructions, 'Plan bounded work.');
  assert.equal(requests[0].outputType.type, 'json_schema');
  assert.equal(requests[0].outputType.name, 'architect_plan');
  assert.equal(requests[0].outputType.strict, true);
  assert.deepEqual(requests[0].outputType.schema, ARCHITECT_OUTPUT_SCHEMA.schema);
  assert.deepEqual(requests[0].tools, []);
  assert.deepEqual(requests[0].handoffs, []);
  assert.match(JSON.stringify(requests[0].input), /Build it/);
});

test('drives the governed runtime end to end through the installed SDK', async () => {
  const { provider } = fakeModelProvider(() =>
    JSON.stringify({
      objective: 'Ship governed runtime',
      acceptanceCriteria: ['tests-pass'],
      requestedCapabilities: ['repo.read'],
      rationale: 'Keep work bounded'
    })
  );
  const executor = new OpenAIAgentsExecutor(new OpenAIAgentsSdkBoundary(sdkRunner(provider)));
  const runtime = new OpenAIAgentsRuntime(executor, { architect: 'gpt-test' });

  const plan = await runtime.plan({ request: 'Build it' });

  assert.equal(plan.objective, 'Ship governed runtime');
  assert.deepEqual(plan.acceptanceCriteria, ['tests-pass']);
  assert.equal('approved' in plan, false);
});

test('SDK output that violates the domain contract is still rejected by local validation', async () => {
  const { provider } = fakeModelProvider(() =>
    JSON.stringify({
      objective: 'Approve myself',
      acceptanceCriteria: [],
      requestedCapabilities: [],
      rationale: 'skip checks'
    })
  );
  const executor = new OpenAIAgentsExecutor(new OpenAIAgentsSdkBoundary(sdkRunner(provider)));
  const runtime = new OpenAIAgentsRuntime(executor);

  await assert.rejects(() => runtime.plan({ request: 'Build it' }), /Invalid architect output/i);
});

test('rejects agents that were not created by this boundary', async () => {
  const runner = sdkRunner(fakeModelProvider(() => '{}').provider);
  const boundary = new OpenAIAgentsSdkBoundary(runner);
  const other = new OpenAIAgentsSdkBoundary(runner);

  await assert.rejects(() => boundary.run({ name: 'Architect' }, 'in'), /agents it created/);
  await assert.rejects(
    () => boundary.run(new Agent({ name: 'Foreign', instructions: 'x' }), 'in'),
    /agents it created/
  );
  await assert.rejects(
    () => boundary.run(other.createAgent(architectDefinition), 'in'),
    /agents it created/
  );
});

test('accepts an injected runner and rejects runs without a final output', async () => {
  const calls = [];
  const boundary = new OpenAIAgentsSdkBoundary({
    async run(agent, input) {
      calls.push({ agent, input });
      return { finalOutput: undefined, rawResponses: ['sdk-internal'] };
    }
  });
  const agent = boundary.createAgent(architectDefinition);

  await assert.rejects(() => boundary.run(agent, 'in'), /no final output/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].agent, agent);
  assert.equal(calls[0].input, 'in');
});

test('constructs with the default SDK Runner without credentials or network', () => {
  const boundary = new OpenAIAgentsSdkBoundary();
  assert.ok(boundary.createAgent(architectDefinition) instanceof Agent);
});
