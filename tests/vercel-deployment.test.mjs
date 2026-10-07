import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';

const repoRoot = new URL('../', import.meta.url);

test('Vercel builds the Node service instead of publishing dist as static files', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.framework, 'node');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, undefined);
});

test('Vercel root entrypoint starts on import and serves health and verification', { timeout: 15_000 }, async () => {
  await access(new URL('../server.js', import.meta.url));
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

  // Importing the entrypoint matches Vercel's startup contract; it is not the main module.
  const child = spawn(process.execPath, ['--input-type=module', '--eval', "import './server.js'"], {
    cwd: repoRoot,
    env: { PORT: String(port), AI_CONTROL_PLANE_HOST: '127.0.0.1', NODE_ENV: 'test' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Server did not start: ${stderr}`)), 5_000);
      let output = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => {
        output += chunk;
        if (/listening/.test(output)) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Server exited with ${code}: ${stderr}`));
      });
    });
    const baseUrl = `http://127.0.0.1:${port}`;
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
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
});
