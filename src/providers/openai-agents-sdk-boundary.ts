import { Agent, Runner, type JsonSchemaDefinition } from '@openai/agents';
import type {
  OpenAIAgent,
  OpenAIAgentsBoundary,
  OpenAIRunResult
} from './openai-agents-executor.js';

// Server-side binding of `OpenAIAgentsBoundary` to the pinned `@openai/agents`
// SDK. SDK `Agent` and `RunResult` objects stay inside this module: callers only
// receive an opaque agent handle and the normalized `{ finalOutput }` shape.
// The final output remains advisory raw output that `OpenAIAgentsRuntime`
// validates locally before it becomes a domain type.
export type OpenAIAgentsSdkRunner = Pick<Runner, 'run'>;

type SdkAgent = Agent<unknown, JsonSchemaDefinition>;
type SdkSchemaProperties = JsonSchemaDefinition['schema']['properties'];

function toProperties(properties: OpenAIAgent['outputType']['schema']['properties']): SdkSchemaProperties {
  const copy: SdkSchemaProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Output schema property "${key}" must be a JSON Schema object`);
    }
    copy[key] = { ...value };
  }
  return copy;
}

function toOutputType(outputType: OpenAIAgent['outputType']): JsonSchemaDefinition {
  return {
    type: outputType.type,
    name: outputType.name,
    strict: outputType.strict,
    schema: {
      type: outputType.schema.type,
      additionalProperties: outputType.schema.additionalProperties,
      properties: toProperties(outputType.schema.properties),
      required: [...outputType.schema.required]
    }
  };
}

export class OpenAIAgentsSdkBoundary implements OpenAIAgentsBoundary {
  readonly #created = new WeakSet<SdkAgent>();

  constructor(private readonly runner: OpenAIAgentsSdkRunner = new Runner()) {}

  createAgent(agent: OpenAIAgent): unknown {
    const outputType = toOutputType(agent.outputType);
    const sdkAgent: SdkAgent =
      agent.model === undefined
        ? new Agent({ name: agent.name, instructions: agent.instructions, outputType })
        : new Agent({
            name: agent.name,
            instructions: agent.instructions,
            outputType,
            model: agent.model
          });
    this.#created.add(sdkAgent);
    return sdkAgent;
  }

  async run(agent: unknown, input: string): Promise<OpenAIRunResult> {
    if (!(agent instanceof Agent) || !this.#created.has(agent)) {
      throw new Error('OpenAI SDK boundary can only run agents it created');
    }
    const result = await this.runner.run(agent, input);
    if (result.finalOutput === undefined) {
      throw new Error('OpenAI SDK run produced no final output');
    }
    return { finalOutput: result.finalOutput };
  }
}
