import type { RunRecord, RunStatus } from './types.js';

const TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  planned: ['building', 'failed'],
  building: ['building', 'verifying', 'failed'],
  verifying: ['building', 'failed'],
  approved: ['completed', 'failed'],
  completed: [],
  failed: []
};

function checkedNextRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Run revision cannot be incremented safely');
  }
  return revision + 1;
}

function checkedCurrentAttempt(attempt: number): number {
  if (!Number.isSafeInteger(attempt) || attempt < 0) {
    throw new Error('Run attempt must be a non-negative safe integer');
  }
  return attempt;
}

function checkedNextAttempt(attempt: number): number {
  if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Run attempt cannot be incremented safely');
  }
  return attempt + 1;
}

function nextAttempt(run: RunRecord, next: RunStatus): number {
  return next === 'building' && run.status !== 'building'
    ? checkedNextAttempt(run.attempt)
    : checkedCurrentAttempt(run.attempt);
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
    revision: checkedNextRevision(run.revision)
  });
}
