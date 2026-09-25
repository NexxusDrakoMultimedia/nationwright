// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The pinned reference source (DESIGN.md §10.1, D8): factbook/factbook.json, CC0.
 * The data is frozen (last auto-update 2026-01-22; the CIA retired the Factbook in
 * February 2026), so the pin only moves for repository fixes such as region moves.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const SOURCE = {
  repository: 'https://github.com/factbook/factbook.json',
  commit: '144d6977b2b01ac1cbd220de754c0a005616760b',
  commitDate: '2026-09-11',
  lastDataUpdate: '2026-01-22',
  license: 'CC0-1.0',
} as const;

/** Directories that hold country profiles (everything except oceans, world, meta). */
export const REGION_DIRECTORIES = [
  'africa',
  'antarctica',
  'australia-oceania',
  'central-america-n-caribbean',
  'central-asia',
  'east-n-southeast-asia',
  'europe',
  'middle-east',
  'north-america',
  'south-america',
  'south-asia',
] as const;

export type RegionDirectory = (typeof REGION_DIRECTORIES)[number];

/** Clones the source into `cacheDir` at the pinned commit (no-op if already there). */
export function fetchSource(cacheDir: string): string {
  const target = join(cacheDir, `factbook.json-${SOURCE.commit.slice(0, 12)}`);
  if (!existsSync(join(target, '.git'))) {
    mkdirSync(cacheDir, { recursive: true });
    execFileSync('git', ['clone', '--quiet', '--no-checkout', SOURCE.repository, target], {
      stdio: 'inherit',
    });
    execFileSync('git', ['-C', target, 'checkout', '--quiet', SOURCE.commit], { stdio: 'inherit' });
  }
  verifySource(target);
  return target;
}

/** Throws unless `dir` is a git checkout of the pinned commit. */
export function verifySource(dir: string): void {
  const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== SOURCE.commit) {
    throw new Error(`Source at ${dir} is at ${head}, expected pinned commit ${SOURCE.commit}.`);
  }
}
