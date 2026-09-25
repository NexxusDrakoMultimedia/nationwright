// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ageShare,
  attainment,
  bandRates,
  buildPopulation,
  calibrateMortality,
  chooseArchetype,
  createStream,
  educationTarget,
  fertilitySchedule,
  infantMortality,
  lifeExpectancy,
  lifeExpectancyBySex,
  medianAge,
  periodFertility,
  periodInfantMortality,
  periodLifeExpectancy,
  prepareModel,
  sampleNation,
  schoolingShare,
  stepMonth,
  summarize,
  AGE_BANDS,
  type GuidingVariables,
  type MonthInputs,
  type NationPopulation,
  type NationStats,
} from '../../src/index.ts';

const guiding = JSON.parse(
  readFileSync(
    new URL('../../../reference-data/data/guiding-variables-2026.json', import.meta.url),
    'utf8',
  ),
) as GuidingVariables;
const prepared = prepareModel(guiding);

function sampleStats(n: number, seed: bigint): NationStats[] {
  const stream = createStream(seed, 'test/demography');
  return Array.from(
    { length: n },
    () => sampleNation(prepared, chooseArchetype(prepared, stream), stream).stats,
  );
}

function populationFor(stats: NationStats): NationPopulation {
  const p = stats['population.total']!;
  const u = stats['population.urban_share']! / 100;
  return buildPopulation(stats, [
    { population: 0.7 * p, urbanPopulation: 0.7 * p * Math.min(0.95, u * 1.2) },
    { population: 0.3 * p, urbanPopulation: 0.3 * p * u * 0.5 },
  ]);
}

const baseline = (pop: NationPopulation): MonthInputs => ({
  fertility: 1,
  mortality: 1,
  schoolingYears: pop.model.schoolingYears,
  urbanization: 0.02,
  netMigrationRate: pop.model.netMigrationRate,
});

const total = (pop: NationPopulation) => summarize(pop.regions).total;

describe('life tables', () => {
  it('hit any life expectancy from 45 to 88 years', () => {
    for (let e0 = 45; e0 <= 88; e0 += 1.5) {
      for (const imr of [2, 10, 40, 90]) {
        const p = calibrateMortality(e0, imr);
        expect(lifeExpectancy(bandRates(p))).toBeCloseTo(e0, 1);
      }
    }
  });

  it('hit infant mortality when it is consistent with life expectancy', () => {
    for (const [e0, imr] of [
      [82, 3],
      [75, 12],
      [65, 45],
      [55, 80],
    ] as const) {
      expect(infantMortality(calibrateMortality(e0, imr))).toBeCloseTo(imr, 0);
    }
  });

  it('split both-sexes life expectancy with a female advantage', () => {
    for (const both of [50, 65, 80]) {
      const { female, male } = lifeExpectancyBySex(both, 1.05);
      expect(female).toBeGreaterThan(male);
      expect((female + 1.05 * male) / 2.05).toBeCloseTo(both, 9);
    }
  });
});

