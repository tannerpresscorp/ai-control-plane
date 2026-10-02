import type { VerificationEvidence, VerificationResult } from './types.js';

export function verifyAcceptance(
  acceptanceCriteria: readonly string[],
  evidence: readonly VerificationEvidence[]
): VerificationResult {
  const missing: string[] = [];
  const failed: string[] = [];

  for (const criterionId of acceptanceCriteria) {
    const matching = evidence.filter((item) => item.criterionId === criterionId);
    if (matching.length === 0) {
      missing.push(criterionId);
      continue;
    }
    if (matching.some((item) => item.status === 'fail')) {
      failed.push(criterionId);
      continue;
    }
    if (!matching.some((item) => item.status === 'pass')) {
      missing.push(criterionId);
    }
  }

  return { approved: missing.length === 0 && failed.length === 0, missing, failed };
}
