// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Fails if any installed package has a license that is not known to be compatible with
 * GPL-3.0-or-later (D20). Unknown or missing licenses fail too: review them, then either
 * add the license to ALLOWED or the exact package version to REVIEWED with a reason.
 *
 *   node scripts/check-licenses.ts
 */

import { execFileSync } from 'node:child_process';

/** SPDX identifiers compatible with distribution under GPL-3.0-or-later. */
const ALLOWED = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'ISC',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'MIT',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'Zlib',
]);

/** Individually reviewed packages ("name@version": reason). */
const REVIEWED: Readonly<Record<string, string>> = {};

interface InstalledPackage {
  readonly name: string;
  readonly version: string;
  readonly license?: unknown;
  readonly dev?: boolean;
}

/** Evaluates a simple SPDX expression: "A OR B", "A AND B", parentheses, "WITH" exceptions. */
export function isAllowed(expression: string): boolean {
  const text = expression.trim().replace(/^\((.*)\)$/, '$1');
  const alternatives = splitTopLevel(text, ' OR ');
  if (alternatives.length > 1) return alternatives.some(isAllowed);
  const conjuncts = splitTopLevel(text, ' AND ');
  if (conjuncts.length > 1) return conjuncts.every(isAllowed);
  const [id] = text.split(' WITH ');
  return ALLOWED.has((id ?? '').trim());
}

function splitTopLevel(text: string, operator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && text.startsWith(operator, i)) {
      parts.push(text.slice(start, i));
      start = i + operator.length;
      i += operator.length - 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function licenseOf(pkg: InstalledPackage): string | null {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license !== null && typeof pkg.license === 'object' && 'type' in pkg.license) {
    const type = (pkg.license as { type: unknown }).type;
    return typeof type === 'string' ? type : null;
  }
  return null;
}

function main(): void {
  const output = execFileSync('npm', ['query', '*'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const packages = JSON.parse(output) as InstalledPackage[];
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const pkg of packages) {
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const license = licenseOf(pkg);
    if (REVIEWED[key] !== undefined) continue;
    if (license === null || !isAllowed(license)) {
      problems.push(`${key}${pkg.dev === true ? ' (dev)' : ''}: ${license ?? 'no license field'}`);
    }
  }
  if (problems.length > 0) {
    console.error(`License check failed for ${problems.length} package(s):`);
    for (const p of problems.sort()) console.error(`  ${p}`);
    process.exitCode = 1;
  } else {
    console.log(`License check passed: ${seen.size} packages, all GPL-3.0-or-later compatible.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
