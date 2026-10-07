#!/usr/bin/env node
import { createReadStream, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PACKAGE_NAME, PACKAGE_VERSION } from './package-metadata.js';
import { MAX_VERIFICATION_INPUT_BYTES, verifyAcceptanceInput } from './verification-input.js';

const HELP = `AI Control Plane CLI

Usage: ai-control-plane <command>

Commands:
  serve                             Start the HTTP API service.
  health                            Print local runtime health metadata as JSON.
  package-info                      Print package metadata as JSON.
  verify-acceptance --json <json>   Verify inline acceptance evidence.
  verify-acceptance --file <path>   Verify acceptance evidence from a JSON file.
  --help                            Show this help message.
  --version                         Print the package name and version.

Environment:
  PORT    HTTP port (default: 3000).
  HOST    HTTP bind address (default: 0.0.0.0 for serve).
`;

const PACKAGE_INFO = JSON.stringify(
  { name: PACKAGE_NAME, version: PACKAGE_VERSION, service: PACKAGE_NAME, packageType: 'library' },
  null,
  2
);

class CliInputError extends Error {}

function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function usageError(message: string): void {
  console.error(`${message}\n\n${HELP}`);
  process.exitCode = 2;
}

function assertInputSize(size: number): void {
  if (size > MAX_VERIFICATION_INPUT_BYTES) {
    throw new CliInputError('Verification input must not exceed 1 MiB.');
  }
}

async function readInputFile(path: string): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of createReadStream(path)) {
      size += chunk.length;
      assertInputSize(size);
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof CliInputError) throw error;
    throw new CliInputError('Unable to read the verification input file.');
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function verifyInput(mode: string, value: string): Promise<void> {
  const input = mode === '--file' ? await readInputFile(value) : value;
  assertInputSize(Buffer.byteLength(input));

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new CliInputError('Verification input must be valid JSON.');
  }

  try {
    const result = verifyAcceptanceInput(parsed);
    outputJson(result);
    process.exitCode = result.approved ? 0 : 1;
  } catch (error) {
    throw new CliInputError(
      error instanceof Error ? error.message : 'Invalid verification input.'
    );
  }
}

async function handleServe(): Promise<void> {
  const { startControlPlaneHttpServer } = await import('./server.js');
  await startControlPlaneHttpServer();
}

async function handleHealth(): Promise<void> {
  const { createHealthPayload } = await import('./server.js');
  outputJson(createHealthPayload({ serviceName: PACKAGE_NAME }));
}

const commands: Record<string, () => Promise<void>> = {
  serve: handleServe,
  start: handleServe,
  health: handleHealth,
  'package-info': () => { console.log(PACKAGE_INFO); return Promise.resolve(); },
  '--version': () => { console.log(`${PACKAGE_NAME} ${PACKAGE_VERSION}`); return Promise.resolve(); },
  '-v': () => { console.log(`${PACKAGE_NAME} ${PACKAGE_VERSION}`); return Promise.resolve(); },
  version: () => { console.log(`${PACKAGE_NAME} ${PACKAGE_VERSION}`); return Promise.resolve(); },
  '--help': () => { console.log(HELP); return Promise.resolve(); },
  '-h': () => { console.log(HELP); return Promise.resolve(); },
  help: () => { console.log(HELP); return Promise.resolve(); },
};

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0] ?? '--help';

  if (command === 'verify-acceptance') {
    if (argv.length !== 3 || (argv[1] !== '--json' && argv[1] !== '--file')) {
      usageError('Verification requires exactly one --json or --file input.');
      return;
    }
    try {
      await verifyInput(argv[1], argv[2]);
    } catch (error) {
      console.error(
        error instanceof CliInputError
          ? error.message
          : 'Unable to verify acceptance evidence.'
      );
      process.exitCode = 2;
    }
    return;
  }

  if (argv.length > 1) {
    usageError('Unexpected command arguments.');
    return;
  }

  const handler = commands[command];
  if (!handler) {
    usageError('Unknown command.');
    return;
  }

  await handler();
}

export function isCliEntrypoint(moduleUrl: string): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isCliEntrypoint(import.meta.url)) {
  await runCli();
}
