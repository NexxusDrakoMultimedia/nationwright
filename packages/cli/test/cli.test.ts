// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RULESET_VERSION } from '@nationwright/engine';
import type { Ruleset } from '@nationwright/app';
import { runCli, USAGE } from '../src/cli.ts';
import { setTaxRate, toyDemography, toyEconomy } from '../../engine/test/core/fixtures.ts';

const ruleset: Ruleset = {
  version: RULESET_VERSION,
  systems: [toyDemography, toyEconomy],
  commands: [setTaxRate],
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nationwright-cli-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(...argv: string[]): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCli(argv, {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    now: () => new Date('2026-09-25T12:00:00Z'),
    ruleset,
  });
  return { code, out, err };
}

describe('nationwright CLI', () => {
  it('prints usage', () => {
    expect(run('--help')).toEqual({ code: 0, out: [USAGE], err: [] });
    expect(run().code).toBe(2);
    expect(run('frobnicate').code).toBe(2);
  });

  it('never shows or accepts world seeds', () => {
    expect(run('seed').code).toBe(2);
    expect(run('new', join(dir, 's.nwsave'), '--seed', 'q3Zk1d0XbAc').code).toBe(2);
    expect(existsSync(join(dir, 's.nwsave'))).toBe(false);
    const w = join(dir, 'w.nwsave');
    run('new', w);
    expect(run('info', w).out.join('\n')).not.toMatch(/seed/i);
  });

  it('creates, runs, inspects, exports, and branches a world', () => {
    const w = join(dir, 'w.nwsave');
    expect(run('new', w, '--years', '1').out).toEqual([`Created ${w}`, 'Now at January 2027']);
    expect(run('run', w, '--months', '3').out).toEqual(['Advanced 3 months; now at April 2027']);

    const info = run('info', w).out.join('\n');
    expect(info).toContain('Now:            April 2027 (month 15)');
    expect(info).toContain('Systems:        toyEconomy, toyPopulation');

    const csv = run('indicators', w, '--id', 'population.total').out;
    expect(csv[0]).toBe('indicator,scope,tick,year,month,value');
    expect(csv).toHaveLength(16);
    expect(csv[1]).toMatch(/^population\.total,nation,0,2026,1,\d+$/);

    const b = join(dir, 'b.nwsave');
    expect(run('branch', w, b, '--at-month', '6').code).toBe(0);
    expect(run('info', b).out.join('\n')).toContain('Now:            July 2026 (month 6)');
  });

  it('reports bad input without throwing', () => {
    expect(run('new', join(dir, 'x.nwsave'), '--years', 'many').code).toBe(1);
    expect(run('run', join(dir, 'missing.nwsave'), '--years', '1')).toMatchObject({ code: 1 });
    expect(run('indicators', join(dir, 'x.nwsave'), '--scope', 'planet:3').code).toBe(2);
    expect(run('run', join(dir, 'x.nwsave')).code).toBe(1);
  });
});
