import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const npmignoreLines = readFileSync(new URL('../.npmignore', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .filter(Boolean);

test('package metadata is publish-ready and intentionally scoped', () => {
  assert.equal(pkg.private, false);
  assert.equal(pkg.name, '@tannerpress/ai-control-plane');
  assert.equal(pkg.main, './dist/index.js');
  assert.equal(pkg.types, './dist/index.d.ts');
  assert.deepEqual(pkg.bin, { 'ai-control-plane': 'dist/cli.js' });
  assert.ok(pkg.files.includes('dist'));
  assert.ok(pkg.files.includes('README.md'));
  assert.ok(pkg.files.includes('supabase/migrations'));
  assert.equal(pkg.publishConfig.access, 'public');
});

test('package exposes service, CLI, and publishing scripts', () => {
  assert.equal(pkg.exports['.'].import, './dist/index.js');
  assert.equal(pkg.exports['./server'].import, './dist/server.js');
  assert.equal(pkg.scripts.start, 'node dist/server.js');
  assert.equal(pkg.scripts.serve, 'node dist/server.js');
  assert.equal(pkg.scripts['pack:dry-run'], 'npm pack --dry-run');
  assert.equal(pkg.scripts['publish:public'], 'npm publish --access public');
});

test('.npmignore and Docker assets exclude local-only files for deployment/publishing', () => {
  for (const expected of ['src/', 'tests/', 'tasks/', 'node_modules/', '*.db', '*.tgz']) {
    assert.ok(npmignoreLines.includes(expected), `missing ${expected}`);
  }
  assert.ok(existsSync(new URL('../Dockerfile', import.meta.url)));
  assert.ok(existsSync(new URL('../.dockerignore', import.meta.url)));
});
