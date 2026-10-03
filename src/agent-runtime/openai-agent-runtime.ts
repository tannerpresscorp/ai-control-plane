import { Agent, Runner, tool, type Model } from '@openai/agents';
import { z } from 'zod';
import { transitionRun } from '../core/lifecycle.js';
import { verifyAcceptance } from '../core/verifier.js';
import type {
  CapabilityDefinition,
  RunRecord,
  VerificationResult
} from '../core/types.js';
import { CapabilityRegistry } from '../core/capabilities.js';
import type { RunLedger } from '../ledger/ports.js';

const architectOutput = z.object({
  acceptanceCriteria: z.array(z.string()),
  requestedCapabilities: z.array(z.string())
});

export interface OpenAICapabilityTool<TParameters extends z.ZodType = z.ZodType> {
  readonly parameters: TParameters;
  readonly criterionIds: readonly string[];
  execute(input: z.output<TParameters>): unknown | Promise<unknown>;
}

export interface OpenAIAgentRuntimeOptions {
  readonly ledger: RunLedger;
  readonly capabilities: CapabilityRegistry;
  readonly tools: Readonly<Record<string, OpenAICapabilityTool>>;
  readonly model?: string | Model;
  readonly authorizeCapability?: (
    capability: CapabilityDefinition,
    input: unknown
  ) => boolean | Promise<boolean>;
  readonly now?: () => string;
}

export interface CreateRunInput {
  readonly id: string;
  readonly objective: string;
  readonly createdAt?: string;
}

export interface AgentExecutionResult {
  readonly run: RunRecord;
  readonly verification: VerificationResult;
  readonly output: unknown;
}

function outputAsText(value: unknown): string {
  if (typeof value === 'string') return value;
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}

function functionToolName(capabilityName: string): string {
  return capabilityName.replaceAll('.', '_');
}

export class OpenAIAgentRuntime {
  readonly #ledger: RunLedger;
  readonly #capabilities: CapabilityRegistry;
  readonly #tools: Readonly<Record<string, OpenAICapabilityTool>>;
  readonly #model?: string | Model;
  readonly #authorizeCapability?: OpenAIAgentRuntimeOptions['authorizeCapability'];
  readonly #runner: Runner;
  readonly #now: () => string;

