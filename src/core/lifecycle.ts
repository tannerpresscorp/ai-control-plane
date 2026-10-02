import type { RunRecord, RunStatus } from './types.js';

const TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  planned: ['building', 'failed'],
  building: ['verifying', 'failed'],
  verifying: ['approved', 'failed'],
  approved: ['completed', 'failed'],
  completed: [],
  failed: []
};

export function canTransition(current: RunStatus, next: RunStatus): boolean {
  return TRANSITIONS[current].includes(next);
}

export function transitionRun(run: RunRecord, next: RunStatus, updatedAt: string): RunRecord {
  if (!canTransition(run.status, next)) {
    throw new Error(`Illegal run transition: ${run.status} -> ${next}`);
  }
  return { ...run, status: next, updatedAt };
}
