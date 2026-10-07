import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { test } from 'node:test';
import { createControlPlaneServer } from '../dist/server.js';

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/cli.js', ...args], {
      cwd: new URL('..', import.meta.url),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function httpRequest(baseUrl, method, path, body) {
  const url = new URL(path, baseUrl);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method,
      headers: payload ? {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload).toString()
      } : undefined
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data.length ? JSON.parse(data) : undefined
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('CLI health command emits package health JSON', async () => {
  const result = await runCli(['health']);
  assert.equal(result.code, 0, result.stderr);
  const health = JSON.parse(result.stdout);
  assert.equal(health.status, 'ok');
  assert.equal(health.name, '@tannerpress/ai-control-plane');
  assert.equal(health.service, '@tannerpress/ai-control-plane');
});

test('CLI verify-acceptance command returns deterministic verifier output', async () => {
  const input = JSON.stringify({
    acceptanceCriteria: ['health'],
    evidence: [{ criterionId: 'health', status: 'pass', source: 'test', detail: 'ok', attempt: 1 }],
    attempt: 1
  });
  const result = await runCli(['verify-acceptance', '--json', input]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).approved, true);
});

test('HTTP service exposes health, package metadata, and verifier endpoints', async () => {
  const server = createControlPlaneServer({ env: {}, now: () => new Date('2026-10-06T00:00:00.000Z') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const health = await httpRequest(baseUrl, 'GET', '/health');
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(health.body.credentials.openaiApiKey, false);

    const packageInfo = await httpRequest(baseUrl, 'GET', '/api/package');
    assert.equal(packageInfo.statusCode, 200);
    assert.equal(packageInfo.body.name, '@tannerpress/ai-control-plane');
    assert.equal(packageInfo.body.endpoints.verifyAcceptance, '/v1/verify-acceptance');

    const verified = await httpRequest(baseUrl, 'POST', '/v1/verify-acceptance', {
      acceptanceCriteria: ['health'],
      evidence: [{ criterionId: 'health', status: 'pass', source: 'test', detail: 'ok', attempt: 1 }],
      attempt: 1
    });
    assert.equal(verified.statusCode, 200);
    assert.equal(verified.body.approved, true);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
