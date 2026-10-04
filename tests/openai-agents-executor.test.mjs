import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIAgentsExecutor } from '../dist/providers/openai-agents-executor.js';
import { OpenAIAgentsRuntime } from '../dist/agents/openai-agents-runtime.js';

// A production-shaped boundary fake that mimics the @openai/agents translation
// StructuredAgentDefinition -> Agent -> Runner.run(agent, input) -> finalOutput
// without binding the real SDK.
function productionShapedBoundary(outputsByAgentName) {
  const createdAgents = [];
  const runs = [];
  return {
    createdAgents,
    runs,
    boundary: {
      createAgent(agent) {
        createdAgents.push(agent);
        return { __agent: agent };
      },
      async run(agent, input) {
        const name = agent.__agent.name;
        runs.push({ name, input });
        return { finalOutput: outputsByAgentName[name] };
      }
    }
  };
}

test('translates definition to agent and returns the runner finalOutput', async () => {
  const { boundary, createdAgents, runs } = productionShapedBoundary({
    Architect: {
      objective: 'Ship governed runtime',
      acceptanceCriteria: ['tests-pass'],
      requestedCapabilities: ['repo.read'],
      rationale: 'Keep work bounded'
    }
  });

  const executor = new OpenAIAgentsExecutor(boundary);
  const runtime = new OpenAIAgentsRuntime(executor, { architect: 'gpt-test' });

  const plan = await runtime.plan({ request: 'Build it' });

  assert.equal(plan.objective, 'Ship governed runtime');
  assert.equal(createdAgents.length, 1);
  assert.equal(createdAgents[0].name, 'Architect');
  assert.equal(createdAgents[0].model, 'gpt-test');
  assert.equal(createdAgents[0].outputType.type, 'json_schema');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].name, 'Architect');
  assert.match(runs[0].input, /Build it/);
});

test('omits model when the agent definition does not specify one', async () => {
  const { boundary, createdAgents } = productionShapedBoundary({
    Architect: {
      objective: 'Ship it',
      acceptanceCriteria: ['tests-pass'],
      requestedCapabilities: [],
      rationale: 'bounded'
    }
  });

  const executor = new OpenAIAgentsExecutor(boundary);
  const runtime = new OpenAIAgentsRuntime(executor);

  await runtime.plan({ request: 'Build it' });

  assert.equal('model' in createdAgents[0], false);
});

test('rejects a boundary result that is missing finalOutput', async () => {
  const executor = new OpenAIAgentsExecutor({
    createAgent(agent) {
      return agent;
    },
    async run() {
      return {};
    }
  });

  await assert.rejects(
    () => executor.run({ name: 'Architect', instructions: 'x', outputType: {} }, 'in'),
    /missing finalOutput/
  );
});

test('rejects a boundary that returns no run result', async () => {
  const executor = new OpenAIAgentsExecutor({
    createAgent(agent) {
      return agent;
    },
    async run() {
      return undefined;
    }
  });

  await assert.rejects(
    () => executor.run({ name: 'Architect', instructions: 'x', outputType: {} }, 'in'),
    /no run result/
  );
});
