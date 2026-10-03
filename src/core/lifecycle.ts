import type { RunRecord, RunStatus } from './types.js';

const TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  planned: ['building', 'failed'],
  building: ['building', 'verifying', 'failed'],
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
    throw new Error('Approval is ledger-owned; use RunLedger.approve');
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
