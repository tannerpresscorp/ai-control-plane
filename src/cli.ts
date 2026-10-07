#!/usr/bin/env node
import { createReadStream, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PACKAGE_NAME, PACKAGE_VERSION } from './package-metadata.js';
import { createHealthPayload, startControlPlaneHttpServer } from './server.js';
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

class CliInputError extends Error {}

function usageError(message: string): void {
  console.error(`${message}\n\n${HELP}`);
  process.exitCode = 2;
}

function assertInputSize(size: number): void {
  if (size > MAX_VERIFICATION_INPUT_BYTES) throw new CliInputError('Verification input must not exceed 1 MiB.');
}

async function readInputFile(path: string): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of createReadStream(path)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      assertInputSize(size);
      chunks.push(buffer);
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
    console.log(JSON.stringify(result));
    process.exitCode = result.approved ? 0 : 1;
  } catch (error) {
    throw new CliInputError(error instanceof Error ? error.message : 'Invalid verification input.');
  }
}

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
      console.error(error instanceof CliInputError ? error.message : 'Unable to verify acceptance evidence.');
      process.exitCode = 2;
    }
    return;
  }

  if (argv.length > 1) {
    usageError('Unexpected command arguments.');
    return;
  }

  switch (command) {
    case '--help':
    case '-h':
    case 'help':
      console.log(HELP);
      return;
    case '--version':
    case '-v':
    case 'version':
      console.log(`${PACKAGE_NAME} ${PACKAGE_VERSION}`);
      return;
    case 'health':
      console.log(JSON.stringify(createHealthPayload({ serviceName: PACKAGE_NAME }), null, 2));
      return;
    case 'package-info':
      console.log(JSON.stringify({ name: PACKAGE_NAME, version: PACKAGE_VERSION, service: PACKAGE_NAME, packageType: 'library' }, null, 2));
      return;
    case 'serve':
    case 'start':
      await startControlPlaneHttpServer();
      return;
    default:
      usageError('Unknown command.');
  }
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
