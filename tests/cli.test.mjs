import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = new URL('../', import.meta.url);

function runCli(...args) {
  return spawnSync(process.execPath, ['dist/cli.js', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000
  });
}

test('CLI prints version from package metadata', () => {
  const result = runCli('--version');
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout.trim(), /^@tannerpress\/ai-control-plane 0\.1\.0$/);
});

test('CLI prints help with service and verification commands', () => {
  const result = runCli('--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /serve/);
  assert.match(result.stdout, /verify-acceptance/);
});

test('CLI verifies acceptance evidence from a JSON file', () => {
  const input = JSON.stringify({
    acceptanceCriteria: ['build'],
    evidence: [{ criterionId: 'build', status: 'pass', source: 'ci', detail: 'ok', attempt: 1 }],
    attempt: 1
  });
  const result = spawnSync(process.execPath, ['dist/cli.js', 'verify-acceptance', '--json', input], {
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { approved: true, missing: [], failed: [] });
});

test('CLI exits with one for missing and failed current-attempt evidence', () => {
  const input = JSON.stringify({
    acceptanceCriteria: ['build', 'review'],
    evidence: [
      { criterionId: 'build', status: 'fail', source: 'ci', detail: 'failed', attempt: 2 },
      { criterionId: 'review', status: 'pass', source: 'ci', detail: 'old', attempt: 1 },
    ],
    attempt: 2,
  });
  const result = runCli('verify-acceptance', '--json', input);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { approved: false, missing: ['review'], failed: ['build'] });
});

test('CLI rejects malformed JSON and invalid verification data without exposing payloads', () => {
  const secret = 'sensitive-input-must-not-be-printed';
  for (const input of [
    `{\"secret\":\"${secret}\",`,
    JSON.stringify({ acceptanceCriteria: ['build'], evidence: [{ status: secret }], attempt: 1 }),
    JSON.stringify({ acceptanceCriteria: ['build'], evidence: [], attempt: 0 }),
  ]) {
    const result = runCli('verify-acceptance', '--json', input);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.notEqual(result.stderr, '');
    assert.doesNotMatch(result.stderr, new RegExp(secret));
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  }
});

test('CLI rejects unknown commands, missing input, and extra flags without echoing argv', () => {
  const secret = 'sensitive-argument-must-not-be-printed';
  for (const args of [[secret], ['verify-acceptance'], ['verify-acceptance', '--json'],
    ['verify-acceptance', '--json', '{}', secret], ['health', secret], ['serve', secret]]) {
    const result = runCli(...args);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Usage: ai-control-plane/);
    assert.doesNotMatch(result.stderr, new RegExp(secret));
  }
});

test('CLI supports JSON files and rejects unreadable or oversized files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-control-plane-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputFile = join(directory, 'evidence.json');
  await writeFile(inputFile, JSON.stringify({
    acceptanceCriteria: ['build'],
    evidence: [{ criterionId: 'build', status: 'pass', source: 'ci', detail: 'ok', attempt: 1 }],
    attempt: 1,
  }));
  const result = runCli('verify-acceptance', '--file', inputFile);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { approved: true, missing: [], failed: [] });

  const missingFile = join(directory, 'secret-filename.json');
  const missing = runCli('verify-acceptance', '--file', missingFile);
  assert.equal(missing.status, 2, missing.stderr);
  assert.match(missing.stderr, /read/i);
  assert.doesNotMatch(missing.stderr, /secret-filename/);

  await writeFile(inputFile, ' '.repeat(1_048_577));
  const oversized = runCli('verify-acceptance', '--file', inputFile);
  assert.equal(oversized.status, 2, oversized.stderr);
  assert.match(oversized.stderr, /1 MiB/);
});

test('CLI health preserves the local runtime health command', () => {
  const result = runCli('health');
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.service, '@tannerpress/ai-control-plane');
  assert.equal(payload.version, '0.1.0');
});

test('CLI and compatibility wrapper run through POSIX installation symlinks', {
  skip: process.platform === 'win32' ? 'POSIX npm symlink behavior' : false,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-control-plane-cli-link-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [index, target] of ['dist/cli.js', 'dist/bin/ai-control-plane.js'].entries()) {
    const executable = join(directory, `cli-${index}`);
    await symlink(fileURLToPath(new URL(target, repoRoot)), executable);
    const result = spawnSync(process.execPath, [executable, '--version'], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '@tannerpress/ai-control-plane 0.1.0');
  }
});
