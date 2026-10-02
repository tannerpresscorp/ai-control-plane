import type { RunRecord, VerificationEvidence } from '../core/types.js';
import type { RunLedger } from './ports.js';

export class InMemoryRunLedger implements RunLedger {
  readonly #runs = new Map<string, RunRecord>();
  readonly #evidence = new Map<string, VerificationEvidence[]>();

  async create(run: RunRecord): Promise<void> {
    if (this.#runs.has(run.id)) throw new Error(`Run already exists: ${run.id}`);
    this.#runs.set(run.id, structuredClone(run));
  }

  async get(runId: string): Promise<RunRecord | undefined> {
    const run = this.#runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  async update(run: RunRecord): Promise<void> {
    const current = this.#runs.get(run.id);
    if (!current) throw new Error(`Run not found: ${run.id}`);
    if (run.revision !== current.revision + 1) {
      throw new Error(
        `Stale run update: ${run.id} expected revision ${current.revision + 1}, got ${run.revision}`
      );
    }
    this.#runs.set(run.id, structuredClone(run));
  }

  async appendEvidence(runId: string, evidence: VerificationEvidence): Promise<void> {
    const run = this.#runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (evidence.attempt !== run.attempt) {
      throw new Error(
        `Evidence attempt mismatch: ${runId} expected ${run.attempt}, got ${evidence.attempt}`
      );
    }
    const items = this.#evidence.get(runId) ?? [];
    items.push(structuredClone(evidence));
    this.#evidence.set(runId, items);
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
