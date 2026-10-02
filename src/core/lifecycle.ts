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

function nextAttempt(run: RunRecord, next: RunStatus): number {
  return next === 'building' && run.status !== 'building' ? run.attempt + 1 : run.attempt;
}

function copyRun(
  run: RunRecord,
  changes: Pick<RunRecord, 'status' | 'updatedAt' | 'attempt' | 'revision'>
): RunRecord {
  return {
    ...run,
    ...changes,
    acceptanceCriteria: [...run.acceptanceCriteria],
    requestedCapabilities: [...run.requestedCapabilities]
  };
}

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
  return copyRun(run, {
    status: next,
    updatedAt,
    attempt: nextAttempt(run, next),
    revision: run.revision + 1
  });
}

export function approveRun(
  run: RunRecord,
  evidence: readonly VerificationEvidence[],
  updatedAt: string
): RunRecord {
  if (run.status !== 'verifying') {
    throw new Error(`Run must be verifying before approval: ${run.status}`);
  }

  const result = verifyAcceptance(run.acceptanceCriteria, evidence, run.attempt);
  if (!result.approved) {
    const details = [
      result.missing.includes('acceptance-criteria') ? 'acceptance criteria required' : '',
      result.missing.filter((item) => item !== 'acceptance-criteria').length
        ? `missing: ${result.missing.filter((item) => item !== 'acceptance-criteria').join(', ')}`
        : '',
      result.failed.length ? `failed: ${result.failed.join(', ')}` : ''
    ]
      .filter(Boolean)
      .join('; ');
    throw new Error(`Verification did not pass${details ? ` (${details})` : ''}`);
  }

  return copyRun(run, {
    status: 'approved',
    updatedAt,
    attempt: run.attempt,
    revision: run.revision + 1
  });
}
