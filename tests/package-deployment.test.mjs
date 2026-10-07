import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('package metadata is publishable and exposes library, service, and CLI artifacts', () => {
  assert.equal(packageJson.private, false);
  assert.deepEqual(packageJson.files, ['dist', 'README.md', 'supabase/migrations', 'supabase/README.md']);
  assert.equal(packageJson.main, './dist/index.js');
  assert.equal(packageJson.types, './dist/index.d.ts');
  assert.equal(packageJson.exports['.'].import, './dist/index.js');
  assert.equal(packageJson.exports['./server'].import, './dist/server.js');
  assert.equal(packageJson.bin['ai-control-plane'], 'dist/cli.js');
  assert.equal(packageJson.scripts.start, 'node dist/server.js');
  assert.equal(packageJson.scripts.prepublishOnly, 'npm run check');
});
