import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createControlPlaneServer } from '../dist/server.js';

async function withServer(testBody) {
  const server = createControlPlaneServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await testBody(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('service exposes a JSON health endpoint', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    const body = await response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.name, '@tannerpress/ai-control-plane');
    assert.equal(body.service, 'ai-control-plane-api');
    assert.equal(body.version, '0.1.0');
  });
});

test('service exposes package metadata for deployment checks', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/package`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.name, '@tannerpress/ai-control-plane');
    assert.equal(body.service, 'ai-control-plane-api');
    assert.equal(body.packageType, 'library');
  });
});

test('service returns JSON 404 for unknown routes', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/missing`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'not_found');
  });
});