describe('fertility and education schedules', () => {
  it('sum to the total fertility rate', () => {
    for (const tfr of [0.9, 1.6, 2.5, 4, 6.5]) {
      const rates = fertilitySchedule(tfr);
      expect(rates).toHaveLength(AGE_BANDS);
      expect(5 * rates.reduce((s, r) => s + r, 0)).toBeCloseTo(tfr, 9);
    }
  });

  it('give attainment shares that sum to 1 at every age', () => {
    for (const years of [0, 5, 10, 15, 20]) {
      expect(attainment(years).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
      for (let a = 0; a < AGE_BANDS; a++) {
        const t = educationTarget(a, years, 1.5);
        expect(t.every((v) => v >= 0)).toBe(true);
        expect(t.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
      }
    }
  });
});

describe('starting population', () => {
  const nations = sampleStats(40, 11n);

  it('matches each nation’s sampled statistics', () => {
    for (const stats of nations) {
      const pop = populationFor(stats);
      const s = summarize(pop.regions);
      expect(s.total / stats['population.total']!).toBeCloseTo(1, 9);
      expect(100 * ageShare(s, 0, 2)).toBeCloseTo(stats['population.age_0_14_share']!, 6);
      expect(100 * ageShare(s, 13, 20)).toBeCloseTo(stats['population.age_65_plus_share']!, 6);
      expect(periodFertility(pop, 1)).toBeCloseTo(stats['population.tfr']!, 6);
      expect(periodLifeExpectancy(pop, 1).both).toBeCloseTo(
        stats['population.life_expectancy']!,
        1,
      );
      // Median age follows from the model's age shape; it lands near the sampled value.
      expect(Math.abs(medianAge(s) - stats['population.median_age']!)).toBeLessThan(6);
    }
  });

  it('matches literacy wherever the schooling model can reach it', () => {
    let matched = 0;
    for (const stats of nations) {
      const got = schoolingShare(summarize(populationFor(stats).regions));
      if (Math.abs(got - stats['education.literacy']!) < 0.5) matched++;
    }
    expect(matched / nations.length).toBeGreaterThan(0.9);
  });

  it('keeps each region’s population and urban population', () => {
    const pop = buildPopulation(nations[0]!, [
      { population: 1000, urbanPopulation: 400 },
      { population: 250, urbanPopulation: 0 },
    ]);
    expect(summarize([pop.regions[0]!]).total).toBeCloseTo(1000, 9);
    expect(summarize([pop.regions[0]!]).urban).toBeCloseTo(400, 9);
    expect(summarize([pop.regions[1]!]).urban).toBe(0);
  });
});

describe('monthly projection', () => {
  it('conserves people: next = now + births − deaths + net migration', () => {
    for (const stats of sampleStats(15, 22n)) {
      const pop = populationFor(stats);
      for (let m = 0; m < 36; m++) {
        const before = total(pop);
        const f = stepMonth(pop, baseline(pop));
        const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
        const expected = before + sum(f.births) - sum(f.deaths) + sum(f.netMigration);
        expect(total(pop) / expected).toBeCloseTo(1, 10);
      }
      expect(pop.regions.every((c) => c.every((n) => n >= 0 && Number.isFinite(n)))).toBe(true);
    }
  });

  it('starts with birth and death rates close to the sampled ones', () => {
    let close = 0;
    const nations = sampleStats(30, 33n);
    for (const stats of nations) {
      const pop = populationFor(stats);
      const start = total(pop);
      let births = 0;
      for (let m = 0; m < 12; m++)
        births += stepMonth(pop, baseline(pop)).births.reduce((a, b) => a + b, 0);
      if (Math.abs((1000 * births) / start - stats['population.birth_rate']!) < 5) close++;
    }
    expect(close / nations.length).toBeGreaterThan(0.8);
  });

  it('responds to modifiers in the right direction', () => {
    const stats = sampleStats(1, 44n)[0]!;
    const run = (inputs: Partial<MonthInputs>) => {
      const pop = populationFor(stats);
      let births = 0;
      let deaths = 0;
      for (let m = 0; m < 12; m++) {
        const f = stepMonth(pop, { ...baseline(pop), ...inputs });
        births += f.births.reduce((a, b) => a + b, 0);
        deaths += f.deaths.reduce((a, b) => a + b, 0);
      }
      return { births, deaths, urban: summarize(pop.regions).urban };
    };
    const base = run({});
    expect(run({ fertility: 1.2 }).births).toBeGreaterThan(base.births);
    expect(run({ mortality: 0.8 }).deaths).toBeLessThan(base.deaths);
    expect(run({ urbanization: 0.05 }).urban).toBeGreaterThan(base.urban);
    expect(run({ urbanization: 0 }).urban).toBeLessThan(base.urban);
  });

  it('keeps infant mortality steady without modifiers', () => {
    const pop = populationFor(sampleStats(1, 55n)[0]!);
    const start = periodInfantMortality(pop, 1);
    for (let m = 0; m < 24; m++) stepMonth(pop, baseline(pop));
    expect(Math.abs(periodInfantMortality(pop, 1) - start)).toBeLessThan(0.1 * start + 0.5);
  });

  it('is deterministic', () => {
    const stats = sampleStats(1, 66n)[0]!;
    const a = populationFor(stats);
    const b = populationFor(stats);
    for (let m = 0; m < 24; m++) {
      stepMonth(a, baseline(a));
      stepMonth(b, baseline(b));
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
