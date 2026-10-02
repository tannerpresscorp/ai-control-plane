export type RunStatus =
  | 'planned'
  | 'building'
  | 'verifying'
  | 'approved'
  | 'completed'
  | 'failed';

export type CapabilityRisk = 'read' | 'write' | 'destructive' | 'external';

export interface CapabilityDefinition {
  readonly name: string;
  readonly provider: string;
  readonly risk: CapabilityRisk;
}

export interface RunRecord {
  readonly id: string;
  readonly objective: string;
  readonly status: RunStatus;
  readonly acceptanceCriteria: readonly string[];
  readonly requestedCapabilities: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VerificationEvidence {
  readonly criterionId: string;
  readonly status: 'pass' | 'fail';
  readonly source: string;
  readonly detail: string;
}

export interface VerificationResult {
  readonly approved: boolean;
  readonly missing: readonly string[];
  readonly failed: readonly string[];
}
