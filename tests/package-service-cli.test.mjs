import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package metadata is ready for npm publishing and CLI installation', () => {
  assert.equal(pkg.private, false);
  assert.equal(pkg.main, './dist/index.js');
  assert.equal(pkg.types, './dist/index.d.ts');
  assert.deepEqual(pkg.bin, { 'ai-control-plane': 'dist/cli.js' });
  assert.ok(pkg.files.includes('dist'));
  assert.ok(pkg.files.includes('README.md'));
  assert.ok(pkg.files.includes('supabase/migrations'));
  assert.ok(existsSync(new URL('../.npmignore', import.meta.url)));
});

test('CLI health command runs from the built package', () => {
  const result = spawnSync(process.execPath, ['dist/cli.js', 'health'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.name, pkg.name);
  assert.equal(payload.service, pkg.name);
  assert.equal(payload.version, pkg.version);
});

test('service exposes a JSON health endpoint', async () => {
  const { createControlPlaneServer } = await import('../dist/server.js');
  const server = createControlPlaneServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');

  const response = await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: address.port, path: '/health', method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });

  server.close();
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.service, 'ai-control-plane-api');
});
