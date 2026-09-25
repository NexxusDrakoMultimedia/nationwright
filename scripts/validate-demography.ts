// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Validation of simulated nations against the real-world bands over time (TODO M2).
 * Creates worlds from many seeds (each with a random player nation), simulates them, and
 * reports how many nations' headline figures stay within the range of real states. Too
 * slow for CI; run it after demography changes and commit the report.
 *
 *   node scripts/validate-demography.ts [--seeds 50] [--years 30] [--out docs/validation/demography.md]
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { buildCensus, VALIDATION_BANDS, WorldSession } from '../packages/app/src/index.ts';
import { formatSeed, RULESET_VERSION } from '../packages/engine/src/index.ts';

const { values } = parseArgs({
  options: { seeds: { type: 'string' }, years: { type: 'string' }, out: { type: 'string' } },
});
const seedCount = Number(values.seeds ?? 50);
const years = Number(values.years ?? 30);
const dir = mkdtempSync(join(tmpdir(), 'nationwright-demography-'));
const started = performance.now();
const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)}s`;

interface Sample {
  readonly start: Map<string, number>;
  readonly end: Map<string, number>;
  /** Largest absolute yearly growth, %. */
  readonly maxGrowth: number;
  readonly finite: boolean;
  readonly createMs: number;
  readonly yearMs: number;
  readonly regions: number;
  readonly population: number;
}

const samples: Sample[] = [];
for (let s = 0; s < seedCount; s++) {
  // Seeds spread over the 64-bit space deterministically.
  const seed = formatSeed((BigInt(s) * 0x9e3779b97f4a7c15n + 0x1234567n) & 0xffff_ffff_ffff_fffcn);
  const path = join(dir, `${s}.nwsave`);
  const t0 = performance.now();
  const session = WorldSession.create({ path, seed, now: () => new Date('2026-09-25T12:00:00Z') });
  const createMs = performance.now() - t0;
  session.advance(12);
  const read = () =>
    new Map(
      buildCensus(session.engine)
        .stats.filter((stat) => stat.value !== null)
        .map((stat) => [stat.id, stat.value as number]),
    );
  const start = read();
  const t1 = performance.now();
  session.advance(12 * (years - 1));
  const yearMs = (performance.now() - t1) / (years - 1);
  const end = read();
  const growth = session.engine.indicators.series('population.growth_rate', 'nation').values;
  const finite = [...start.values(), ...end.values()].every(Number.isFinite);
  const demography = session.engine.world.slices.demography!;
  samples.push({
    start,
    end,
    maxGrowth: Math.max(...growth.map(Math.abs)),
    finite,
    createMs,
    yearMs,
    regions: demography.regions.length,
    population: start.get('population.total') ?? 0,
  });
  session.close();
  rmSync(path, { force: true });
  if ((s + 1) % 5 === 0 || s + 1 === seedCount) {
    process.stderr.write(
      `[${elapsed()}] ${s + 1}/${seedCount} nations simulated for ${years} years\n`,
    );
  }
}
rmSync(dir, { recursive: true, force: true });

const bands = new Map(VALIDATION_BANDS.map((b) => [b.id, b]));
const BAND_OF: Readonly<Record<string, string>> = {
  'education.any_schooling_share': 'education.literacy',
};
const ids = [...new Set(samples.flatMap((s) => [...s.start.keys()]))];

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length === 0 ? NaN : v[Math.floor(v.length / 2)]!;
};
const share = (xs: number[], ok: (x: number) => boolean) =>
  xs.length === 0 ? NaN : xs.filter(ok).length / xs.length;
const pct = (x: number) => (Number.isNaN(x) ? '—' : `${(100 * x).toFixed(0)}%`);
const fmt = (x: number) =>
  Number.isNaN(x)
    ? '—'
    : Math.abs(x) >= 1000
      ? Math.round(x).toLocaleString('en-US')
      : x.toFixed(2);

// Thresholds: at the start nations come straight from the generator, so nearly all
// should be inside the real range; after `years` of simulation, drift is expected (the
// economy, health, and policy that would steer it arrive later), but most should remain.
const START_IN_RANGE = 0.9;
const END_IN_RANGE = 0.75;
let ok = samples.every((s) => s.finite);

const rows = ids.map((id) => {
  const band = bands.get(BAND_OF[id] ?? id);
  const start = samples.map((s) => s.start.get(id)).filter((x): x is number => x !== undefined);
  const end = samples.map((s) => s.end.get(id)).filter((x): x is number => x !== undefined);
  if (band === undefined)
    return `| \`${id}\` | — | ${fmt(median(start))} | ${fmt(median(end))} | — | — | — | — | not scored |`;
  const inRange = (x: number) => x >= band.min && x <= band.max;
  const inMiddle = (x: number) => x >= band.p10 && x <= band.p90;
  const startIn = share(start, inRange);
  const endIn = share(end, inRange);
  const pass =
    (Number.isNaN(startIn) || startIn >= START_IN_RANGE) &&
    (Number.isNaN(endIn) || endIn >= END_IN_RANGE);
  if (!pass) ok = false;
  return `| \`${id}\` | ${fmt(band.p50)} | ${fmt(median(start))} | ${fmt(median(end))} | ${pct(startIn)} | ${pct(endIn)} | ${pct(share(start, inMiddle))} | ${pct(share(end, inMiddle))} | ${pass ? 'pass' : '**FAIL**'} |`;
});

const maxGrowth = Math.max(...samples.map((s) => s.maxGrowth));
const growthOk = maxGrowth <= 8;
ok = ok && growthOk;
const createMs = samples.map((s) => s.createMs);
const yearMs = samples.map((s) => s.yearMs);

const report = `# Demography validation

Generated by \`scripts/validate-demography.ts\` (ruleset v${RULESET_VERSION}): ${seedCount} worlds at
default settings, each with a random player nation, simulated for ${years} years. "Start" is
the end of the first year; "end" is year ${years}. Real states come from the validation
bands (\`validation-bands-2026.json\`). Adults with schooling is compared with literacy.

**Overall: ${ok ? 'PASS' : 'FAIL'}**

## Headline figures

A figure passes if at least ${pct(START_IN_RANGE)} of nations are within the real range
(min–max) at the start and at least ${pct(END_IN_RANGE)} after ${years} years.

| Indicator | Real median | Median, start | Median, end | In range, start | In range, end | Middle 80%, start | Middle 80%, end | Result |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

## Sanity

- All values finite: ${samples.every((s) => s.finite) ? 'yes' : '**no**'}
- Largest yearly population growth in any nation: ${maxGrowth.toFixed(2)}% (limit 8%): ${growthOk ? 'pass' : '**FAIL**'}
- Regions per nation: median ${median(samples.map((s) => s.regions))}, max ${Math.max(...samples.map((s) => s.regions))}
- Population at the start: median ${fmt(median(samples.map((s) => s.population)))}

## Known limits

The simulation has no economy, health system, or policy yet, so fertility and mortality
only change through composition (education and urbanization). Long runs therefore drift
toward the low-fertility, older end, and net international migration stays at each
nation's starting rate until the bilateral model (M3).

## Timing

World creation (generation + population): median ${median(createMs).toFixed(0)} ms. One
simulated year for the player's nation: median ${median(yearMs).toFixed(0)} ms, max
${Math.max(...yearMs).toFixed(0)} ms. Total run: ${elapsed()}.
`;

if (values.out !== undefined) {
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, report);
  process.stderr.write(`wrote ${values.out}\n`);
} else {
  process.stdout.write(report);
}
