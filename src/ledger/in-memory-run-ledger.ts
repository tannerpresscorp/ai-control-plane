import { verifyAcceptance } from '../core/verifier.js';
import type { RunRecord, VerificationEvidence } from '../core/types.js';
import type { RunLedger } from './ports.js';

function assertValidRun(run: RunRecord): void {
  if (
    run.acceptanceCriteria.length === 0 ||
    run.acceptanceCriteria.some((criterion) => criterion.trim().length === 0)
  ) {
    throw new Error('Run acceptance criteria must contain non-empty strings');
  }
  if (!Number.isSafeInteger(run.revision) || run.revision < 0) {
    throw new Error('Run revision must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(run.attempt) || run.attempt < 0) {
    throw new Error('Run attempt must be a non-negative safe integer');
  }
}

export class InMemoryRunLedger implements RunLedger {
  readonly #runs = new Map<string, RunRecord>();
  readonly #evidence = new Map<string, VerificationEvidence[]>();

  async create(run: RunRecord): Promise<void> {
    assertValidRun(run);
    if (run.status === 'approved') {
      throw new Error('Approved runs must be created through ledger approval');
    }
    if (this.#runs.has(run.id)) throw new Error(`Run already exists: ${run.id}`);
    this.#runs.set(run.id, structuredClone(run));
  }

  async get(runId: string): Promise<RunRecord | undefined> {
    const run = this.#runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  async update(run: RunRecord): Promise<void> {
    assertValidRun(run);
    if (run.status === 'approved') {
      throw new Error('Approved state must be entered through ledger approval');
    }
    const current = this.#runs.get(run.id);
    if (!current) throw new Error(`Run not found: ${run.id}`);
    if (run.revision !== current.revision + 1) {
      throw new Error(
        `Stale run update: ${run.id} expected revision ${current.revision + 1}, got ${run.revision}`
      );
    }
    this.#runs.set(run.id, structuredClone(run));
  }

  async approve(runId: string, updatedAt: string): Promise<RunRecord> {
    const run = this.#runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status !== 'verifying') {
      throw new Error(`Run must be verifying before approval: ${run.status}`);
    }

    const evidence = (this.#evidence.get(runId) ?? []).filter(
      (item) => item.attempt === run.attempt
    );
    const result = verifyAcceptance(run.acceptanceCriteria, evidence, run.attempt);

    if (!result.approved) {
      const details = [
        result.missing.includes('acceptance-criteria') ? 'acceptance criteria required' : '',
        result.missing.filter((item) => item !== 'acceptance-criteria').length
          ? `missing: ${result.missing
              .filter((item) => item !== 'acceptance-criteria')
              .join(', ')}`
          : '',
        result.failed.length ? `failed: ${result.failed.join(', ')}` : ''
      ]
        .filter(Boolean)
        .join('; ');
      throw new Error(`Verification did not pass${details ? ` (${details})` : ''}`);
    }

    const approved: RunRecord = {
      ...run,
      status: 'approved',
      updatedAt,
      revision: run.revision + 1,
      acceptanceCriteria: [...run.acceptanceCriteria],
      requestedCapabilities: [...run.requestedCapabilities]
    };
    this.#runs.set(runId, structuredClone(approved));
    return structuredClone(approved);
  }

  async appendEvidence(runId: string, evidence: VerificationEvidence): Promise<void> {
    const run = this.#runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status !== 'building' && run.status !== 'verifying') {
      throw new Error('Evidence can only be appended while run is building or verifying');
    }
    if (!Number.isSafeInteger(evidence.attempt) || evidence.attempt <= 0) {
      throw new Error('Evidence requires a positive safe-integer build attempt');
    }
    if (evidence.attempt !== run.attempt) {
      throw new Error(
        `Evidence attempt mismatch: ${runId} expected ${run.attempt}, got ${evidence.attempt}`
      );
    }

    const items = this.#evidence.get(runId) ?? [];
    items.push(structuredClone(evidence));
    this.#evidence.set(runId, items);

    this.#runs.set(
      runId,
      structuredClone({
        ...run,
        revision: run.revision + 1
      })
    );
  }

  async listEvidence(
    runId: string,
    attempt?: number
  ): Promise<readonly VerificationEvidence[]> {
    const items = this.#evidence.get(runId) ?? [];
    const scoped = attempt === undefined ? items : items.filter((item) => item.attempt === attempt);
    return structuredClone(scoped);
  }
}
