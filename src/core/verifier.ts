import type { VerificationEvidence, VerificationResult } from './types.js';

export function verifyAcceptance(
  acceptanceCriteria: readonly string[],
  evidence: readonly VerificationEvidence[]
): VerificationResult {
  const latestByCriterion = new Map<string, VerificationEvidence>();
  for (const item of evidence) latestByCriterion.set(item.criterionId, item);

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
