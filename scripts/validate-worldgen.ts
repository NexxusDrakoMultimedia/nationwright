// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Statistical validation of the world generator across many seeds (DESIGN.md §4.12.6).
 * Too slow for CI; run it after generator changes and commit the report.
 *
 *   node scripts/validate-worldgen.ts [--seeds 200] [--out docs/validation/worldgen-v1.md]
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createStream,
  defaultSettings,
  generateWorld,
  GENERATOR_VERSION,
  normalQuantile,
  type GeneratedWorld,
  type GuidingVariables,
} from '../packages/engine/src/index.ts';

const { values } = parseArgs({ options: { seeds: { type: 'string' }, out: { type: 'string' } } });
const seedCount = Number(values.seeds ?? 200);
const data = new URL('../packages/reference-data/data/', import.meta.url);
const guiding = JSON.parse(
  readFileSync(new URL('guiding-variables-2026.json', data), 'utf8'),
) as GuidingVariables;
const blocklist = JSON.parse(
  readFileSync(new URL('name-blocklist.json', data), 'utf8'),
) as string[];

/** Where x falls in a percentile table, as the interval [F(x−), F(x)]. */
function cdfInterval(q: readonly number[], x: number): [number, number] {
  const at = (inclusive: boolean) => {
    if (inclusive ? x < q[0]! : x <= q[0]!) return 0;
    if (inclusive ? x >= q[100]! : x > q[100]!) return 1;
    let i = 0;
    while (inclusive ? q[i + 1]! <= x : q[i + 1]! < x) i++;
    const lo = q[i]!;
    const hi = q[i + 1]!;
    return (i + (hi > lo ? (x - lo) / (hi - lo) : inclusive ? 1 : 0)) / 100;
  };
  return [at(false), at(true)];
}

function ks(values: number[], quantiles: readonly number[]): number {
  const xs = [...values].sort((a, b) => a - b);
  let d = 0;
  xs.forEach((x, i) => {
    const [lo, hi] = cdfInterval(quantiles, x);
    d = Math.max(d, (i + 1) / xs.length - hi, lo - i / xs.length);
  });
  return d;
}

