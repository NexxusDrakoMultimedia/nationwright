// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertGuidingVariables,
  BORDER_AGREEMENT_CALIBRATION,
  chooseArchetype,
  createStream,
  normalQuantile,
  prepareModel,
  quantileAt,
  sampleNation,
  type GuidingVariables,
  type NationSample,
} from '../../src/index.ts';

const model = JSON.parse(
  readFileSync(
    new URL('../../../reference-data/data/guiding-variables-2026.json', import.meta.url),
    'utf8',
  ),
) as GuidingVariables;
const prepared = prepareModel(model);

function sampleMany(n: number, seed: bigint): NationSample[] {
  const stream = createStream(seed, 'test/nations');
  return Array.from({ length: n }, () =>
    sampleNation(prepared, chooseArchetype(prepared, stream), stream),
  );
}

/**
 * Where x falls in a percentile table, as the interval [F(x−), F(x)]: the two differ where
 * the real distribution has a point mass (e.g. many states at exactly 100% electricity).
 */
function cdfInterval(quantiles: readonly number[], x: number): [number, number] {
  const valueAt = (y: number, inclusive: boolean): number => {
    if (inclusive ? y < quantiles[0]! : y <= quantiles[0]!) return 0;
    if (inclusive ? y >= quantiles[100]! : y > quantiles[100]!) return 1;
    let i = 0;
    while (inclusive ? quantiles[i + 1]! <= y : quantiles[i + 1]! < y) i++;
    const lo = quantiles[i]!;
    const hi = quantiles[i + 1]!;
    return (i + (hi > lo ? (y - lo) / (hi - lo) : inclusive ? 1 : 0)) / 100;
  };
  return [valueAt(x, false), valueAt(x, true)];
}

function cdfFromQuantiles(quantiles: readonly number[], x: number): number {
  const [lo, hi] = cdfInterval(quantiles, x);
  return (lo + hi) / 2;
}

describe('guiding variables model', () => {
  it('is structurally valid', () => {
    expect(() => assertGuidingVariables(model)).not.toThrow();
    expect(model.archetypes.length).toBeGreaterThanOrEqual(4);
  });

  it('interpolates percentile tables', () => {
    const q = Array.from({ length: 101 }, (_, i) => i * 2);
    expect(quantileAt(q, 0)).toBe(0);
    expect(quantileAt(q, 0.505)).toBeCloseTo(101, 9);
    expect(quantileAt(q, 1)).toBe(200);
    expect(quantileAt(q, 7)).toBe(200);
  });
});

describe('sampleNation', () => {
  const samples = sampleMany(3000, 12345n);
  // Variables replaced by consistency rules are checked separately.
  const derived = new Set(['population.growth_rate', 'population.age_15_64_share']);

  it('reproduces every marginal distribution (KS distance < 0.08)', () => {
    const worst: [string, number][] = [];
    for (const v of model.variables) {
      if (derived.has(v.id) || v.id.startsWith('economy.sector_')) continue;
      const xs = samples.map((s) => s.stats[v.id]!).sort((a, b) => a - b);
      let ks = 0;
      xs.forEach((x, i) => {
        const [lo, hi] = cdfInterval(v.quantiles, x);
        ks = Math.max(ks, (i + 1) / xs.length - hi, lo - i / xs.length);
      });
      worst.push([v.id, ks]);
    }
    worst.sort((a, b) => b[1] - a[1]);
    expect(worst[0]![1], `worst: ${worst[0]![0]}`).toBeLessThan(0.08);
  });

  it('gives every nation every variable', () => {
    for (const s of samples.slice(0, 200)) {
      for (const v of model.variables) expect(Number.isFinite(s.stats[v.id]), v.id).toBe(true);
    }
  });

  it('reproduces the correlation structure (max |Δρ| < 0.15)', () => {
    const p = model.variables.length;
    const z = samples.map((s) =>
      model.variables.map((v) => {
        const u = cdfFromQuantiles(v.quantiles, s.stats[v.id]!);
        return normalQuantile(Math.min(0.999, Math.max(0.001, u)));
      }),
    );
    const mean = new Array(p).fill(0).map((_, j) => z.reduce((a, r) => a + r[j]!, 0) / z.length);
    let worst = 0;
    let where = '';
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < a; b++) {
        const va = model.variables[a]!.id;
        const vb = model.variables[b]!.id;
        if (derived.has(va) || derived.has(vb)) continue;
        let sab = 0;
        let saa = 0;
        let sbb = 0;
        for (const r of z) {
          const da = r[a]! - mean[a]!;
          const db = r[b]! - mean[b]!;
          sab += da * db;
          saa += da * da;
          sbb += db * db;
        }
        const diff = Math.abs(sab / Math.sqrt(saa * sbb) - model.correlation[a]![b]!);
        if (diff > worst) {
          worst = diff;
          where = `${va} × ${vb}`;
        }
      }
    }
    expect(worst, `worst pair: ${where}`).toBeLessThan(0.15);
  });

  it('keeps identities consistent', () => {
    for (const s of samples.slice(0, 500)) {
      const st = s.stats;
      const ages =
        st['population.age_0_14_share']! +
        st['population.age_15_64_share']! +
        st['population.age_65_plus_share']!;
      expect(ages).toBeCloseTo(100, 9);
      const sectors =
        st['economy.sector_agriculture']! +
        st['economy.sector_industry']! +
        st['economy.sector_services']!;
      expect(sectors).toBeCloseTo(100, 9);
      expect(st['population.growth_rate']).toBeCloseTo(
        (st['population.birth_rate']! -
          st['population.death_rate']! +
          st['population.net_migration_rate']!) /
          10,
        9,
      );
      expect(st['economy.gdp_ppp_real']).toBeCloseTo(
        st['population.total']! * st['economy.gdp_per_capita_ppp']!,
        0,
      );
      expect(Number.isInteger(st['population.total'])).toBe(true);
      expect(s.ethnicGroups).toBeGreaterThanOrEqual(1);
    }
  });

  it('uses archetypes at their real-world weights', () => {
    model.archetypes.forEach((a) => {
      const share = samples.filter((s) => s.archetype === a.id).length / samples.length;
      expect(Math.abs(share - a.weight)).toBeLessThan(0.03);
    });
  });

  it('copies neighbour archetypes at the calibrated rate', () => {
    const { archetypeAgreement: a, archetypeAgreementChance: c } = model.spatial;
    const p = Math.min(1, BORDER_AGREEMENT_CALIBRATION * ((a - c) / (1 - c)));
    expect(prepared.copyNeighborArchetype).toBeCloseTo(p, 12);
    const stream = createStream(1n, 'test/neighbours');
    let same = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const neighbour = chooseArchetype(prepared, stream);
      if (chooseArchetype(prepared, stream, [neighbour]) === neighbour) same++;
    }
    // One neighbour: copy with probability p, otherwise match by chance.
    expect(Math.abs(same / n - (p + (1 - p) * c))).toBeLessThan(0.03);
  });

  it('is deterministic', () => {
    expect(sampleMany(5, 99n)).toEqual(sampleMany(5, 99n));
  });
});
