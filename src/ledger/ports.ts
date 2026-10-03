import type { RunRecord, VerificationEvidence } from '../core/types.js';

export interface RunLedger {
  create(run: RunRecord): Promise<void>;
  get(runId: string): Promise<RunRecord | undefined>;
  update(run: RunRecord): Promise<void>;
  approve(runId: string, updatedAt: string): Promise<RunRecord>;
  appendEvidence(runId: string, evidence: VerificationEvidence): Promise<void>;
  listEvidence(runId: string, attempt?: number): Promise<readonly VerificationEvidence[]>;
}
