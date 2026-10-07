#!/usr/bin/env node
import { createReadStream, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { VerificationResult } from './core/types.js';
import { PACKAGE_NAME, PACKAGE_VERSION } from './package-metadata.js';
import { createHealthPayload, startServer } from './server.js';
import { MAX_VERIFICATION_INPUT_BYTES, verifyAcceptanceInput } from './verification-input.js';

const HELP = `AI Control Plane CLI\n\nUsage: ai-control-plane <command>

Commands:
  serve                             Start the HTTP API service.
  health                            Print local runtime health metadata as JSON.
  package-info                      Print package metadata as JSON.
  verify-acceptance --json <json>   Verify inline acceptance evidence.
  verify-acceptance --file <path>   Verify acceptance evidence from a JSON file.
  --help                            Show this help message.
  --version                         Print the package name and version.

Verification input (maximum 1 MiB):
  { "acceptanceCriteria": ["build"], "evidence": [], "attempt": 1 }
  Exit codes: 0 approved, 1 not approved, 2 invalid arguments or input.

Environment:
  PORT                      HTTP port (default: 3000).
  AI_CONTROL_PLANE_HOST     HTTP bind address (default: 127.0.0.1).
  HOST                      Fallback HTTP bind address.
`;

class CliInputError extends Error {}

function usageError(message: string): void {
  console.error(`${message}\n\n${HELP}`);
  process.exitCode = 2;
}

function checkInputSize(size: number): void {
  if (size > MAX_VERIFICATION_INPUT_BYTES) {
    throw new CliInputError('Verification input must not exceed 1 MiB.');
  }
}

async function readInputFile(path: string): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of createReadStream(path)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      checkInputSize(size);
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
  checkInputSize(Buffer.byteLength(input));
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    // SyntaxError messages can contain fragments of confidential input.
    throw new CliInputError('Verification input must be valid JSON.');
  }

  let result: VerificationResult;
  try {
    result = verifyAcceptanceInput(parsed);
  } catch (error) {
    // The shared validator emits fixed field/type descriptions, never input values.
    throw new CliInputError(error instanceof Error ? error.message : 'Invalid verification input.');
  }
  console.log(JSON.stringify(result));
  process.exitCode = result.approved ? 0 : 1;
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0] ?? '--help';
  if ((command === 'serve' || command === 'verify-acceptance') && argv.length === 2 && argv[1] === '--help') {
    console.log(HELP);
    return;
  }

  if (command === 'verify-acceptance') {
    if (argv.length !== 3 || (argv[1] !== '--json' && argv[1] !== '--file')) {
      usageError('Verification requires exactly one --json or --file input.');
      return;
    }
    try {
      await verifyInput(argv[1], argv[2]);
    } catch (error) {
      if (error instanceof CliInputError) {
        console.error(error.message);
        process.exitCode = 2;
      } else {
        console.error('Unable to verify acceptance evidence.');
        process.exitCode = 1;
      }
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
      console.log(JSON.stringify({
        name: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        service: 'ai-control-plane',
        packageType: 'library',
      }, null, 2));
      return;
    case 'serve':
      try {
        startServer().once('error', () => {
          console.error('Unable to start the HTTP API service.');
          process.exitCode = 1;
        });
      } catch {
        console.error('Unable to start the HTTP API service.');
        process.exitCode = 1;
      }
      return;
    default:
      usageError('Unknown command.');
  }
}

/** Resolve npm's POSIX bin symlink before comparing the executable module. */
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
