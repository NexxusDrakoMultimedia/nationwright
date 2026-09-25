// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { describe, expect, it } from 'vitest';
import {
  buildPopulation,
  cohortsOf,
  composition,
  createStream,
  largestShare,
  NO_RELIGION,
  noReligionShare,
  pruneCombinations,
  stepMonth,
  summarize,
  type MonthInputs,
  type NationPopulation,
  type NationStats,
} from '../../src/index.ts';

const stats: NationStats = {
  'population.total': 5_000_000,
  'population.urban_share': 55,
  'population.life_expectancy': 74,
  'population.infant_mortality': 15,
  'population.tfr': 2.4,
  'population.age_0_14_share': 26,
  'population.age_65_plus_share': 8,
  'education.literacy': 92,
  'education.school_life_expectancy': 13,
  'population.net_migration_rate': 2,
};

// Two ethnic groups, two faiths, two languages; ethnicity and language mostly aligned.
const joint = [
  { ethnic: 0, religion: 0, language: 0, share: 0.6 },
  { ethnic: 0, religion: 1, language: 0, share: 0.1 },
  { ethnic: 1, religion: 1, language: 1, share: 0.25 },
  { ethnic: 1, religion: 0, language: 0, share: 0.05 },
];

function build(seed = 1n): NationPopulation {
  return buildPopulation(
    stats,
    [2e6, 1.5e6, 1e6, 0.5e6].map((p) => ({ population: p, urbanPopulation: 0.55 * p })),
    { joint, stream: createStream(seed, 'test/culture') },
  );
}

const inputs = (pop: NationPopulation, extra: Partial<MonthInputs> = {}): MonthInputs => ({
  fertility: 1,
  mortality: 1,
  schoolingYears: pop.model.schoolingYears,
  urbanization: 0.02,
  netMigrationRate: pop.model.netMigrationRate,
  ...extra,
});

function consistent(pop: NationPopulation): number {
  let worst = 0;
  for (const g of pop.regions) {
    g.cohorts.forEach((n, i) => {
      const sum = g.culture.reduce((s, layer) => s + (layer[i] ?? 0), 0);
      worst = Math.max(worst, Math.abs(sum - n) / Math.max(1, n));
    });
  }
  return worst;
}

describe('joint culture distribution', () => {
  it('starts with the national shares, spread unevenly across regions', () => {
    const pop = build();
    const mix = composition(pop.combos, pop.regions);
    expect(mix.total).toBeCloseTo(5e6, 0);
    pop.combos.forEach((c, k) => {
      let n = 0;
      for (const g of pop.regions) for (const v of g.culture[k]!) n += v;
      expect(n / mix.total).toBeCloseTo(joint[k]!.share, 6);
      expect(c).toEqual({
        ethnic: joint[k]!.ethnic,
        religion: joint[k]!.religion,
        language: joint[k]!.language,
      });
    });
    // Each region keeps its population, and minorities are concentrated somewhere.
    const regional = pop.regions.map((g) => {
      const total = g.cohorts.reduce((s, n) => s + n, 0);
      return g.culture[2]!.reduce((s, n) => s + n, 0) / total;
    });
    expect(Math.max(...regional) - Math.min(...regional)).toBeGreaterThan(0.02);
    expect(consistent(pop)).toBeLessThan(1e-9);
  });

  it('depends on the seed only through regional concentration', () => {
    const a = build(1n);
    const b = build(2n);
    expect(summarize(cohortsOf(a.regions)).total).toBeCloseTo(
      summarize(cohortsOf(b.regions)).total,
      3,
    );
    expect(JSON.stringify(a.regions[0]!.culture)).not.toBe(JSON.stringify(b.regions[0]!.culture));
  });

  it('keeps cohort totals and combination counts in step through every flow', () => {
    const pop = build();
    for (let m = 0; m < 60; m++) stepMonth(pop, inputs(pop));
    expect(consistent(pop)).toBeLessThan(1e-9);
    expect(pop.regions.every((g) => g.culture.every((l) => l.every((n) => n >= 0)))).toBe(true);
  });

  it('creates mixed and non-religious combinations over time', () => {
    const pop = build();
    for (let m = 0; m < 120; m++) stepMonth(pop, inputs(pop));
    expect(pop.combos.some((c) => c.religion === NO_RELIGION)).toBe(true);
    expect(pop.combos.length).toBeGreaterThan(joint.length);
    expect(noReligionShare(composition(pop.combos, pop.regions))).toBeGreaterThan(0);
  });

  it('secularizes and shifts language only when the rates allow', () => {
    const run = (extra: Partial<MonthInputs>) => {
      const pop = build();
      for (let m = 0; m < 120; m++) stepMonth(pop, inputs(pop, extra));
      const mix = composition(pop.combos, pop.regions);
      return { none: noReligionShare(mix), language: largestShare(mix.language, mix.total) };
    };
    const base = run({});
    const frozen = run({ secularization: 0, languageShift: 0 });
    expect(frozen.none).toBe(0);
    expect(base.none).toBeGreaterThan(frozen.none);
    expect(base.language).toBeGreaterThan(frozen.language);
    expect(run({ secularization: 3 }).none).toBeGreaterThan(base.none);
  });

  it('prunes tiny combinations without losing anyone', () => {
    const pop = build();
    for (let m = 0; m < 24; m++) stepMonth(pop, inputs(pop));
    const before = summarize(cohortsOf(pop.regions)).total;
    const count = pop.combos.length;
    pruneCombinations({ combos: pop.combos, regions: pop.regions }, 0.02);
    expect(pop.combos.length).toBeLessThan(count);
    expect(pop.regions.every((g) => g.culture.length === pop.combos.length)).toBe(true);
    expect(summarize(cohortsOf(pop.regions)).total / before).toBeCloseTo(1, 10);
    expect(consistent(pop)).toBeLessThan(1e-12);
    const totals = composition(pop.combos, pop.regions);
    pop.combos.forEach((_, k) => {
      let n = 0;
      for (const g of pop.regions) for (const v of g.culture[k]!) n += v;
      expect(n / totals.total).toBeGreaterThanOrEqual(0.02 - 1e-12);
    });
  });
});
