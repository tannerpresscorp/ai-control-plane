import { readFileSync } from 'node:fs';

// Resolve relative to this module so installed CLIs also work outside the project.
const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
};

export const PACKAGE_NAME = metadata.name;
export const PACKAGE_VERSION = metadata.version;
