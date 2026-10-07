import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const npmIgnore = await readFile(new URL('../.npmignore', import.meta.url), 'utf8');

test('package metadata is publishable and limits npm contents', () => {
  assert.equal(packageJson.private, false);
  assert.equal(packageJson.main, './dist/index.js');
  assert.equal(packageJson.types, './dist/index.d.ts');
  assert.equal(packageJson.exports['.'].import, './dist/index.js');
  assert.equal(packageJson.exports['./server'].import, './dist/server.js');
  assert.deepEqual(packageJson.bin, {
    'ai-control-plane': 'dist/cli.js',
  });
  assert.deepEqual(packageJson.files, [
    'dist',
    'README.md',
    'supabase/migrations',
    'supabase/README.md',
  ]);
  assert.equal(packageJson.scripts.start, 'node dist/server.js');
  assert.equal(packageJson.scripts.serve, 'node dist/server.js');
  assert.equal(packageJson.scripts['publish:public'], 'npm publish --access public');
  assert.equal(packageJson.publishConfig.access, 'public');
});

test('npm ignore excludes development-only project files', () => {
  for (const pattern of ['node_modules/', 'tests/', 'src/', 'tasks/', '.env', '*.db']) {
    assert.ok(npmIgnore.includes(pattern), `missing ${pattern}`);
  }
});
