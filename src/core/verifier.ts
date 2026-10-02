import type { VerificationEvidence, VerificationResult } from './types.js';

export function verifyAcceptance(
  acceptanceCriteria: readonly string[],
  evidence: readonly VerificationEvidence[],
  attempt: number
): VerificationResult {
  if (!Number.isInteger(attempt) || attempt <= 0) {
    throw new Error('Verification requires a positive build attempt');
  }

  if (
    acceptanceCriteria.length === 0 ||
    acceptanceCriteria.some((criterion) => criterion.trim().length === 0)
  ) {
    return { approved: false, missing: ['acceptance-criteria'], failed: [] };
  }

  const latestByCriterion = new Map<string, VerificationEvidence>();
  for (const item of evidence) {
    if (item.attempt === attempt) latestByCriterion.set(item.criterionId, item);
  }

  const missing: string[] = [];
  const failed: string[] = [];

  for (const criterionId of acceptanceCriteria) {
    const latest = latestByCriterion.get(criterionId);
    if (!latest) {
      missing.push(criterionId);
    } else if (latest.status === 'fail') {
      failed.push(criterionId);
    }
  }

  return { approved: missing.length === 0 && failed.length === 0, missing, failed };
}
