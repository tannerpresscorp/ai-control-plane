import type {
  StructuredAgentDefinition,
  StructuredAgentExecutor
} from '../agents/openai-agents-runtime.js';

// A normalized provider boundary, not a contract for a live @openai/agents SDK.
// A future server-side slice must bind the pinned SDK behind this boundary and
// prove the translation below against the installed `Agent`/`Runner` types.
export interface OpenAIAgent {
  readonly name: string;
  readonly instructions: string;
  readonly outputType: StructuredAgentDefinition['outputType'];
  readonly model?: string;
}

export interface OpenAIRunResult {
  readonly finalOutput: unknown;
}

export interface OpenAIAgentsBoundary {
  createAgent(agent: OpenAIAgent): unknown;
  run(agent: unknown, input: string): Promise<OpenAIRunResult>;
}

function toAgent(definition: StructuredAgentDefinition): OpenAIAgent {
  return definition.model === undefined
    ? {
        name: definition.name,
        instructions: definition.instructions,
        outputType: definition.outputType
      }
    : {
        name: definition.name,
        instructions: definition.instructions,
        outputType: definition.outputType,
        model: definition.model
      };
}

function requireResult(result: OpenAIRunResult | undefined): OpenAIRunResult {
  if (result === undefined || result === null || typeof result !== 'object') {
    throw new Error('OpenAI boundary returned no run result');
  }
  if (!('finalOutput' in result)) {
    throw new Error('OpenAI run result is missing finalOutput');
  }
  return result;
}

export class OpenAIAgentsExecutor implements StructuredAgentExecutor {
  constructor(private readonly boundary: OpenAIAgentsBoundary) {}

  async run(definition: StructuredAgentDefinition, input: string): Promise<unknown> {
    const agent = this.boundary.createAgent(toAgent(definition));
    const result = requireResult(await this.boundary.run(agent, input));
    return result.finalOutput;
  }
}
