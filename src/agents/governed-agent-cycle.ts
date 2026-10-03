import { transitionRun } from '../core/lifecycle.js';
import type { RunRecord } from '../core/types.js';
import type { RunLedger } from '../ledger/ports.js';
import type { AgentRuntime, BuilderReport, VerifierReport } from './contracts.js';

export type Clock = () => string;

const DEFAULT_VERIFIER_TIMEOUT_MS = 30_000;

export interface GovernedAgentCycleOptions {
  readonly verifierTimeoutMs?: number;
}

export interface PlannedRunResult {
  readonly run: RunRecord;
  readonly rationale: string;
}

export interface BuiltRunResult {
  readonly run: RunRecord;
  readonly report: BuilderReport;
}

export type VerificationCycleResult =
  | {
      readonly decision: 'approved';
      readonly run: RunRecord;
      readonly report: VerifierReport | null;
      readonly verifierError?: string;
    }
  | {
      readonly decision: 'retry';
      readonly run: RunRecord;
      readonly report: VerifierReport | null;
      readonly verifierError?: string;
      readonly reason: string;
    };

function requireRun(run: RunRecord | undefined, runId: string): RunRecord {
  if (!run) throw new Error(`Run not found: ${runId}`);
  return run;
}

function cloneRun(run: RunRecord): RunRecord {
  return structuredClone(run) as RunRecord;
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error('Verifier timeout must be a non-negative finite number');
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Advisory verifier timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function requireAcceptanceCriteria(criteria: readonly string[]): void {
  if (
    criteria.length === 0 ||
    criteria.some(
      (criterion) => typeof criterion !== 'string' || criterion.trim().length === 0
    )
  ) {
    throw new Error('Plan must define non-empty acceptance criteria');
  }
}

export class GovernedAgentCycle {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly ledger: RunLedger,
    private readonly now: Clock = () => new Date().toISOString(),
    private readonly options: GovernedAgentCycleOptions = {}
  ) {}

  async planRun(runId: string, request: string): Promise<PlannedRunResult> {
    const plan = await this.runtime.plan({ request });
    requireAcceptanceCriteria(plan.acceptanceCriteria);

    const timestamp = this.now();
    const run: RunRecord = {
      id: runId,
      objective: plan.objective,
      status: 'planned',
      acceptanceCriteria: [...plan.acceptanceCriteria],
      requestedCapabilities: [...plan.requestedCapabilities],
      attempt: 0,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.ledger.create(run);
    return { run, rationale: plan.rationale };
  }

  async buildRun(runId: string): Promise<BuiltRunResult> {
    const current = requireRun(await this.ledger.get(runId), runId);
    const building =
      current.status === 'building'
        ? current
        : transitionRun(current, 'building', this.now());

    if (building !== current) {
      await this.ledger.update(building);
    }

    const report = await this.runtime.build({ run: cloneRun(building) });
    const authoritative = requireRun(await this.ledger.get(runId), runId);
    return { run: authoritative, report };
  }

  async verifyRun(runId: string): Promise<VerificationCycleResult> {
    const current = requireRun(await this.ledger.get(runId), runId);
    const verifying =
      current.status === 'building'
        ? transitionRun(current, 'verifying', this.now())
        : current.status === 'verifying'
          ? current
          : (() => {
              throw new Error(
                `Run must be building or verifying before verification: ${current.status}`
              );
            })();

    if (verifying !== current) {
      await this.ledger.update(verifying);
    }

    const advisoryEvidence = await this.ledger.listEvidence(runId, verifying.attempt);

    let report: VerifierReport | null = null;
    let verifierError: string | undefined;
    try {
      report = await withTimeout(
        this.runtime.verify({
          run: cloneRun(verifying),
          evidence: structuredClone(advisoryEvidence)
        }),
        this.options.verifierTimeoutMs ?? DEFAULT_VERIFIER_TIMEOUT_MS
      );
    } catch (error) {
      verifierError = error instanceof Error ? error.message : String(error);
    }

    const refreshed = requireRun(await this.ledger.get(runId), runId);
    if (refreshed.status !== 'verifying' || refreshed.attempt !== verifying.attempt) {
      throw new Error(
        `Run changed during verification: ${refreshed.status} attempt ${refreshed.attempt}`
      );
    }

    try {
      const approved = await this.ledger.approve(runId, this.now());
      return {
        decision: 'approved',
        run: approved,
        report,
        ...(verifierError ? { verifierError } : {})
      };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('Verification did not pass')) {
        throw error;
      }

      const retry = transitionRun(refreshed, 'building', this.now());
      await this.ledger.update(retry);
      return {
        decision: 'retry',
        run: retry,
        report,
        ...(verifierError ? { verifierError } : {}),
        reason: error.message
      };
    }
  }
}
