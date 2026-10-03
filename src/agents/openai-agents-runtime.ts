import type {
  AgentRuntime,
  ArchitectPlan,
  BuilderReport,
  VerifierReport
} from './contracts.js';
import {
  ARCHITECT_OUTPUT_SCHEMA,
  BUILDER_OUTPUT_SCHEMA,
  VERIFIER_OUTPUT_SCHEMA,
  type RawJsonSchemaDefinition
} from './schemas.js';
import {
  parseArchitectPlan,
  parseBuilderReport,
  parseVerifierReport
} from './validators.js';

export interface StructuredAgentDefinition {
  readonly name: string;
  readonly instructions: string;
  readonly outputType: RawJsonSchemaDefinition;
  readonly model?: string;
}

export interface StructuredAgentExecutor {
  run(definition: StructuredAgentDefinition, input: string): Promise<unknown>;
}

export interface AgentModelConfig {
  readonly architect?: string;
  readonly builder?: string;
  readonly verifier?: string;
}

function definition(
  name: string,
  instructions: string,
  outputType: RawJsonSchemaDefinition,
  model: string | undefined
): StructuredAgentDefinition {
  return model === undefined
    ? { name, instructions, outputType }
    : { name, instructions, outputType, model };
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export class OpenAIAgentsRuntime implements AgentRuntime {
  readonly #architect: StructuredAgentDefinition;
  readonly #builder: StructuredAgentDefinition;
  readonly #verifier: StructuredAgentDefinition;

  constructor(
    private readonly executor: StructuredAgentExecutor,
    models: AgentModelConfig = {}
  ) {
    this.#architect = definition(
      'Architect',
      [
        'Turn the user request into a bounded engineering objective.',
        'Return explicit acceptance criteria and the provider-neutral capabilities required.',
        'Do not grant capabilities, execute work, or claim success.',
        'Keep acceptance criteria observable and independently verifiable.'
      ].join(' '),
      ARCHITECT_OUTPUT_SCHEMA,
      models.architect
    );

    this.#builder = definition(
      'Builder',
      [
        'Describe the bounded implementation work for the supplied run.',
        'Report artifacts produced and evidence that independent verification should collect.',
        'Do not approve the run or claim that requested evidence has passed.'
      ].join(' '),
      BUILDER_OUTPUT_SCHEMA,
      models.builder
    );

    this.#verifier = definition(
      'Verifier',
      [
        'Review the supplied run and evidence and return observations.',
        'Your report is advisory only: deterministic application policy decides approval.',
        'Never invent missing evidence and never change run state.'
      ].join(' '),
      VERIFIER_OUTPUT_SCHEMA,
      models.verifier
    );
  }

  async plan(input: { readonly request: string }): Promise<ArchitectPlan> {
    const output = await this.executor.run(
      this.#architect,
      `Create a governed implementation plan for this request:\n\n${input.request}`
    );
    return parseArchitectPlan(output);
  }

  async build(input: Parameters<AgentRuntime['build']>[0]): Promise<BuilderReport> {
    const output = await this.executor.run(
      this.#builder,
      `Prepare the Builder report for this governed run:\n\n${json(input.run)}`
    );
    return parseBuilderReport(output);
  }

  async verify(input: Parameters<AgentRuntime['verify']>[0]): Promise<VerifierReport> {
    const output = await this.executor.run(
      this.#verifier,
      [
        'Review this governed run and its recorded evidence.',
        'Do not decide or mutate approval state.',
        '',
        json({ run: input.run, evidence: input.evidence })
      ].join('\n')
    );
    return parseVerifierReport(output);
  }
}
