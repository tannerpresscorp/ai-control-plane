import type { ArchitectPlan, BuilderReport, VerifierReport } from './contracts.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function invalid(role: string): never {
  throw new Error(`Invalid ${role} output`);
}

export function parseArchitectPlan(value: unknown): ArchitectPlan {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.objective) ||
    !isStringArray(value.acceptanceCriteria) ||
    value.acceptanceCriteria.length === 0 ||
    !value.acceptanceCriteria.every(isNonEmptyString) ||
    !isStringArray(value.requestedCapabilities) ||
    !value.requestedCapabilities.every(isNonEmptyString) ||
    !isNonEmptyString(value.rationale)
  ) {
    invalid('Architect');
  }

  return {
    objective: value.objective,
    acceptanceCriteria: [...value.acceptanceCriteria],
    requestedCapabilities: [...value.requestedCapabilities],
    rationale: value.rationale
  };
}

export function parseBuilderReport(value: unknown): BuilderReport {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.summary) ||
    !isStringArray(value.artifacts) ||
    !isStringArray(value.requestedEvidence)
  ) {
    invalid('Builder');
  }

  return {
    summary: value.summary,
    artifacts: [...value.artifacts],
    requestedEvidence: [...value.requestedEvidence]
  };
}

export function parseVerifierReport(value: unknown): VerifierReport {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.summary) ||
    !isStringArray(value.observations)
  ) {
    invalid('Verifier');
  }

  return {
    summary: value.summary,
    observations: [...value.observations]
  };
}
