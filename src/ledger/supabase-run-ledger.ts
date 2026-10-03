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
  select(columns?: string): QueryBuilder;
};
export interface SupabaseClientPort {
  from(table: string): SupabaseTable;
  rpc(name: string, args: Readonly<Record<string, unknown>>): Awaitable<SupabaseResponse<unknown>>;
}

const RUNS_TABLE = 'control_plane_runs';
const EVIDENCE_TABLE = 'control_plane_evidence';
const PAGE_SIZE = 1000;

function assertNoError(operation: string, error: SupabaseError): void {
  if (error) throw new Error(`Supabase ${operation} failed: ${error.message}`);
}
function safeInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Supabase ${field} must be a non-negative safe integer`);
  }
  return parsed;
}
function runToRow(run: RunRecord): Row {
  safeInteger(run.attempt, 'attempt');
  safeInteger(run.revision, 'revision');
  return {
    id: run.id, objective: run.objective, status: run.status,
    acceptance_criteria: [...run.acceptanceCriteria],
    requested_capabilities: [...run.requestedCapabilities],
    attempt: run.attempt, revision: run.revision,
    created_at: run.createdAt, updated_at: run.updatedAt
  };
}
function rowToRun(row: Row): RunRecord {
  return {
    id: String(row.id), objective: String(row.objective),
    status: row.status as RunRecord['status'],
    acceptanceCriteria: Array.isArray(row.acceptance_criteria) ? row.acceptance_criteria.map(String) : [],
    requestedCapabilities: Array.isArray(row.requested_capabilities) ? row.requested_capabilities.map(String) : [],
    attempt: safeInteger(row.attempt, 'attempt'),
    revision: safeInteger(row.revision, 'revision'),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

export class SupabaseRunLedger implements RunLedger {
  constructor(private readonly client: SupabaseClientPort) {}

  async create(run: RunRecord): Promise<void> {
    if (run.status === 'approved') throw new Error('Approved runs must be created through ledger approval');
    runToRow(run);
    const { error } = await this.client.rpc('create_control_plane_run', {
      p_run_id: run.id,
      p_objective: run.objective,
      p_status: run.status,
      p_acceptance_criteria: [...run.acceptanceCriteria],
      p_requested_capabilities: [...run.requestedCapabilities],
      p_attempt: run.attempt,
      p_revision: run.revision,
      p_created_at: run.createdAt,
      p_updated_at: run.updatedAt
    });
    assertNoError('create run', error);
  }

  async get(runId: string): Promise<RunRecord | undefined> {
    const { data, error } = await this.client.from(RUNS_TABLE).select('*').eq('id', runId).maybeSingle();
    assertNoError('get run', error);
    return data ? rowToRun(data) : undefined;
  }

  async update(run: RunRecord): Promise<void> {
    if (run.status === 'approved') throw new Error('Approved state must be entered through ledger approval');
    runToRow(run);
    const { error } = await this.client.rpc('update_control_plane_run', {
      p_run_id: run.id,
      p_status: run.status,
      p_attempt: run.attempt,
      p_revision: run.revision,
      p_objective: run.objective,
      p_acceptance_criteria: [...run.acceptanceCriteria],
      p_requested_capabilities: [...run.requestedCapabilities],
      p_updated_at: run.updatedAt
    });
    assertNoError('update run', error);
  }

  async approve(runId: string, updatedAt: string): Promise<RunRecord> {
    const { data, error } = await this.client.rpc('approve_control_plane_run', {
      p_run_id: runId, p_updated_at: updatedAt
    });
    assertNoError('approve run', error);
    if (!data || typeof data !== 'object')
      throw new Error(`Supabase approve run failed: missing run result for ${runId}`);
    return rowToRun(data as Row);
  }

  async appendEvidence(runId: string, evidence: VerificationEvidence): Promise<void> {
    if (!Number.isSafeInteger(evidence.attempt) || evidence.attempt <= 0)
      throw new Error('Evidence requires a positive safe-integer build attempt');
    const { error } = await this.client.rpc('append_control_plane_evidence', {
      p_run_id: runId, p_attempt: evidence.attempt, p_criterion_id: evidence.criterionId,
      p_status: evidence.status, p_source: evidence.source, p_detail: evidence.detail
    });
    assertNoError('append evidence', error);
  }

  async listEvidence(runId: string, attempt?: number): Promise<readonly VerificationEvidence[]> {
    const rows: Row[] = [];
    let from = 0;
    for (;;) {
      let query = this.client.from(EVIDENCE_TABLE)
        .select('criterion_id,status,source,detail,attempt,id').eq('run_id', runId);
      if (attempt !== undefined) query = query.eq('attempt', attempt);
      const { data, error } = await query.order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1);
      assertNoError('list evidence', error);
      const page = data ?? [];
      if (page.length === 0) break;
      rows.push(...page);
      from += page.length;
    }
    return rows.map((row) => ({
      criterionId: String(row.criterion_id), status: row.status as VerificationEvidence['status'],
      source: String(row.source), detail: String(row.detail), attempt: safeInteger(row.attempt, 'evidence attempt')
    }));
  }
}
