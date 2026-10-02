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
    if (!this.#runs.has(run.id)) throw new Error(`Run not found: ${run.id}`);
    this.#runs.set(run.id, structuredClone(run));
  }

  async appendEvidence(runId: string, evidence: VerificationEvidence): Promise<void> {
    if (!this.#runs.has(runId)) throw new Error(`Run not found: ${runId}`);
    const items = this.#evidence.get(runId) ?? [];
    items.push(structuredClone(evidence));
    this.#evidence.set(runId, items);
  }

  async listEvidence(runId: string): Promise<readonly VerificationEvidence[]> {
    return structuredClone(this.#evidence.get(runId) ?? []);
  }
}
