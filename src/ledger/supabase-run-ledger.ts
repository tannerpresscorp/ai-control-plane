import type { RunRecord, VerificationEvidence } from '../core/types.js';
import type { RunLedger } from './ports.js';

type SupabaseError = { message: string } | null;
type SupabaseResponse<T> = { data: T | null; error: SupabaseError };
type Awaitable<T> = PromiseLike<T>;
type Row = Record<string, unknown>;

type QueryBuilder = {
  eq(column: string, value: unknown): QueryBuilder;
  select(columns?: string): QueryBuilder;
  maybeSingle(): Awaitable<SupabaseResponse<Row>>;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
  range(from: number, to: number): Awaitable<SupabaseResponse<Row[]>>;
};

type SupabaseTable = {
  insert(value: unknown): Awaitable<SupabaseResponse<unknown>>;
  select(columns?: string): QueryBuilder;
  update(value: unknown): QueryBuilder;
};

export interface SupabaseClientLike {
  from(table: string): SupabaseTable;
}

const RUNS_TABLE = 'control_plane_runs';
const EVIDENCE_TABLE = 'control_plane_evidence';
const PAGE_SIZE = 1000;

function assertNoError(operation: string, error: SupabaseError): void {
  if (error) throw new Error(`Supabase ${operation} failed: ${error.message}`);
}

function runToRow(run: RunRecord): Row {
  return {
    id: run.id,
    objective: run.objective,
    status: run.status,
    acceptance_criteria: [...run.acceptanceCriteria],
    requested_capabilities: [...run.requestedCapabilities],
    attempt: run.attempt,
    revision: run.revision,
    created_at: run.createdAt,
    updated_at: run.updatedAt
  };
}

function rowToRun(row: Row): RunRecord {
  return {
    id: String(row.id),
    objective: String(row.objective),
    status: row.status as RunRecord['status'],
    acceptanceCriteria: Array.isArray(row.acceptance_criteria)
      ? row.acceptance_criteria.map(String)
      : [],
    requestedCapabilities: Array.isArray(row.requested_capabilities)
      ? row.requested_capabilities.map(String)
      : [],
    attempt: Number(row.attempt),
    revision: Number(row.revision),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export class SupabaseRunLedger implements RunLedger {
  constructor(private readonly client: SupabaseClientLike) {}

  async create(run: RunRecord): Promise<void> {
    const { error } = await this.client.from(RUNS_TABLE).insert(runToRow(run));
    assertNoError('create run', error);
  }

  async get(runId: string): Promise<RunRecord | undefined> {
    const { data, error } = await this.client
      .from(RUNS_TABLE)
      .select('*')
      .eq('id', runId)
      .maybeSingle();
    assertNoError('get run', error);
    return data ? rowToRun(data) : undefined;
  }

  async update(run: RunRecord): Promise<void> {
    const expectedRevision = run.revision - 1;
    const { data, error } = await this.client
      .from(RUNS_TABLE)
      .update(runToRow(run))
      .eq('id', run.id)
      .eq('revision', expectedRevision)
      .select('id,revision')
      .maybeSingle();
    assertNoError('update run', error);
    if (data) return;

    const current = await this.get(run.id);
    if (!current) throw new Error(`Run not found: ${run.id}`);
    throw new Error(
      `Stale run update: ${run.id} expected revision ${current.revision + 1}, got ${run.revision}`
    );
  }

  async appendEvidence(runId: string, evidence: VerificationEvidence): Promise<void> {
    const run = await this.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (evidence.attempt !== run.attempt) {
      throw new Error(
        `Evidence attempt mismatch: ${runId} expected ${run.attempt}, got ${evidence.attempt}`
      );
    }

    const { error } = await this.client.from(EVIDENCE_TABLE).insert({
      run_id: runId,
      attempt: evidence.attempt,
      criterion_id: evidence.criterionId,
      status: evidence.status,
      source: evidence.source,
      detail: evidence.detail
    });
    assertNoError('append evidence', error);
  }

  async listEvidence(
    runId: string,
    attempt?: number
  ): Promise<readonly VerificationEvidence[]> {
    const rows: Row[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
      let query = this.client
        .from(EVIDENCE_TABLE)
        .select('criterion_id,status,source,detail,attempt,id')
        .eq('run_id', runId);
      if (attempt !== undefined) query = query.eq('attempt', attempt);

      const { data, error } = await query
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      assertNoError('list evidence', error);
      const page = data ?? [];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    return rows.map((row) => ({
      criterionId: String(row.criterion_id),
      status: row.status as VerificationEvidence['status'],
      source: String(row.source),
      detail: String(row.detail),
      attempt: Number(row.attempt)
    }));
  }
}