function spearman(a: readonly number[], b: readonly number[]): number {
  const rank = (v: readonly number[]) => {
    const order = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(v.length);
    order.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const mean = (n - 1) / 2;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i]! - mean;
    const db = rb[i]! - mean;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return sab / Math.sqrt(saa * sbb);
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const quantile = (xs: readonly number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};

// Generate.
const rng = createStream(0x4e57n, 'validation/seeds');
const perWorld: {
  island: number;
  landlocked: number;
  continents: number;
  maxNeighbours: number;
  agreement: number;
  areaRank: number;
  ms: number;
}[] = [];
const neighbourHistogram = new Map<number, number>();
const pooled = new Map<string, number[]>(guiding.variables.map((v) => [v.id, []]));
const archetypeCounts = new Array<number>(guiding.archetypes.length).fill(0);
let countries = 0;
let failures = 0;
const started = performance.now();

for (let s = 0; s < seedCount; s++) {
  const seed = rng.nextBigUint64();
  const t0 = performance.now();
  let world: GeneratedWorld;
  try {
    world = generateWorld(seed, defaultSettings(), guiding, blocklist);
  } catch (error) {
    failures++;
    console.error(`seed ${seed.toString(16)}: ${String(error)}`);
    continue;
  }
  const ms = performance.now() - t0;
  const cs = world.countries;
  countries += cs.length;
  let pairs = 0;
  let same = 0;
  for (const c of cs) {
    neighbourHistogram.set(
      c.neighbors.length,
      (neighbourHistogram.get(c.neighbors.length) ?? 0) + 1,
    );
    archetypeCounts[c.nation.archetype]! += 1;
    for (const [id, list] of pooled) list.push(c.nation.stats[id] ?? Number.NaN);
    for (const j of c.neighbors) {
      pairs++;
      if (cs[j]!.nation.archetype === c.nation.archetype) same++;
    }
  }
  perWorld.push({
    island: cs.filter((c) => c.island).length / cs.length,
    landlocked: cs.filter((c) => c.landlocked).length / cs.length,
    continents: world.continentCount,
    maxNeighbours: Math.max(...cs.map((c) => c.neighbors.length)),
    agreement: pairs === 0 ? 0 : same / pairs,
    areaRank: spearman(
      cs.map((c) => c.nation.stats['geography.area_km2'] ?? 0),
      cs.map((c) => c.mapAreaKm2),
    ),
    ms,
  });
  if ((s + 1) % 25 === 0) console.error(`${s + 1}/${seedCount} worlds`);
}

// Compare.
const structure = guiding.structure;
type Row = [string, string, string, string, string];
const rows: Row[] = [];
const verdict = (ok: boolean) => (ok ? 'pass' : '**FAIL**');
const band = (xs: number[]) => `${quantile(xs, 0.05).toFixed(3)}–${quantile(xs, 0.95).toFixed(3)}`;
const check = (name: string, target: number, xs: number[], tolerance: number) => {
  const m = mean(xs);
  rows.push([
    name,
    target.toFixed(3),
    m.toFixed(3),
    band(xs),
    verdict(Math.abs(m - target) <= tolerance),
  ]);
  return Math.abs(m - target) <= tolerance;
};
let ok = failures === 0;
ok =
  check(
    'Island nations (share)',
    structure.islandShare,
    perWorld.map((w) => w.island),
    0.05,
  ) && ok;
ok =
  check(
    'Landlocked (share)',
    structure.landlockedShare,
    perWorld.map((w) => w.landlocked),
    0.08,
  ) && ok;
ok =
  check(
    'Neighbouring states sharing an archetype',
    guiding.spatial.archetypeAgreement,
    perWorld.map((w) => w.agreement),
    0.1,
  ) && ok;

const neighbourRows = [
  ...new Set([...Object.keys(structure.neighborCounts).map(Number), ...neighbourHistogram.keys()]),
]
  .sort((a, b) => a - b)
  .map((k) => {
    const real = structure.neighborCounts[String(k)] ?? 0;
    const generated = (neighbourHistogram.get(k) ?? 0) / countries;
    return `| ${k} | ${(real * 100).toFixed(1)}% | ${(generated * 100).toFixed(1)}% |`;
  });

// Total variation distance between real and generated neighbour-count distributions.
const allCounts = new Set([
  ...Object.keys(structure.neighborCounts).map(Number),
  ...neighbourHistogram.keys(),
]);
let tvd = 0;
for (const k of allCounts) {
  tvd +=
    Math.abs(
      (structure.neighborCounts[String(k)] ?? 0) - (neighbourHistogram.get(k) ?? 0) / countries,
    ) / 2;
}
const TVD_LIMIT = 0.12;
ok = ok && tvd <= TVD_LIMIT;

const pooledRows = guiding.variables.map((v) => {
  const xs = (pooled.get(v.id) ?? []).filter(Number.isFinite);
  const d = ks(xs, v.quantiles);
  const derived = v.id === 'population.growth_rate' || v.id.startsWith('economy.sector_');
  const limit = 0.06;
  const status = derived ? 'n/a (see note)' : verdict(d < limit);
  if (!derived && d >= limit) ok = false;
  return `| \`${v.id}\` | ${v.n} | ${d.toFixed(3)} | ${status} |`;
});

// Correlation of normal scores across the pooled sample vs the model.
const z = guiding.variables.map((v) =>
  (pooled.get(v.id) ?? []).map((x) => {
    const [lo, hi] = cdfInterval(v.quantiles, x);
    return normalQuantile(Math.min(0.999, Math.max(0.001, (lo + hi) / 2)));
  }),
);
let worstCorrelation = 0;
let worstPair = '';
for (let a = 0; a < z.length; a++) {
  for (let b = 0; b < a; b++) {
    const ids = [guiding.variables[a]!.id, guiding.variables[b]!.id];
    if (ids.some((id) => id === 'population.growth_rate' || id.startsWith('economy.sector_')))
      continue;
    const za = z[a]!;
    const zb = z[b]!;
    const ma = mean(za);
    const mb = mean(zb);
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    for (let i = 0; i < za.length; i++) {
      sab += (za[i]! - ma) * (zb[i]! - mb);
      saa += (za[i]! - ma) ** 2;
      sbb += (zb[i]! - mb) ** 2;
    }
    const diff = Math.abs(sab / Math.sqrt(saa * sbb) - guiding.correlation[a]![b]!);
    if (diff > worstCorrelation) {
      worstCorrelation = diff;
      worstPair = ids.join(' × ');
    }
  }
}
ok = ok && worstCorrelation < 0.12;

const archetypeRows = guiding.archetypes.map(
  (a) =>
    `| ${a.label} | ${(a.weight * 100).toFixed(1)}% | ${((archetypeCounts[a.id]! / countries) * 100).toFixed(1)}% |`,
);
const times = perWorld.map((w) => w.ms);

const report = `# World generator validation — generator v${GENERATOR_VERSION}

Generated by \`scripts/validate-worldgen.ts\`: ${perWorld.length} worlds (${failures} failures) with default
settings (${defaultSettings().countryCount} countries each, ${countries.toLocaleString('en')} countries in total), compared
with guiding-variables model v${guiding.modelVersion} (target year ${guiding.targetYear}).

**Overall: ${ok ? 'PASS' : 'FAIL'}**

## Political geography

| Check | Real world | Generated (mean) | Generated (5th–95th pct. per world) | Result |
|---|---|---|---|---|
${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}

Other per-world figures: continents ${band(perWorld.map((w) => w.continents))}; most land
neighbours of any country ${band(perWorld.map((w) => w.maxNeighbours))} (real maximum: 14); Spearman
correlation between sampled and mapped area ${band(perWorld.map((w) => w.areaRank))}.

### Land neighbours per country

Total variation distance between the two distributions: **${tvd.toFixed(3)}** (limit ${TVD_LIMIT}:
${verdict(tvd <= TVD_LIMIT)}). Known deviations: too many countries with a single neighbour, and a
thin tail of very large countries with more than 14 neighbours (TODO.md).

| Neighbours | Real states | Generated |
|---|---|---|
${neighbourRows.join('\n')}

## Nation statistics (pooled over all generated countries)

Kolmogorov–Smirnov distance between the generated distribution and the real one (limit 0.06).
The real distribution uses only the states that report each variable (nothing is imputed), and
every generated country has every variable. Population growth and sector shares are rewritten by
consistency rules, so those are not scored.

| Variable | Real states reporting | KS distance | Result |
|---|---|---|---|
${pooledRows.join('\n')}

Largest correlation error between generated and real normal scores: **${worstCorrelation.toFixed(3)}**
(${worstPair}; limit 0.12).

### Archetypes

| Archetype | Real share | Generated share |
|---|---|---|
${archetypeRows.join('\n')}

## Performance

Generation time per world: median ${quantile(times, 0.5).toFixed(0)} ms, 95th percentile
${quantile(times, 0.95).toFixed(0)} ms (total ${((performance.now() - started) / 1000).toFixed(0)} s; measured, not gated — D19).
`;

if (values.out !== undefined) {
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, report);
  console.error(`wrote ${values.out}`);
} else {
  process.stdout.write(report);
}
process.exitCode = ok ? 0 : 1;
