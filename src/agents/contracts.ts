import type { RunRecord, VerificationEvidence } from '../core/types.js';

export interface ArchitectPlan {
  readonly objective: string;
  readonly acceptanceCriteria: readonly string[];
  readonly requestedCapabilities: readonly string[];
  readonly rationale: string;
}

export interface BuilderReport {
  readonly summary: string;
  readonly artifacts: readonly string[];
  readonly requestedEvidence: readonly string[];
}

export interface VerifierReport {
  readonly summary: string;
  readonly observations: readonly string[];
}

export interface AgentRuntime {
  plan(input: { readonly request: string }): Promise<ArchitectPlan>;
  build(input: { readonly run: RunRecord }): Promise<BuilderReport>;
  verify(input: {
    readonly run: RunRecord;
    readonly evidence: readonly VerificationEvidence[];
  }): Promise<VerifierReport>;
}
