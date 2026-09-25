// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPopulation,
  calibrateEconomy,
  chooseArchetype,
  cohortsOf,
  createStream,
  incomeFeedback,
  laborInputs,
  normal,
  NO_POLICY,
  prepareModel,
  realGdp,
  sampleNation,
  sectorShares,
  stepEconomy,
  stepMonth,
  type EconomyState,
  type GuidingVariables,
  type MonthPolicy,
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

function nations(n: number, seed: bigint): { stats: NationStats; pop: NationPopulation }[] {
  const stream = createStream(seed, 'test/economy');
  return Array.from({ length: n }, () => {
    const stats = sampleNation(prepared, chooseArchetype(prepared, stream), stream).stats;
    const p = stats['population.total']!;
    const pop = buildPopulation(stats, [
      { population: p, urbanPopulation: (p * stats['population.urban_share']!) / 100 },
    ]);
    return { stats, pop };
  });
}

function run(
  stats: NationStats,
  pop: NationPopulation,
  months: number,
  policy: MonthPolicy = NO_POLICY,
  seed = 1n,
): EconomyState {
  const state = calibrateEconomy(stats, laborInputs(cohortsOf(pop.regions)));
  const shocks = createStream(seed, 'test/cycle');
  for (let m = 0; m < months; m++) {
    stepMonth(pop, {
      fertility: 1,
      mortality: 1,
      schoolingYears: pop.model.schoolingYears,
      urbanization: 0.02,
      netMigrationRate: pop.model.netMigrationRate,
    });
    stepEconomy(state, laborInputs(cohortsOf(pop.regions)), policy, normal(shocks));
  }
  return state;
}

describe('economy calibration', () => {
  it('matches each nation’s sampled statistics at the start', () => {
    for (const { stats, pop } of nations(30, 5n)) {
      const labor = laborInputs(cohortsOf(pop.regions));
      const e = calibrateEconomy(stats, labor);
      expect(realGdp(e) / labor.population / stats['economy.gdp_per_capita_ppp']!).toBeCloseTo(
        1,
        9,
      );
      const shares = sectorShares(e);
      const total =
        stats['economy.sector_agriculture']! +
        stats['economy.sector_industry']! +
        stats['economy.sector_services']!;
      expect(shares.agriculture).toBeCloseTo(
        (100 * stats['economy.sector_agriculture']!) / total,
        6,
      );
      expect(shares.industry).toBeCloseTo((100 * stats['economy.sector_industry']!) / total, 6);
      expect(e.unemployment).toBeCloseTo(
        Math.max(0.5, Math.min(40, stats['economy.unemployment']!)),
        9,
      );
      expect((100 * e.debt) / e.nominalGdp).toBeCloseTo(stats['economy.public_debt']!, 6);
      // Revenue − primary spending − interest reproduces the sampled balance.
      const balance = e.revenueShare - e.primarySpendingShare - (100 * e.interest) / e.nominalGdp;
      if (e.primarySpendingShare > 0)
        expect(balance).toBeCloseTo(stats['economy.budget_balance_share']!, 6);
    }
  });
});

describe('economy dynamics', () => {
  const sample = nations(12, 6n);

  it('stays finite and bounded over 50 years', () => {
    for (const { stats, pop } of sample) {
      const e = run(stats, pop, 600);
      const debt = (100 * e.debt) / e.nominalGdp;
      expect(Number.isFinite(realGdp(e))).toBe(true);
      expect(debt).toBeGreaterThanOrEqual(0);
      expect(debt).toBeLessThan(200);
      expect(e.unemployment).toBeGreaterThan(0);
      expect(e.unemployment).toBeLessThan(50);
      expect(Math.abs(e.inflation - 2.5)).toBeLessThan(6);
    }
  });

  it('grows income per person at plausible long-run rates', () => {
    for (const { stats, pop } of sample) {
      const e = run(stats, pop, 360);
      const labor = laborInputs(cohortsOf(pop.regions));
      const start = e.startGdp / e.startPopulation;
      const yearly = Math.pow(realGdp(e) / labor.population / start, 1 / 30) - 1;
      expect(yearly).toBeGreaterThan(-0.01);
      expect(yearly).toBeLessThan(0.06);
    }
  });

  it('responds to policy in the right direction', () => {
    const { stats } = sample[0]!;
    const fresh = () =>
      buildPopulation(stats, [
        {
          population: stats['population.total']!,
          urbanPopulation: 0.5 * stats['population.total']!,
        },
      ]);
    const base = run(stats, fresh(), 60);
    expect(realGdp(run(stats, fresh(), 60, { ...NO_POLICY, productivity: 1.05 }))).toBeGreaterThan(
      realGdp(base),
    );
    const taxed = run(stats, fresh(), 60, { ...NO_POLICY, revenueShare: 5 });
    expect(taxed.debt / taxed.nominalGdp).toBeLessThan(base.debt / base.nominalGdp);
    const invested = run(stats, fresh(), 120, { ...NO_POLICY, investmentShare: 5 });
    expect(realGdp(invested)).toBeGreaterThan(realGdp(run(stats, fresh(), 120)));
  });

  it('feeds income back to demography: richer means lower fertility and mortality', () => {
    const { stats, pop } = sample[1]!;
    const e = run(stats, pop, 240);
    const labor = laborInputs(cohortsOf(pop.regions));
    const f = incomeFeedback(e, labor.population);
    const richer = realGdp(e) / labor.population > e.startGdp / e.startPopulation;
    expect(f.fertility < 1).toBe(richer);
    expect(f.mortality < 1).toBe(richer);
  });

  it('defaults when debt passes 250% of GDP, writing off half', () => {
    const { stats, pop } = sample[3]!;
    const labor = laborInputs(cohortsOf(pop.regions));
    const e = calibrateEconomy(stats, labor);
    e.debt = 3 * e.nominalGdp;
    const result = stepEconomy(e, labor, NO_POLICY, 0);
    expect(result.defaulted).toBe(true);
    expect((100 * e.debt) / e.nominalGdp).toBeLessThan(160);
    expect(stepEconomy(e, labor, NO_POLICY, 0).defaulted).toBe(false);
  });

  it('is deterministic', () => {
    const { stats } = sample[2]!;
    const make = () =>
      buildPopulation(stats, [
        {
          population: stats['population.total']!,
          urbanPopulation: 0.5 * stats['population.total']!,
        },
      ]);
    expect(JSON.stringify(run(stats, make(), 36))).toBe(JSON.stringify(run(stats, make(), 36)));
  });
});
