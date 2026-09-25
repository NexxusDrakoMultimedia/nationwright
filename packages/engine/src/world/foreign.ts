// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The foreign-country model (DESIGN.md §4.10.1, D10): reduced-form demography and
 * economy, updated once a year. Population is three age bands; fertility and life
 * expectancy drift toward income-typical values; income per person grows with catch-up,
 * a fading country-specific residual, and a yearly cycle; inflation anchors, debt follows
 * a fiscal rule. Government, elections, foreign policy, and the military come later.
 */

import { normal } from '../random/distributions.ts';
import { detExp, detLog } from '../random/detmath.ts';
import type { RandomStream } from '../random/stream.ts';
import type { NationStats } from '../worldgen/nation-stats.ts';
import { ECONOMY_TUNING, structuralTargets } from '../economy/model.ts';

export const FOREIGN_TUNING = {
  /** Fertility typical for an income: 1.7 + 4·e^(−income/6,000). */
  fertilityFloor: 1.7,
  fertilityRange: 4,
  fertilityIncomeScale: 6_000,
  /** Life expectancy typical for an income: 55 + 28·(1 − e^(−income/10,000)). */
  lifeBase: 55,
  lifeRange: 28,
  lifeIncomeScale: 10_000,
  /** Half-life (years) of a country's deviation from the income-typical values. */
  deviationHalfLife: 30,
  /**
   * Standard yearly shares moving up an age band (0–14 → 15–64 → 65+); the calibrated
   * starting shares blend toward them with this time constant (years).
   */
  agingShare: 1 / 15,
  retirementShare: 1 / 45,
  ageFlowBlendYears: 20,
  /** Yearly cycle: persistence and shock (points of growth). */
  cyclePersistence: 0.5,
  cycleShock: 1.5,
} as const;

const F = FOREIGN_TUNING;
const E = ECONOMY_TUNING;

/** A foreign country's model state (plain data, stored in the world slice). */
export interface ForeignState {
  /** People aged 0–14, 15–64, 65+. */
  bands: [number, number, number];
  /**
   * Net migration with every country except the player, per 1,000 people per year. It
   * starts as the country's own rate; the world system then removes its starting flows
   * with the player, which are applied separately each year.
   */
  otherMigrationRate: number;
  /** Years simulated so far. */
  years: number;
  /** Births per (TFR × working-age person), calibrated to the starting birth rate. */
  readonly birthScale: number;
  /** Scales the death-rate schedule to the starting death rate. */
  readonly deathScale: number;
  /**
   * Yearly shares of the 0–14 band turning 15 and of the 15–64 band turning 65,
   * calibrated so each band starts on the population's growth path.
   */
  readonly agingShare: number;
  readonly retirementShare: number;
  /** Deviations from income-typical fertility and life expectancy (decaying). */
  fertilityOffset: number;
  lifeOffset: number;
  /** Per-person growth residual (fraction per year, decaying) and cycle (points). */
  growthResidual: number;
  cycle: number;
  /** Sector-share deviation from income targets (points; decaying). */
  structuralOffset: [number, number, number];
  readonly startPriceLevel: number;
  readonly startIncome: number;
}

function stat(stats: NationStats, id: string, fallback: number): number {
  const v = stats[id];
  return v === undefined || !Number.isFinite(v) ? fallback : v;
}

export function typicalFertility(income: number): number {
  return F.fertilityFloor + F.fertilityRange * detExp(-income / F.fertilityIncomeScale);
}

export function typicalLifeExpectancy(income: number): number {
  return F.lifeBase + F.lifeRange * (1 - detExp(-income / F.lifeIncomeScale));
}

/**
 * Death rates of the three bands before scaling, from life expectancy and infant
 * mortality. People 65+ die at about 1 / (remaining life expectancy at 65), which is
 * roughly 0.45·e0 − 18 years.
 */
function deathRates(lifeExpectancy: number, infantMortality: number): [number, number, number] {
  const r = 80 / Math.max(30, lifeExpectancy);
  const at65 = Math.max(8, 0.45 * lifeExpectancy - 18);
  return [((infantMortality / 1000) * 1.3) / 5, 0.002 * r * r * r * r, 1 / at65];
}

function baseGrowth(income: number): number {
  const gap = detLog(E.frontierIncome / Math.max(500, income));
  return Math.max(0, Math.min(0.04, E.frontierGrowth + E.catchUp * Math.max(0, gap)));
}

