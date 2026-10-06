import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';

const repoRoot = new URL('../', import.meta.url);
const fromRoot = (path) => new URL(path, repoRoot);

test('package metadata is publishable, installable as a CLI, and has a service entrypoint', async () => {
  const pkg = JSON.parse(await readFile(fromRoot('package.json'), 'utf8'));

  assert.equal(pkg.private, false);
  assert.deepEqual(pkg.bin, {
    'ai-control-plane': './dist/bin/ai-control-plane.js',
  });
  assert.equal(pkg.scripts.start, 'node dist/server.js');
  assert.equal(pkg.scripts.serve, 'node dist/server.js');
  assert.equal(pkg.scripts.prepublishOnly, 'npm run check && npm run pack:dry-run');
  assert.equal(pkg.scripts['pack:dry-run'], 'npm pack --dry-run');
  assert.equal(pkg.scripts['publish:public'], 'npm publish --access public');

  assert.ok(pkg.files.includes('dist'));
  assert.ok(pkg.files.includes('README.md'));
  assert.ok(pkg.files.includes('supabase/migrations'));
  assert.ok(pkg.files.includes('supabase/README.md'));

  assert.equal(pkg.exports['.'].import, './dist/index.js');
  assert.equal(pkg.exports['./server'].import, './dist/server.js');

  const npmignore = await readFile(fromRoot('.npmignore'), 'utf8');
  assert.match(npmignore, /^src\/$/m);
  assert.match(npmignore, /^tests\/$/m);
  assert.match(npmignore, /^\.github\/$/m);
  assert.match(npmignore, /^\.env/m);
});

test('Docker and Render deployment metadata expose the API service with health checks', async () => {
  const dockerfile = await readFile(fromRoot('Dockerfile'), 'utf8');
  assert.match(dockerfile, /FROM node:22-slim/);
  assert.match(dockerfile, /npm ci/);
  assert.match(dockerfile, /npm run build/);
  assert.match(dockerfile, /node", "dist\/server\.js"/);
  assert.match(dockerfile, /HEALTHCHECK/);

  const dockerignore = await readFile(fromRoot('.dockerignore'), 'utf8');
  assert.match(dockerignore, /^node_modules\/$/m);
  assert.match(dockerignore, /^dist\/$/m);
  assert.match(dockerignore, /^\.env/m);

  const render = await readFile(fromRoot('render.yaml'), 'utf8');
  assert.match(render, /type: web/);
  assert.match(render, /env: docker/);
  assert.match(render, /healthCheckPath: \/health/);
});

test('built CLI exposes help and version commands', async () => {
  const help = spawnSync(process.execPath, ['dist/bin/ai-control-plane.js', '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: ai-control-plane/);
  assert.match(help.stdout, /serve/);

  const version = spawnSync(process.execPath, ['dist/bin/ai-control-plane.js', '--version'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(version.status, 0, version.stderr);

  const pkg = JSON.parse(await readFile(fromRoot('package.json'), 'utf8'));
  assert.match(version.stdout, new RegExp(pkg.version));
});

test('API service responds to health and readiness checks without live credentials', async (t) => {
  const { createApiServer } = await import('../dist/server.js');
  const server = createApiServer({
    name: '@tannerpress/ai-control-plane',
    version: '0.1.0-test',
  });

  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  assert.equal(typeof address, 'object');

  const health = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('content-type'), 'application/json');

  const healthBody = await health.json();
  assert.equal(healthBody.status, 'ok');
  assert.equal(healthBody.service, '@tannerpress/ai-control-plane');
  assert.equal(healthBody.version, '0.1.0-test');
  assert.equal(healthBody.credentials.openaiApiKey, false);
  assert.equal(healthBody.credentials.supabaseUrl, false);
  assert.equal(healthBody.credentials.supabaseServiceRoleKey, false);

  const ready = await fetch(`http://127.0.0.1:${address.port}/ready`);
  assert.equal(ready.status, 200);

  const missing = await fetch(`http://127.0.0.1:${address.port}/missing`);
  assert.equal(missing.status, 404);
});
