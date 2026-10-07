import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
const dockerignore = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8');
const vercelignore = await readFile(new URL('../.vercelignore', import.meta.url), 'utf8');
const renderConfig = await readFile(new URL('../render.yaml', import.meta.url), 'utf8');

test('Dockerfile builds and starts the production HTTP service', () => {
  assert.match(dockerfile, /FROM node:22-bookworm-slim AS deps/);
  assert.match(dockerfile, /FROM node:22-bookworm-slim AS runtime/);
  assert.match(dockerfile, /RUN npm ci/);
  assert.match(dockerfile, /RUN npm run build/);
  assert.match(dockerfile, /RUN npm ci --omit=dev/);
  assert.match(dockerfile, /EXPOSE 3000/);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]+\/health/);
  assert.match(dockerfile, /CMD \["node", "dist\/server\.js"\]/);
});

function assertIgnoreFileProtectsLocalArtifacts(ignoreFile) {
  for (const pattern of ['node_modules', 'dist', '.git', '.env', '*.db', 'tests', 'tasks']) {
    assert.ok(ignoreFile.includes(pattern), `missing ${pattern}`);
  }
}

test('.dockerignore keeps local and secret material out of container context', () => {
  assertIgnoreFileProtectsLocalArtifacts(dockerignore);
});

test('.vercelignore keeps local and secret material out of Vercel uploads', () => {
  assertIgnoreFileProtectsLocalArtifacts(vercelignore);
});

test('Render service config points at the Docker health-checked web service', () => {
  assert.match(renderConfig, /type: web/);
  assert.match(renderConfig, /runtime: docker/);
  assert.match(renderConfig, /dockerfilePath: \.\/Dockerfile/);
  assert.match(renderConfig, /healthCheckPath: \/health/);
  assert.match(renderConfig, /key: HOST\s+value: 0\.0\.0\.0/s);
  assert.match(renderConfig, /key: PORT\s+value: 3000/s);
  for (const secret of ['OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SIXTYFOUR_API_KEY']) {
    assert.match(renderConfig, new RegExp(`key: ${secret}\\s+sync: false`, 's'));
  }
});
