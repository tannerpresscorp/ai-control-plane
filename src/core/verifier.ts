import type { VerificationEvidence, VerificationResult } from './types.js';

export function verifyAcceptance(
  acceptanceCriteria: readonly string[],
  evidence: readonly VerificationEvidence[],
  attempt?: number
): VerificationResult {
  if (acceptanceCriteria.length === 0) {
    return { approved: false, missing: ['acceptance-criteria'], failed: [] };
  }

  const scopedEvidence =
    attempt === undefined ? evidence : evidence.filter((item) => item.attempt === attempt);
  const latestByCriterion = new Map<string, VerificationEvidence>();
  for (const item of scopedEvidence) latestByCriterion.set(item.criterionId, item);

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