export function initForeign(stats: NationStats): ForeignState {
  const population = stat(stats, 'population.total', 1e6);
  const young = stat(stats, 'population.age_0_14_share', 25) / 100;
  const old = stat(stats, 'population.age_65_plus_share', 8) / 100;
  const bands: [number, number, number] = [
    population * young,
    population * (1 - young - old),
    population * old,
  ];
  const tfr = stat(stats, 'population.tfr', 2.2);
  const births = (stat(stats, 'population.birth_rate', 16) / 1000) * population;
  const life = stat(stats, 'population.life_expectancy', 72);
  const rates = deathRates(life, stat(stats, 'population.infant_mortality', 20));
  const modelDeaths = rates[0] * bands[0] + rates[1] * bands[1] + rates[2] * bands[2];
  const deaths = (stat(stats, 'population.death_rate', 7) / 1000) * population;
  const deathScale = modelDeaths > 0 ? deaths / modelDeaths : 1;
  const g = stat(stats, 'population.growth_rate', 1) / 100;
  // Band flows that keep each band growing at the population's rate this year.
  const youngDeaths = rates[0] * deathScale * bands[0];
  const oldDeaths = rates[2] * deathScale * bands[2];
  const agingShare = Math.max(
    1 / 20,
    Math.min(1 / 10, (births - youngDeaths - g * bands[0]) / Math.max(1, bands[0])),
  );
  const retirementShare = Math.max(
    0.005,
    Math.min(0.05, (oldDeaths + g * bands[2]) / Math.max(1, bands[1])),
  );
  const income = stat(stats, 'economy.gdp_per_capita_ppp', 15_000);
  const shares = [
    stat(stats, 'economy.sector_agriculture', 8),
    stat(stats, 'economy.sector_industry', 25),
    stat(stats, 'economy.sector_services', 60),
  ];
  const targets = structuralTargets(income, 0);
  const growth = stat(stats, 'economy.gdp_growth', 3) / 100;
  const populationGrowth = stat(stats, 'population.growth_rate', 1) / 100;
  return {
    bands,
    years: 0,
    otherMigrationRate: stat(stats, 'population.net_migration_rate', 0),
    birthScale: births / Math.max(1e-9, tfr * bands[1]),
    deathScale,
    agingShare,
    retirementShare,
    fertilityOffset: tfr - typicalFertility(income),
    lifeOffset: life - typicalLifeExpectancy(income),
    growthResidual: Math.max(-0.03, Math.min(0.03, growth - populationGrowth - baseGrowth(income))),
    cycle: 0,
    structuralOffset: [
      (shares[0] as number) - (targets[0] as number),
      (shares[1] as number) - (targets[1] as number),
      (shares[2] as number) - ((targets[2] as number) + (targets[3] as number)),
    ],
    startPriceLevel: stat(stats, 'economy.price_level', 0.5),
    startIncome: income,
  };
}

/**
 * One year. Updates the model state and returns the country's new statistics (only the
 * fields this model owns; everything else is carried).
 */
