import assert from 'node:assert/strict';
import test from 'node:test';
import { createControlPlaneServer, createHealthPayload } from '../dist/server.js';

test('health payload is safe without live credentials', () => {
  const payload = createHealthPayload({
    serviceName: 'ai-control-plane-api',
    env: {},
    now: () => new Date('2026-10-06T00:00:00.000Z'),
  });

  assert.equal(payload.status, 'ok');
  assert.equal(payload.name, '@tannerpress/ai-control-plane');
  assert.equal(payload.service, 'ai-control-plane-api');
  assert.equal(payload.version, '0.1.0');
  assert.equal(payload.timestamp, '2026-10-06T00:00:00.000Z');
  assert.deepEqual(payload.credentials, {
    openaiApiKey: false,
    supabaseUrl: false,
    supabaseServiceRoleKey: false,
  });
});

test('HTTP service exposes health, readiness, metadata, and verification API', async () => {
  const server = createControlPlaneServer({ serviceName: 'ai-control-plane-api', env: {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');

  try {
    const baseUrl = 'http://127.0.0.1:' + address.port;

    const health = await fetch(baseUrl + '/health');
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('content-type'), 'application/json');
    const healthBody = await health.json();
    assert.equal(healthBody.status, 'ok');
    assert.equal(healthBody.service, 'ai-control-plane-api');

    const ready = await fetch(baseUrl + '/ready');
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).status, 'ok');

    const root = await fetch(baseUrl);
    assert.equal(root.status, 200);
    assert.equal((await root.json()).service, 'ai-control-plane-api');

    const verify = await fetch(baseUrl + '/v1/verify-acceptance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        acceptanceCriteria: ['build'],
        evidence: [{ criterionId: 'build', status: 'pass', source: 'test', detail: 'built', attempt: 1 }],
        attempt: 1,
      }),
    });
    assert.equal(verify.status, 200);
    assert.equal((await verify.json()).approved, true);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
