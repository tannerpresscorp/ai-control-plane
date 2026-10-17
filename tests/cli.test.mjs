import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function runCli(args) {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.SUPABASE_URL;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  return spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8', env });
}

test('CLI prints help', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ai-control-plane/);
  assert.match(result.stdout, /serve/);
  assert.match(result.stdout, /health/);
});

test('CLI prints JSON health without starting a long-running server', () => {
  const result = runCli(['health']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.name, '@tannerpress/ai-control-plane');
  assert.equal(payload.service, '@tannerpress/ai-control-plane');
  assert.equal(payload.credentials.openaiApiKey, false);
});

test('CLI rejects unknown commands as a usage error', () => {
  const result = runCli(['does-not-exist']);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown command/);
});