export function stepForeign(
  state: ForeignState,
  stats: NationStats,
  stream: RandomStream,
  /** Net migrants arriving from the player's nation this year (negative if leaving to it). */
  playerMigration = 0,
): Record<string, number> {
  const out: Record<string, number> = { ...stats };
  const decay = detExp(-Math.LN2 / F.deviationHalfLife);
  const population = state.bands[0] + state.bands[1] + state.bands[2];
  const income = stat(stats, 'economy.gdp_per_capita_ppp', 15_000);

  // Demography.
  state.fertilityOffset *= decay;
  state.lifeOffset *= decay;
  const tfr = Math.max(0.8, typicalFertility(income) + state.fertilityOffset);
  const life = Math.max(35, Math.min(92, typicalLifeExpectancy(income) + state.lifeOffset));
  const infant = Math.max(1.5, stat(stats, 'population.infant_mortality', 20) * detExp(-0.03));
  const rates = deathRates(life, infant).map((r) => Math.min(0.5, r * state.deathScale));
  const births = state.birthScale * tfr * state.bands[1];
  const deaths = state.bands.map((n, b) => n * (rates[b] as number));
  const migrants = (state.otherMigrationRate / 1000) * population + playerMigration;
  state.years += 1;
  const blend = 1 - detExp(-state.years / F.ageFlowBlendYears);
  const aging = state.bands[0] * (state.agingShare + (F.agingShare - state.agingShare) * blend);
  const retiring =
    state.bands[1] * (state.retirementShare + (F.retirementShare - state.retirementShare) * blend);
  state.bands = [
    Math.max(0, state.bands[0] + births - (deaths[0] as number) - aging),
    Math.max(0, state.bands[1] + aging - retiring - (deaths[1] as number) + migrants),
    Math.max(0, state.bands[2] + retiring - (deaths[2] as number)),
  ];
  const next = state.bands[0] + state.bands[1] + state.bands[2];
  const deathTotal = deaths.reduce((a, b) => a + b, 0);
  out['population.total'] = next;
  out['population.growth_rate'] = population > 0 ? 100 * (next / population - 1) : 0;
  out['population.net_migration_rate'] = population > 0 ? (1000 * migrants) / population : 0;
  out['population.birth_rate'] = population > 0 ? (1000 * births) / population : 0;
  out['population.death_rate'] = population > 0 ? (1000 * deathTotal) / population : 0;
  out['population.tfr'] = tfr;
  out['population.life_expectancy'] = life;
  out['population.infant_mortality'] = infant;
  out['population.age_0_14_share'] = next > 0 ? (100 * state.bands[0]) / next : 0;
  out['population.age_65_plus_share'] = next > 0 ? (100 * state.bands[2]) / next : 0;
  out['population.age_15_64_share'] = next > 0 ? (100 * state.bands[1]) / next : 0;

  // Economy: income per person.
  state.cycle = F.cyclePersistence * state.cycle + F.cycleShock * normal(stream);
  const perPerson = baseGrowth(income) + state.growthResidual + state.cycle / 100;
  state.growthResidual *= detExp(-Math.LN2 / E.residualHalfLife);
  const newIncome = income * (1 + perPerson);
  const gdp = newIncome * next;
  const previousGdp = stat(stats, 'economy.gdp_ppp_real', income * population);
  out['economy.gdp_per_capita_ppp'] = newIncome;
  out['economy.gdp_ppp_real'] = gdp;
  out['economy.gdp_growth'] = previousGdp > 0 ? 100 * (gdp / previousGdp - 1) : 0;

  const inflation = stat(stats, 'economy.inflation', 3);
  out['economy.inflation'] =
    inflation + (E.inflationTarget - inflation) * E.anchoring + E.phillips * state.cycle;
  const unemployment = stat(stats, 'economy.unemployment', 6);
  out['economy.unemployment'] = Math.max(
    0.5,
    unemployment +
      (E.normalUnemployment - unemployment) * (1 - detExp(-Math.LN2 / E.unemploymentHalfLife)) -
      E.okun * state.cycle * 0.5,
  );

  // Structure and prices.
  state.structuralOffset = state.structuralOffset.map((o) => o * decay) as [number, number, number];
  const targets = structuralTargets(newIncome, 0);
  const sectors = [
    (targets[0] as number) + state.structuralOffset[0],
    (targets[1] as number) + state.structuralOffset[1],
    (targets[2] as number) + (targets[3] as number) + state.structuralOffset[2],
  ].map((x) => Math.max(0.1, x));
  const sectorTotal = sectors.reduce((a, b) => a + b, 0);
  out['economy.sector_agriculture'] = (100 * (sectors[0] as number)) / sectorTotal;
  out['economy.sector_industry'] = (100 * (sectors[1] as number)) / sectorTotal;
  out['economy.sector_services'] = (100 * (sectors[2] as number)) / sectorTotal;
  const priceLevel =
    state.startPriceLevel *
    detExp(E.priceLevelElasticity * detLog(newIncome / Math.max(1, state.startIncome)));
  out['economy.price_level'] = priceLevel;
  const worldPrices = 1 + E.worldInflation / 100;
  const previousLevel = stat(stats, 'economy.price_level', priceLevel);
  out['economy.gdp_nominal'] =
    stat(stats, 'economy.gdp_nominal', gdp * priceLevel) *
    (gdp / Math.max(1, previousGdp)) *
    (priceLevel / previousLevel) *
    worldPrices;

  // Public debt (% of GDP): the overall balance moves toward a fiscal rule (more surplus
  // the higher the debt), and debt follows the identity d' = d / nominal growth − balance.
  const debt = stat(stats, 'economy.public_debt', 50);
  const balance = stat(stats, 'economy.budget_balance_share', -2);
  const ruleBalance = -2 + E.debtResponse * (debt - E.debtAnchor);
  const newBalance = balance + ((ruleBalance - balance) * 12) / E.fiscalAdjustmentMonths;
  const nominalGrowth =
    (gdp / Math.max(1, previousGdp)) * (priceLevel / previousLevel) * worldPrices;
  out['economy.budget_balance_share'] = newBalance;
  out['economy.public_debt'] = Math.max(0, debt / nominalGrowth - newBalance);
  return out;
}
