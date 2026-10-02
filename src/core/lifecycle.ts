import type { RunRecord, RunStatus, VerificationEvidence } from './types.js';
import { verifyAcceptance } from './verifier.js';

const TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  planned: ['building', 'failed'],
  building: ['verifying', 'failed'],
  verifying: ['building', 'failed'],
  approved: ['completed', 'failed'],
  completed: [],
  failed: []
};

export function canTransition(current: RunStatus, next: RunStatus): boolean {
  return TRANSITIONS[current].includes(next);
}

export function transitionRun(run: RunRecord, next: RunStatus, updatedAt: string): RunRecord {
  if (next === 'approved') {
    throw new Error('Approval requires approveRun with verification evidence');
  }
  if (!canTransition(run.status, next)) {
    throw new Error(`Illegal run transition: ${run.status} -> ${next}`);
  }
  return { ...run, status: next, updatedAt };
}

export function approveRun(
  run: RunRecord,
  evidence: readonly VerificationEvidence[],
  updatedAt: string
): RunRecord {
  if (run.status !== 'verifying') {
    throw new Error(`Run must be verifying before approval: ${run.status}`);
  }

  const result = verifyAcceptance(run.acceptanceCriteria, evidence);
  if (!result.approved) {
    const details = [
      result.missing.length ? `missing: ${result.missing.join(', ')}` : '',
      result.failed.length ? `failed: ${result.failed.join(', ')}` : ''
    ]
      .filter(Boolean)
      .join('; ');
    throw new Error(`Verification did not pass${details ? ` (${details})` : ''}`);
  }

  return { ...run, status: 'approved', updatedAt };
}