  constructor(options: OpenAIAgentRuntimeOptions) {
    this.#ledger = options.ledger;
    this.#capabilities = options.capabilities;
    this.#tools = options.tools;
    this.#model = options.model;
    this.#authorizeCapability = options.authorizeCapability;
    this.#runner = new Runner({
      tracingDisabled: true,
      traceIncludeSensitiveData: false
    });
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
    if (!input.id.trim()) throw new Error('Run id must not be empty');
    if (!input.objective.trim()) throw new Error('Run objective must not be empty');

    const availableCapabilities = Object.fromEntries(
      Object.entries(this.#tools)
        .filter(([name]) => this.#capabilities.resolve(name) !== undefined)
        .map(([name, implementation]) => [name, implementation.criterionIds])
    );
    const architect = new Agent({
      name: 'Architect',
      instructions: [
        'Create a concise, testable plan for the objective.',
        'Return acceptance criteria as short stable identifiers suitable for evidence criterion IDs.',
        'Only request capabilities that are necessary and listed in the supplied capability map.',
        'Use the criterion identifiers listed for a capability exactly when its execution can provide evidence for them.'
      ].join(' '),
      outputType: architectOutput,
      ...(this.#model === undefined ? {} : { model: this.#model })
    });
    const result = await this.#runner.run(architect, JSON.stringify({
      objective: input.objective,
      availableCapabilities
    }));
    const plan = result.finalOutput;
    if (!plan) throw new Error('Architect did not return a plan');
    const { acceptanceCriteria, requestedCapabilities } = plan;

    if (
      acceptanceCriteria.length === 0 ||
      acceptanceCriteria.some((criterion) => criterion.trim().length === 0)
    ) {
      throw new Error('Architect must provide at least one non-blank acceptance criterion');
    }
    if (new Set(acceptanceCriteria).size !== acceptanceCriteria.length) {
      throw new Error('Architect must not provide duplicate acceptance criteria');
    }
    if (new Set(requestedCapabilities).size !== requestedCapabilities.length) {
      throw new Error('Architect must not request duplicate capabilities');
    }

    for (const name of requestedCapabilities) {
      if (!this.#capabilities.resolve(name)) {
        throw new Error(`Architect requested an unregistered capability: ${name}`);
      }
      if (!this.#tools[name]) {
        throw new Error(`No executable tool is configured for capability: ${name}`);
      }
      for (const criterionId of this.#tools[name].criterionIds) {
        if (!acceptanceCriteria.includes(criterionId)) {
          throw new Error(
            `Architect omitted capability ${name}'s evidence criterion: ${criterionId}`
          );
        }
      }
    }

    const createdAt = input.createdAt ?? this.#now();
    const runRecord: RunRecord = {
      id: input.id,
      objective: input.objective,
      status: 'planned',
      acceptanceCriteria,
      requestedCapabilities,
      attempt: 0,
      revision: 0,
      createdAt,
      updatedAt: createdAt
    };
    await this.#ledger.create(runRecord);
    return runRecord;
  }

  async execute(runId: string): Promise<AgentExecutionResult> {
    const initialRun = await this.#ledger.get(runId);
    if (!initialRun) throw new Error(`Run not found: ${runId}`);

    const requestedTools = initialRun.requestedCapabilities.map((name) => {
      const capability = this.#capabilities.resolve(name);
      const implementation = this.#tools[name];
      if (!capability) throw new Error(`Run requests an unregistered capability: ${name}`);
      if (!implementation) throw new Error(`No executable tool is configured for capability: ${name}`);
      for (const criterionId of implementation.criterionIds) {
        if (!initialRun.acceptanceCriteria.includes(criterionId)) {
          throw new Error(
            `Capability ${name} reports unknown acceptance criterion: ${criterionId}`
          );
        }
      }
      return { capability, implementation };
    });

    for (const { capability } of requestedTools) {
      if (capability.risk !== 'read') {
        if (!this.#authorizeCapability) {
          throw new Error(`Capability requires explicit authorization: ${capability.name}`);
        }
      }
    }
    const functionNames = requestedTools.map(({ capability }) => functionToolName(capability.name));
    if (new Set(functionNames).size !== functionNames.length) {
      throw new Error('Requested capabilities produce colliding OpenAI tool names');
    }

    if (!['planned', 'building', 'verifying'].includes(initialRun.status)) {
      throw new Error(`Run cannot be executed from status: ${initialRun.status}`);
    }
    const building = transitionRun(initialRun, 'building', this.#now());
    await this.#ledger.update(building);

    const capabilityTools = requestedTools.map(({ capability, implementation }) => {
      const name = functionToolName(capability.name);
      return tool({
        name,
        description: `${capability.name} (${capability.provider}, ${capability.risk})`,
        parameters: implementation.parameters,
        execute: async (input: unknown) => {
          let status: 'pass' | 'fail' = 'pass';
          let detail: string;
          try {
            if (capability.risk !== 'read') {
              const authorize = this.#authorizeCapability;
              if (!authorize || !(await authorize(capability, input))) {
                throw new Error(`Capability authorization denied: ${capability.name}`);
              }
            }
            detail = outputAsText(await implementation.execute(input));
          } catch (error) {
            status = 'fail';
            detail = error instanceof Error ? error.message : String(error);
          }

          for (const criterionId of implementation.criterionIds) {
            await this.#ledger.appendEvidence(runId, {
              criterionId,
              status,
              source: `openai:capability:${capability.name}`,
              detail,
              attempt: building.attempt
            });
          }
          return detail;
        }
      });
    });

    const builder = new Agent({
      name: 'Builder',
      instructions: [
        'Perform the requested work only through the supplied registered capabilities.',
        'Use tools when they can produce evidence for an acceptance criterion.',
        'Do not claim that a criterion passed unless a tool execution produced that evidence.'
      ].join(' '),
      tools: capabilityTools,
      ...(this.#model === undefined ? {} : { model: this.#model })
    });
    const result = await this.#runner.run(
      builder,
      JSON.stringify({
        objective: building.objective,
        acceptanceCriteria: building.acceptanceCriteria,
        requestedCapabilities: building.requestedCapabilities,
        attempt: building.attempt
      })
    );

    const currentRun = await this.#ledger.get(runId);
    if (!currentRun) throw new Error(`Run not found after execution: ${runId}`);
    if (currentRun.status !== 'building' || currentRun.attempt !== building.attempt) {
      throw new Error('Run changed while the agent was executing');
    }

    const verifying = transitionRun(currentRun, 'verifying', this.#now());
    await this.#ledger.update(verifying);
    const evidence = await this.#ledger.listEvidence(runId, verifying.attempt);
    const verification = verifyAcceptance(
      verifying.acceptanceCriteria,
      evidence,
      verifying.attempt
    );

    if (verification.approved) {
      return {
        run: await this.#ledger.approve(runId, this.#now()),
        verification,
        output: result.finalOutput
      };
    }

    const retry = transitionRun(verifying, 'building', this.#now());
    await this.#ledger.update(retry);
    return { run: retry, verification, output: result.finalOutput };
  }
}
