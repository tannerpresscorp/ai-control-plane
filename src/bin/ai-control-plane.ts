#!/usr/bin/env node
import { isCliEntrypoint, runCli } from '../cli.js';

export { runCli } from '../cli.js';

if (isCliEntrypoint(import.meta.url)) {
  await runCli();
}
