import type { RunRecord, VerificationEvidence } from '../core/types.js';
import type { RunLedger } from './ports.js';

type SupabaseError = { message: string } | null;
type SupabaseResponse<T> = { data: T; error: SupabaseError };

type MaybeSingleBuilder = {
  maybeSingle(): Promise<SupabaseResponse<Record<string, unknown> | null>>;
};

type OrderedBuilder = {
  order(
    column: string,
    options: { ascending: boolean }
  ): Promise<SupabaseResponse<Record<string, unknown>[]>>;
};

type FilterBuilder = MaybeSingleBuilder &
  OrderedBuilder & {
    eq(column: string, value: unknown): FilterBuilder;
    select(columns?: string): FilterBuilder;
  };

type UpdateBuilder = {
  eq(column: string, value: unknown): {
    select(columns?: string): MaybeSingleBuilder;
  };
};

type SupabaseTable = {
  insert(value: unknown): Promise<SupabaseResponse<unknown>>;
  select(columns?: string): FilterBuilder;
  update(value: unknown): UpdateBuilder;
};

export interface SupabaseClientLike {
  from(table: string): SupabaseTable;
}

const RUNS_TABLE = 'control_plane_runs';
const EVIDENCE_TABLE = 'control_plane_evidence';

function assertNoError(operation: string, error: SupabaseError): void {
  if (error) throw new Error(`Supabase ${operation} failed: ${error.message}`);
}

function runToRow(run: RunRecord): Record<string, unknown> {
  return {
    id: run.id,
    objective: run.objective,
    status: run.status,
    acceptance_criteria: [...run.acceptanceCriteria],
    requested_capabilities: [...run.requestedCapabilities],
    created_at: run.createdAt,
    updated_at: run.updatedAt
  };
}

function rowToRun(row: Record<string, unknown>): RunRecord {
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
    const { data, error } = await this.client
      .from(RUNS_TABLE)
      .update(runToRow(run))
      .eq('id', run.id)
      .select('id')
      .maybeSingle();
    assertNoError('update run', error);
    if (!data) throw new Error(`Run not found: ${run.id}`);
  }

  async appendEvidence(runId: string, evidence: VerificationEvidence): Promise<void> {
    const { error } = await this.client.from(EVIDENCE_TABLE).insert({
      run_id: runId,
      criterion_id: evidence.criterionId,
      status: evidence.status,
      source: evidence.source,
      detail: evidence.detail
    });
    assertNoError('append evidence', error);
  }

  async listEvidence(runId: string): Promise<readonly VerificationEvidence[]> {
    const { data, error } = await this.client
      .from(EVIDENCE_TABLE)
      .select('criterion_id,status,source,detail,id')
      .eq('run_id', runId)
      .order('id', { ascending: true });
    assertNoError('list evidence', error);
    return data.map((row) => ({
      criterionId: String(row.criterion_id),
      status: row.status as VerificationEvidence['status'],
      source: String(row.source),
      detail: String(row.detail)
    }));
  }
}
