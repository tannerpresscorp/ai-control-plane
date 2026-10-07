import type { VerificationEvidence, VerificationResult } from './core/types.js';
import { verifyAcceptance } from './core/verifier.js';

export const MAX_VERIFICATION_INPUT_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireAttempt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  return value;
}

/** Validate the public JSON boundary before calling the typed, deterministic verifier. */
export function verifyAcceptanceInput(value: unknown): VerificationResult {
  if (!isRecord(value)) throw new Error('Verification input must be an object');
  if (!Array.isArray(value.acceptanceCriteria) || value.acceptanceCriteria.some((item) => typeof item !== 'string')) {
    throw new Error('acceptanceCriteria must be an array of strings');
  }
  if (!Array.isArray(value.evidence)) throw new Error('evidence must be an array');
  const attempt = requireAttempt(value.attempt, 'attempt');
  const evidence: VerificationEvidence[] = value.evidence.map((item: unknown, index: number) => {
    const field = `evidence[${index}]`;
    if (!isRecord(item)) throw new Error(`${field} must be an object`);
    if (item.status !== 'pass' && item.status !== 'fail') {
      throw new Error(`${field}.status must be pass or fail`);
    }
    return {
      criterionId: requireString(item.criterionId, `${field}.criterionId`),
      status: item.status,
      source: requireString(item.source, `${field}.source`),
      detail: requireString(item.detail, `${field}.detail`),
      attempt: requireAttempt(item.attempt, `${field}.attempt`),
    };
  });
  return verifyAcceptance(value.acceptanceCriteria, evidence, attempt);
}
