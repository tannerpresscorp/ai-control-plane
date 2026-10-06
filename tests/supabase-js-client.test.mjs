import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseRunLedger } from '../dist/ledger/supabase-run-ledger.js';
import { createSupabaseRunLedgerClient } from '../dist/providers/supabase-js-client.js';

const run = {
  id: 'run-sdk',
  objective: 'Bind Supabase SDK',
  status: 'planned',
  acceptanceCriteria: ['sdk-contract'],
  requestedCapabilities: ['db.query'],
  attempt: 0,
  revision: 0,
  createdAt: '2026-10-06T09:00:00.000Z',
  updatedAt: '2026-10-06T09:00:00.000Z'
};

function rowFromRun(input) {
  return {
    id: input.id,
    objective: input.objective,
    status: input.status,
    acceptance_criteria: [...input.acceptanceCriteria],
    requested_capabilities: [...input.requestedCapabilities],
    attempt: input.attempt,
    revision: input.revision,
    created_at: input.createdAt,
    updated_at: input.updatedAt
  };
}

function headerValue(headers, name) {
  return new Headers(headers).get(name);
}

test('binds SupabaseRunLedger RPC writes to the installed @supabase/supabase-js client', async () => {
  const requests = [];
  const fetch = async (input, init = {}) => {
    requests.push({ url: String(input), init: { ...init, body: init.body ? String(init.body) : undefined } });
    return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const client = createSupabaseRunLedgerClient('https://project-ref.supabase.co', 'service-role-key', {
    global: { fetch }
  });
  const ledger = new SupabaseRunLedger(client);

  await ledger.create(run);

  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.equal(new URL(request.url).pathname, '/rest/v1/rpc/create_control_plane_run');
  assert.equal(request.init.method, 'POST');
  assert.equal(headerValue(request.init.headers, 'apikey'), 'service-role-key');
  assert.equal(headerValue(request.init.headers, 'authorization'), 'Bearer service-role-key');

  assert.deepEqual(JSON.parse(request.init.body), {
    p_run_id: run.id,
    p_objective: run.objective,
    p_status: run.status,
    p_acceptance_criteria: run.acceptanceCriteria,
    p_requested_capabilities: run.requestedCapabilities,
    p_attempt: run.attempt,
    p_revision: run.revision,
    p_created_at: run.createdAt,
    p_updated_at: run.updatedAt
  });
});

test('binds SupabaseRunLedger reads to the installed @supabase/supabase-js table query builder', async () => {
  const requests = [];
  const fetch = async (input, init = {}) => {
    requests.push({ url: String(input), init: { ...init } });
    return new Response(JSON.stringify(rowFromRun(run)), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const client = createSupabaseRunLedgerClient('https://project-ref.supabase.co', 'service-role-key', {
    global: { fetch }
  });
  const ledger = new SupabaseRunLedger(client);

  assert.deepEqual(await ledger.get(run.id), run);

  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.pathname, '/rest/v1/control_plane_runs');
  assert.equal(requestUrl.searchParams.get('select'), '*');
  assert.equal(requestUrl.searchParams.get('id'), `eq.${run.id}`);
  assert.equal(headerValue(requests[0].init.headers, 'apikey'), 'service-role-key');
  assert.equal(headerValue(requests[0].init.headers, 'authorization'), 'Bearer service-role-key');
});
