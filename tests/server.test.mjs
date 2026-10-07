import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createControlPlaneServer, readServerConfig } from '../dist/server.js';

const validInput = {
  acceptanceCriteria: ['build'],
  evidence: [{ criterionId: 'build', status: 'pass', source: 'ci', detail: 'built', attempt: 1 }],
  attempt: 1,
};

async function withServer(run) {
  const server = createControlPlaneServer({ env: {} });
  const port = await listen(server);
  try {
    await run(`http://127.0.0.1:${port}`, port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function post(baseUrl, input) {
  return fetch(`${baseUrl}/v1/verify-acceptance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

function listen(server) {
  server.listen(0, '127.0.0.1');
  return once(server, 'listening').then(() => {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
    return address.port;
  });
}

test('readServerConfig uses safe defaults and environment overrides', () => {
  const config = readServerConfig({ AI_CONTROL_PLANE_HOST: '0.0.0.0', PORT: '4123' });
  assert.deepEqual(config, { host: '0.0.0.0', port: 4123 });
  assert.deepEqual(readServerConfig({ PORT: 'bad' }), { host: '127.0.0.1', port: 3000 });
  for (const port of ['0', '-1', '65536', '3.5', '', 'Infinity']) {
    assert.deepEqual(readServerConfig({ PORT: port }), { host: '127.0.0.1', port: 3000 });
  }
  assert.deepEqual(readServerConfig({ HOST: '0.0.0.0', PORT: '65535' }), { host: '0.0.0.0', port: 65535 });
});

test('verification rejects malformed evidence without approving arbitrary statuses', async () => {
  await withServer(async (baseUrl) => {
    for (const patch of [
      { status: 'approved' }, { status: null }, { criterionId: 1 }, { source: [] },
      { detail: null }, { attempt: 0 }, { attempt: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      const response = await post(baseUrl, {
        ...validInput,
        evidence: [{ ...validInput.evidence[0], ...patch }],
      });
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.error, 'invalid_request');
      assert.equal(typeof body.message, 'string');
      assert.equal(body.approved, undefined);
    }
    for (const input of [null, [], {}, { ...validInput, attempt: 0 },
      { ...validInput, attempt: '1' }, { ...validInput, acceptanceCriteria: [1] },
      { ...validInput, evidence: [null] }, { ...validInput, evidence: {} }]) {
      const response = await post(baseUrl, input);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, 'invalid_request');
    }
  });
});

test('verification preserves latest evidence, attempt scoping, and missing criteria', async () => {
  await withServer(async (baseUrl) => {
    const response = await post(baseUrl, {
      ...validInput,
      acceptanceCriteria: ['build', 'test'],
      evidence: [
        validInput.evidence[0],
        { ...validInput.evidence[0], status: 'fail' },
        { ...validInput.evidence[0], criterionId: 'test', attempt: 2 },
      ],
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { approved: false, missing: ['test'], failed: ['build'] });
    const emptyCriteria = await post(baseUrl, { ...validInput, acceptanceCriteria: [] });
    assert.deepEqual(await emptyCriteria.json(), { approved: false, missing: ['acceptance-criteria'], failed: [] });
  });
});

test('verification requires JSON and handles parse errors without echoing the request', async () => {
  await withServer(async (baseUrl) => {
    const wrongType = await fetch(`${baseUrl}/v1/verify-acceptance`, { method: 'POST', body: '{}' });
    assert.equal(wrongType.status, 415);
    assert.equal((await wrongType.json()).error, 'unsupported_media_type');
    const malformed = await fetch(`${baseUrl}/v1/verify-acceptance`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{secret-content',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, 'invalid_json');
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
  });
});

test('verification bounds both declared and streamed request body sizes', async () => {
  await withServer(async (baseUrl, port) => {
    const oversized = JSON.stringify({ ...validInput, extra: 'x'.repeat(1024 * 1024) });
    const declared = await fetch(`${baseUrl}/v1/verify-acceptance`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: oversized,
    });
    assert.equal(declared.status, 413);
    assert.equal((await declared.json()).error, 'payload_too_large');
    const streamed = await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/v1/verify-acceptance', method: 'POST',
        headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
      });
      req.on('error', reject);
      req.end(oversized);
    });
    assert.equal(streamed.status, 413);
    assert.equal(streamed.body.error, 'payload_too_large');
  });
});

test('routes report supported methods and serve HEAD without a response body', async () => {
  await withServer(async (baseUrl) => {
    const verification = await fetch(`${baseUrl}/v1/verify-acceptance`);
    assert.equal(verification.status, 405);
    assert.equal(verification.headers.get('allow'), 'POST');
    const healthPost = await fetch(`${baseUrl}/health`, { method: 'POST' });
    assert.equal(healthPost.status, 405);
    assert.equal(healthPost.headers.get('allow'), 'GET, HEAD');
    const healthHead = await fetch(`${baseUrl}/health`, { method: 'HEAD' });
    assert.equal(healthHead.status, 200);
    assert.equal(await healthHead.text(), '');
    const missing = await fetch(`${baseUrl}/missing`, { method: 'POST' });
    assert.equal(missing.status, 404);
  });
});

test('malformed request URLs return JSON errors and leave the server responsive', async () => {
  await withServer(async (baseUrl, port) => {
    const malformed = await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: '//[/' }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error, 'invalid_url');
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
  });
});

test('service startup reports an occupied port and exits unsuccessfully', async () => {
  await withServer(async (_baseUrl, port) => {
    const result = spawnSync(process.execPath, ['dist/server.js'], {
      cwd: new URL('../', import.meta.url),
      env: { ...process.env, AI_CONTROL_PLANE_HOST: '127.0.0.1', PORT: String(port) },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Unable to start ai-control-plane server: EADDRINUSE/);
  });
});

test('service signal handler closes its listener and allows the process to exit', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { createServer } from 'node:http';
    import { startServer } from './dist/server.js';
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1', () => {
      const port = reservation.address().port;
      reservation.close(() => {
        const server = startServer({ env: { PORT: String(port), AI_CONTROL_PLANE_HOST: '127.0.0.1' } });
        server.on('close', () => console.log('shutdown completed'));
        server.on('listening', () => process.emit('SIGTERM'));
      });
    });
  `], {
    cwd: new URL('../', import.meta.url),
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /shutdown completed/);
});

test('server exposes health metadata without live credentials', async () => {
  const server = createControlPlaneServer({ serviceName: 'test-plane', version: '9.9.9' });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'test-plane');
    assert.equal(body.version, '9.9.9');
    assert.equal(typeof body.uptimeSeconds, 'number');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('server verifies acceptance evidence through a JSON API', async () => {
  const server = createControlPlaneServer({ serviceName: 'test-plane', version: '9.9.9' });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/verify-acceptance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        acceptanceCriteria: ['build', 'test'],
        evidence: [
          { criterionId: 'build', status: 'pass', source: 'ci', detail: 'built', attempt: 1 },
          { criterionId: 'test', status: 'pass', source: 'ci', detail: 'passed', attempt: 1 }
        ],
        attempt: 1
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { approved: true, missing: [], failed: [] });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
