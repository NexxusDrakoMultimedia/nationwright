// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Reference-data command line.
 *
 *   node packages/reference-data/src/cli.ts fetch
 *   node packages/reference-data/src/cli.ts build [--target-year 2026] [--source <dir>]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readProfiles, renderReport, runPipeline } from './pipeline.ts';
import { fetchSource, verifySource } from './source.ts';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(packageDir, '.cache');
const dataDir = join(packageDir, 'data');

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'target-year': { type: 'string' },
    source: { type: 'string' },
  },
});

const command = positionals[0];
if (command === 'fetch') {
  console.log(`Source ready at ${fetchSource(cacheDir)}`);
} else if (command === 'build') {
  const sourceDir = values.source ?? fetchSource(cacheDir);
  if (values.source !== undefined) verifySource(sourceDir);
  // The pipeline is developer tooling, so reading the clock here is fine (D7: the
  // current year is the default target).
  const targetYear = Number(values['target-year'] ?? new Date().getUTCFullYear());
  if (!Number.isInteger(targetYear)) throw new Error('--target-year must be a year');

  const result = runPipeline(readProfiles(sourceDir), { targetYear });
  mkdirSync(dataDir, { recursive: true });
  const write = (name: string, content: string) => {
    writeFileSync(join(dataDir, name), content);
    console.log(`wrote data/${name}`);
  };
  write('manifest.json', `${JSON.stringify(result.manifest, null, 2)}\n`);
  write(`snapshot-${targetYear}.json`, `${JSON.stringify(result.snapshot, null, 1)}\n`);
  write(`validation-bands-${targetYear}.json`, `${JSON.stringify(result.bands, null, 2)}\n`);
  write(`report-${targetYear}.md`, renderReport(result));
  console.log(
    `${result.manifest.entities.state} states, ${result.manifest.entities.territory} territories, ` +
      `${result.bands.bands.length} bands, ${result.issues.length} unparsed values`,
  );
} else {
  console.error('usage: cli.ts fetch | build [--target-year YYYY] [--source DIR]');
  process.exitCode = 2;
}
