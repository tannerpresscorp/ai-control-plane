import { canTransition } from '../core/lifecycle.js';
import { verifyAcceptance } from '../core/verifier.js';
import type { RunRecord, VerificationEvidence } from '../core/types.js';
import type { RunLedger } from './ports.js';

function assertValidRun(run: RunRecord): void {
  if (
    run.acceptanceCriteria.length === 0 ||
    run.acceptanceCriteria.some((criterion) => criterion.trim().length === 0)
  ) throw new Error('Run acceptance criteria must contain non-empty strings');
  if (!Number.isSafeInteger(run.revision) || run.revision < 0)
    throw new Error('Run revision must be a non-negative safe integer');
  if (!Number.isSafeInteger(run.attempt) || run.attempt < 0)
    throw new Error('Run attempt must be a non-negative safe integer');
}

function checkedNextRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER)
    throw new Error('Run revision cannot be incremented safely');
  return revision + 1;
}

function assertGovernedUpdate(current: RunRecord, next: RunRecord): void {
  if (next.status === 'approved')
    throw new Error('Approved state must be entered through ledger approval');
  if (!canTransition(current.status, next.status))
    throw new Error(`Illegal run transition: ${current.status} -> ${next.status}`);

  const expectedAttempt =
    next.status === 'building' && current.status !== 'building'
      ? current.attempt + 1
      : current.attempt;
  if (next.attempt !== expectedAttempt)
    throw new Error(
      `Invalid run attempt transition: expected ${expectedAttempt}, got ${next.attempt}`
    );

  const expectedRevision = checkedNextRevision(current.revision);
  if (next.revision !== expectedRevision)
    throw new Error(
      `Stale run update: ${next.id} expected revision ${expectedRevision}, got ${next.revision}`
    );
}

export class InMemoryRunLedger implements RunLedger {
  readonly #runs = new Map<string, RunRecord>();
  readonly #evidence = new Map<string, VerificationEvidence[]>();

  async create(run: RunRecord): Promise<void> {
    assertValidRun(run);
    if (run.status === 'approved') throw new Error('Approved runs must be created through ledger approval');
    if (run.status !== 'planned') throw new Error(`Run must be created in planned state: ${run.status}`);
    if (run.attempt !== 0) throw new Error('Run must be created at attempt 0');
    if (run.revision !== 0) throw new Error('Run must be created at revision 0');
    if (this.#runs.has(run.id)) throw new Error(`Run already exists: ${run.id}`);
    this.#runs.set(run.id, structuredClone(run));
  }

  async get(runId: string): Promise<RunRecord | undefined> {
    const run = this.#runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  async update(run: RunRecord): Promise<void> {
    assertValidRun(run);
    const current = this.#runs.get(run.id);
    if (!current) throw new Error(`Run not found: ${run.id}`);
    assertGovernedUpdate(current, run);
    this.#runs.set(run.id, structuredClone(run));
  }

  async approve(runId: string, updatedAt: string): Promise<RunRecord> {
    const run = this.#runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status !== 'verifying')
      throw new Error(`Run must be verifying before approval: ${run.status}`);

    const evidence = (this.#evidence.get(runId) ?? []).filter((item) => item.attempt === run.attempt);
    const result = verifyAcceptance(run.acceptanceCriteria, evidence, run.attempt);
    if (!result.approved) {
      const missing = result.missing.filter((item) => item !== 'acceptance-criteria');
      const details = [
        result.missing.includes('acceptance-criteria') ? 'acceptance criteria required' : '',
        missing.length ? `missing: ${missing.join(', ')}` : '',
        result.failed.length ? `failed: ${result.failed.join(', ')}` : ''
      ].filter(Boolean).join('; ');
      throw new Error(`Verification did not pass${details ? ` (${details})` : ''}`);
    }

    const approved: RunRecord = {
      ...run,
      status: 'approved',
      updatedAt,
      revision: checkedNextRevision(run.revision),
      acceptanceCriteria: [...run.acceptanceCriteria],
      requestedCapabilities: [...run.requestedCapabilities]
    };
    this.#runs.set(runId, structuredClone(approved));
    return structuredClone(approved);
  }

  async appendEvidence(runId: string, evidence: VerificationEvidence): Promise<void> {
    const run = this.#runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status !== 'building' && run.status !== 'verifying')
      throw new Error('Evidence can only be appended while run is building or verifying');
    if (!Number.isSafeInteger(evidence.attempt) || evidence.attempt <= 0)
      throw new Error('Evidence requires a positive safe-integer build attempt');
    if (evidence.attempt !== run.attempt)
      throw new Error(`Evidence attempt mismatch: ${runId} expected ${run.attempt}, got ${evidence.attempt}`);

    const nextRevision = checkedNextRevision(run.revision);
    const items = this.#evidence.get(runId) ?? [];
    this.#evidence.set(runId, [...items, structuredClone(evidence)]);
    this.#runs.set(runId, structuredClone({ ...run, revision: nextRevision }));
  }

  async listEvidence(runId: string, attempt?: number): Promise<readonly VerificationEvidence[]> {
    const items = this.#evidence.get(runId) ?? [];
    return structuredClone(
      attempt === undefined ? items : items.filter((item) => item.attempt === attempt)
    );
  }
}
