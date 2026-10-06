#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { createHealthPayload, startServer } from '../server.js';

const VERSION = '0.1.0';

function printHelp(): void {
  console.log(`Usage: ai-control-plane <command>

Commands:
  serve        Start the AI Control Plane HTTP API service.
  health       Print local runtime health metadata as JSON.
  --help       Show this help message.
  --version    Print the package version.

Environment:
  PORT                         HTTP port for serve. Defaults to 3000.
  HOST                         HTTP host for serve. Defaults to 0.0.0.0.
  OPENAI_API_KEY               Optional server-side OpenAI API key.
  SUPABASE_URL                 Optional Supabase project URL.
  SUPABASE_SERVICE_ROLE_KEY    Optional Supabase service-role key.
`);
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0] ?? '--help';

  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(VERSION);
    return;
  }

  if (command === 'health') {
    console.log(JSON.stringify(createHealthPayload({ version: VERSION }), null, 2));
    return;
  }

  if (command === 'serve') {
    startServer({ version: VERSION });
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
