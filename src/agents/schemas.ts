export interface JsonSchemaObject {
  readonly type: 'object';
  readonly additionalProperties: false;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
}

export interface RawJsonSchemaDefinition {
  readonly type: 'json_schema';
  readonly name: string;
  readonly strict: true;
  readonly schema: JsonSchemaObject;
}

const stringArray = {
  type: 'array',
  items: { type: 'string' }
} as const;

export const ARCHITECT_OUTPUT_SCHEMA: RawJsonSchemaDefinition = {
  type: 'json_schema',
  name: 'architect_plan',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      objective: { type: 'string' },
      acceptanceCriteria: {
        ...stringArray,
        minItems: 1
      },
      requestedCapabilities: stringArray,
      rationale: { type: 'string' }
    },
    required: ['objective', 'acceptanceCriteria', 'requestedCapabilities', 'rationale']
  }
};

export const BUILDER_OUTPUT_SCHEMA: RawJsonSchemaDefinition = {
  type: 'json_schema',
  name: 'builder_report',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      artifacts: stringArray,
      requestedEvidence: stringArray
    },
    required: ['summary', 'artifacts', 'requestedEvidence']
  }
};

export const VERIFIER_OUTPUT_SCHEMA: RawJsonSchemaDefinition = {
  type: 'json_schema',
  name: 'verifier_report',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      observations: stringArray
    },
    required: ['summary', 'observations']
  }
};
