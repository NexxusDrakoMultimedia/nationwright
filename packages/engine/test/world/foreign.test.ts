// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  chooseArchetype,
  createStream,
  initForeign,
  prepareModel,
  sampleNation,
  stepForeign,
  typicalFertility,
  typicalLifeExpectancy,
  type GuidingVariables,
  type NationStats,
} from '../../src/index.ts';

const guiding = JSON.parse(
  readFileSync(
    new URL('../../../reference-data/data/guiding-variables-2026.json', import.meta.url),
    'utf8',
  ),
) as GuidingVariables;
const prepared = prepareModel(guiding);

function nations(n: number, seed: bigint): NationStats[] {
  const stream = createStream(seed, 'test/foreign');
  return Array.from(
    { length: n },
    () => sampleNation(prepared, chooseArchetype(prepared, stream), stream).stats,
  );
}

describe('foreign-country model', () => {
  it('continues each country’s statistics smoothly in the first year', () => {
    for (const stats of nations(40, 1n)) {
      const state = initForeign(stats);
      const next = stepForeign(state, stats, createStream(2n, 'test/cycle'));
      expect(next['population.birth_rate']!).toBeCloseTo(stats['population.birth_rate']!, 0);
      expect(next['population.death_rate']!).toBeCloseTo(stats['population.death_rate']!, 0);
      expect(
        Math.abs(next['population.growth_rate']! - stats['population.growth_rate']!),
      ).toBeLessThan(0.3);
      expect(
        Math.abs(next['population.age_65_plus_share']! - stats['population.age_65_plus_share']!),
      ).toBeLessThan(0.5);
    }
  });

  it('stays finite and plausible over 100 years', () => {
    for (const [i, start] of nations(30, 3n).entries()) {
      let stats: NationStats = start;
      const state = initForeign(stats);
      const stream = createStream(BigInt(i), 'test/cycle');
      for (let y = 0; y < 100; y++) stats = stepForeign(state, stats, stream);
      for (const v of Object.values(stats)) expect(Number.isFinite(v)).toBe(true);
      expect(stats['population.total']!).toBeGreaterThan(0);
      expect(Math.abs(stats['population.growth_rate']!)).toBeLessThan(4);
      expect(stats['population.age_65_plus_share']!).toBeLessThan(45);
      expect(stats['economy.public_debt']!).toBeLessThan(200);
      expect(Math.abs(stats['economy.inflation']! - 2.5)).toBeLessThan(5);
      const yearly =
        Math.pow(
          stats['economy.gdp_per_capita_ppp']! / start['economy.gdp_per_capita_ppp']!,
          1 / 100,
        ) - 1;
      expect(yearly).toBeGreaterThan(-0.01);
      expect(yearly).toBeLessThan(0.05);
    }
  });

  it('converges fertility and life expectancy toward income-typical values', () => {
    expect(typicalFertility(1_000)).toBeGreaterThan(typicalFertility(50_000));
    expect(typicalLifeExpectancy(1_000)).toBeLessThan(typicalLifeExpectancy(50_000));
    for (const [i, start] of nations(20, 4n).entries()) {
      let stats: NationStats = start;
      const state = initForeign(stats);
      const stream = createStream(BigInt(i), 'test/cycle');
      for (let y = 0; y < 80; y++) stats = stepForeign(state, stats, stream);
      const income = stats['economy.gdp_per_capita_ppp']!;
      const startGap = Math.abs(
        start['population.tfr']! - typicalFertility(start['economy.gdp_per_capita_ppp']!),
      );
      expect(Math.abs(stats['population.tfr']! - typicalFertility(income))).toBeLessThanOrEqual(
        startGap + 1e-9,
      );
    }
  });
});
