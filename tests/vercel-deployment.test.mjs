import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { access, readFile } from 'node:fs/promises';

const repoRoot = new URL('../', import.meta.url);

test('Vercel builds the Node service instead of publishing dist as static files', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.framework, 'node');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, undefined);
});

test('Vercel root entrypoint exports the HTTP request handler', { timeout: 15_000 }, async () => {
  await access(new URL('../server.js', import.meta.url));
  const moduleUrl = new URL(`../server.js?test=${Date.now()}`, import.meta.url);
  const imported = await import(moduleUrl.href);
  assert.equal(typeof imported.default, 'function');

  const server = createServer(imported.default);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5_000) });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
    const response = await fetch(`${baseUrl}/v1/verify-acceptance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        acceptanceCriteria: ['build'],
        evidence: [{ criterionId: 'build', status: 'pass', source: 'ci', detail: 'built', attempt: 1 }],
        attempt: 1,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { approved: true, missing: [], failed: [] });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
