import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';
import {
  REALTIME_SUPPORT_MODEL,
  createSupportAgent,
  createSupportSession
} from '../dist/support/realtime-support.js';
import { createSupportServer } from '../support-app/server.mjs';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected an internet socket address');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('constructs the realtime support agent and session against the pinned SDK', () => {
  const agent = createSupportAgent();
  const session = createSupportSession(agent);

  assert.ok(agent instanceof RealtimeAgent);
  assert.ok(session instanceof RealtimeSession);
  assert.equal(session.currentAgent, agent);
  assert.equal(REALTIME_SUPPORT_MODEL, 'gpt-realtime-2.1');
  assert.equal(agent.name, 'AI Control Plane Support');
  assert.match(String(agent.instructions), /support scope/i);
  assert.equal(agent.tools.length, 2);
});

test('mints a short-lived client secret without returning the server API key', async () => {
  const upstreamCalls = [];
  const server = createSupportServer({
    openAIKey: 'sk-server-only',
    fetchImpl: async (url, init) => {
      upstreamCalls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          value: 'ek_ephemeral_test',
          expires_at: 1_800_000_000,
          session: { type: 'realtime', model: 'gpt-realtime-2.1' }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
  });

  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/api/realtime/session`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      client_secret: 'ek_ephemeral_test',
      expires_at: 1_800_000_000
    });

    assert.equal(upstreamCalls.length, 1);
    assert.equal(upstreamCalls[0].url, 'https://api.openai.com/v1/realtime/client_secrets');
    assert.equal(upstreamCalls[0].init.headers.Authorization, 'Bearer sk-server-only');
    const requestBody = JSON.parse(upstreamCalls[0].init.body);
    assert.deepEqual(requestBody.expires_after, { anchor: 'created_at', seconds: 60 });
    assert.equal(requestBody.session.type, 'realtime');
    assert.equal(requestBody.session.model, 'gpt-realtime-2.1');
    assert.doesNotMatch(JSON.stringify(await response.clone().text()), /sk-server-only/);
  } finally {
    await close(server);
  }
});

test('placeholder support routes are explicit about not using a real ticket system', async () => {
  const server = createSupportServer({
    openAIKey: 'sk-test',
    fetchImpl: async () => new Response('{}', { status: 500 })
  });
  const baseUrl = await listen(server);

  try {
    const lookup = await fetch(`${baseUrl}/api/support/context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'How do approvals work?' })
    });
    const lookupBody = await lookup.json();
    assert.equal(lookup.status, 200);
    assert.equal(lookupBody.placeholder, true);
    assert.equal(lookupBody.product, 'AI Control Plane');

    const create = await fetch(`${baseUrl}/api/support/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ summary: 'Need help with verification' })
    });
    const createBody = await create.json();
    assert.equal(create.status, 200);
    assert.equal(createBody.placeholder, true);
    assert.match(createBody.request_id, /^PLACEHOLDER-/);
    assert.match(createBody.message, /not persisted/i);
  } finally {
    await close(server);
  }
});

test('browser app keeps credentials server-side and has no manual interruption path', async () => {
  const [browserSource, html] = await Promise.all([
    readFile(new URL('../src/support/realtime-support.ts', import.meta.url), 'utf8'),
    readFile(new URL('../support-app/public/index.html', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(browserSource, /OPENAI_API_KEY|sk-[A-Za-z0-9]/);
  assert.doesNotMatch(browserSource, /\.interrupt\s*\(|\.pause\s*\(/);
  assert.match(browserSource, /history_updated/);
  assert.match(browserSource, /session\.close\(\)/);
  assert.match(html, /id="start-call"/);
  assert.match(html, /id="end-call"/);
  assert.match(html, /id="connection-status"/);
  assert.match(html, /id="support-transcript"/);
});
