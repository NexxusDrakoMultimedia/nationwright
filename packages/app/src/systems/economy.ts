// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The economy system (tick step 9, DESIGN.md §4.3): the player's national economy,
 * calibrated to the nation's sampled statistics and driven monthly by labour and
 * schooling from demography. The model lives in `@nationwright/engine` (economy/).
 *
 * Modifier targets (nation scope; bases in parentheses): `economy.productivity_multiplier`
 * (1), and additions `economy.revenue_share`, `economy.spending_share`,
 * `economy.investment_share`, `economy.participation`, `economy.natural_unemployment`,
 * `economy.demand_shock` (all 0). Each December it sets demography's fertility and
 * mortality multipliers for the next year from income growth since the start.
 */

import {
  calibrateEconomy,
  defineSystem,
  incomeFeedback,
  laborInputs,
  normal,
  realGdp,
  sectorShares,
  stepEconomy,
  type EconomyState,
  type IndicatorDefinition,
  type LaborInputs,
  type TickContext,
} from '@nationwright/engine';
import type { DemographySlice } from './demography.ts';

export interface EconomyYear {
  /** Real GDP (PPP) at the end of last year, for growth. */
  startGdp: number;
  revenue: number;
  spending: number;
  balance: number;
  /** Months counted. */
  months: number;
}

export interface EconomySlice {
  state: EconomyState;
  year: EconomyYear;
}

declare module '@nationwright/engine' {
  interface SystemSlices {
    economy: EconomySlice;
  }
}

const indicator = (
  id: string,
  unit: string,
  description: string,
  aggregation: IndicatorDefinition['aggregation'] = 'last',
): IndicatorDefinition => ({ id, unit, description, aggregation, owner: 'economy' });

export const ECONOMY_INDICATORS: readonly IndicatorDefinition[] = [
  indicator('economy.gdp_ppp_real', 'USD (2021, PPP)', 'Real GDP, annual rate'),
  indicator('economy.gdp_per_capita_ppp', 'USD (2021, PPP)', 'Real GDP per person'),
  indicator('economy.gdp_growth', '%/yr', 'Real GDP growth over the year'),
  indicator('economy.gdp_nominal', 'USD', 'Nominal GDP in the reference currency'),
  indicator('economy.price_level', 'ratio', 'Price level relative to PPP'),
  indicator('economy.inflation', '%/yr', 'Consumer price inflation (annual rate)'),
  indicator('economy.unemployment', '%', 'Unemployment rate'),
  indicator('economy.interest_rate', '%', 'Policy interest rate'),
  indicator('economy.output_gap', '%', 'Output gap (actual vs potential)'),
  indicator('economy.exchange_index', 'index', 'Local currency per reference unit (1 at start)'),
  indicator('economy.sector_agriculture', '% of GDP', 'Agriculture share of GDP'),
  indicator('economy.sector_industry', '% of GDP', 'Industry share of GDP'),
  indicator('economy.sector_services', '% of GDP', 'Services share of GDP (incl. public)'),
  indicator('economy.public_debt', '% of GDP', 'Public debt'),
  indicator('economy.revenue_share_gdp', '% of GDP', 'Government revenues over the year'),
  indicator('economy.expenditure_share_gdp', '% of GDP', 'Government spending over the year'),
  indicator('economy.budget_balance_share', '% of GDP', 'Budget balance over the year'),
  indicator('economy.investment_share', '% of GDP', 'Investment in fixed capital'),
  indicator('economy.government_consumption_share', '% of GDP', 'Government consumption'),
  indicator('economy.household_consumption_share', '% of GDP', 'Household consumption'),
  indicator('economy.exports_share_gdp', '% of GDP', 'Exports'),
  indicator('economy.imports_share_gdp', '% of GDP', 'Imports'),
  indicator('economy.trade_balance_share', '% of GDP', 'Exports minus imports'),
  indicator('economy.labor_force', 'people', 'Labour force'),
  indicator('economy.labor_participation', '% of people 15+', 'Labour force participation'),
  indicator('economy.employment', 'people', 'People in work'),
  indicator('economy.gini', 'index 0–100', 'Gini index of income'),
];

function laborOf(demography: DemographySlice): LaborInputs {
  return laborInputs(demography.regions.map((r) => r.cohorts));
}

function freshYear(state: EconomyState): EconomyYear {
  return { startGdp: realGdp(state), revenue: 0, spending: 0, balance: 0, months: 0 };
}

function recordMonthly(
  ctx: Pick<TickContext, 'record'>,
  s: EconomyState,
  labor: LaborInputs,
): void {
  const gdp = realGdp(s);
  ctx.record('economy.gdp_ppp_real', 'nation', gdp);
  ctx.record('economy.gdp_per_capita_ppp', 'nation', gdp / Math.max(1, labor.population));
  ctx.record('economy.inflation', 'nation', s.inflation);
  ctx.record('economy.unemployment', 'nation', s.unemployment);
  ctx.record('economy.interest_rate', 'nation', s.interestRate);
  ctx.record('economy.output_gap', 'nation', 100 * s.outputGap);
}

function recordAnnual(
  ctx: Pick<TickContext, 'record'>,
  slice: EconomySlice,
  labor: LaborInputs,
  employed: number,
  laborForce: number,
): void {
  const s = slice.state;
  const y = slice.year;
  const record = (id: string, value: number) => ctx.record(id, 'nation', value);
  const shares = sectorShares(s);
  // Flows are annual rates each month, so their average over the year is the annual flow.
  const perGdp = (flow: number) =>
    s.nominalGdp > 0 ? (100 * flow) / Math.max(1, y.months) / s.nominalGdp : 0;
  record('economy.gdp_growth', y.startGdp > 0 ? 100 * (realGdp(s) / y.startGdp - 1) : 0);
  record('economy.gdp_nominal', s.nominalGdp);
  record('economy.price_level', s.priceLevel);
  record('economy.exchange_index', s.exchangeIndex);
  record('economy.sector_agriculture', shares.agriculture);
  record('economy.sector_industry', shares.industry);
  record('economy.sector_services', shares.services);
  record('economy.public_debt', s.nominalGdp > 0 ? (100 * s.debt) / s.nominalGdp : 0);
  record('economy.revenue_share_gdp', perGdp(y.revenue));
  record('economy.expenditure_share_gdp', perGdp(y.spending));
  record('economy.budget_balance_share', perGdp(y.balance));
  record('economy.investment_share', s.investmentShare);
  record('economy.government_consumption_share', s.governmentConsumptionShare);
  record(
    'economy.household_consumption_share',
    100 - s.investmentShare - s.governmentConsumptionShare - (s.exportsShare - s.importsShare),
  );
  record('economy.exports_share_gdp', s.exportsShare);
  record('economy.imports_share_gdp', s.importsShare);
  record('economy.trade_balance_share', s.exportsShare - s.importsShare);
  record('economy.labor_force', laborForce);
  record('economy.labor_participation', labor.adults > 0 ? (100 * laborForce) / labor.adults : 0);
  record('economy.employment', employed);
  record('economy.gini', s.gini);
}

export const economySystem = defineSystem({
  id: 'economy',
  slice: 'economy',
  indicators: ECONOMY_INDICATORS,
  init(ctx) {
    const demography = ctx.world.slices.demography;
    const world = ctx.world.slices.world;
    if (demography === undefined || world === undefined) {
      throw new Error('The economy system needs the world and demography systems.');
    }
    const stats = world.countries[demography.country]?.stats;
    if (stats === undefined) throw new RangeError(`No country ${demography.country}.`);
    const state = calibrateEconomy(stats, laborOf(demography as DemographySlice));
    // Trade shares come from the world's gravity model (fitted to these statistics).
    state.exportsShare = world.trade.playerExportsShare;
    state.importsShare = world.trade.playerImportsShare;
    return { state, year: freshYear(state) };
  },
  step(ctx, slice) {
    const demography = ctx.world.slices.demography;
    if (demography === undefined) return;
    const labor = laborOf(demography as DemographySlice);
    const add = (target: string) => ctx.resolve(target, 'nation', 0).value;
    // New trade shares from the world (updated each December) move demand: half of the
    // change in net exports (points of GDP) shows up in the output gap.
    const trade = ctx.world.slices.world?.trade;
    let tradeImpulse = 0;
    if (trade !== undefined) {
      const before = slice.state.exportsShare - slice.state.importsShare;
      slice.state.exportsShare = trade.playerExportsShare;
      slice.state.importsShare = trade.playerImportsShare;
      tradeImpulse = (0.5 * (slice.state.exportsShare - slice.state.importsShare - before)) / 100;
    }
    const result = stepEconomy(
      slice.state,
      labor,
      {
        productivity: ctx.resolve('economy.productivity_multiplier', 'nation', 1).value,
        revenueShare: add('economy.revenue_share'),
        spendingShare: add('economy.spending_share'),
        investmentShare: add('economy.investment_share'),
        participation: add('economy.participation'),
        naturalUnemployment: add('economy.natural_unemployment'),
        demandShock: add('economy.demand_shock') + tradeImpulse,
      },
      normal(ctx.stream('cycle')),
    );
    if (result.defaulted) {
      ctx.chronicle({
        category: 'economy',
        text: 'The government could no longer service its debt and defaulted, writing off half of it.',
        refs: ['nation'],
      });
    }
    slice.year.revenue += result.revenue;
    slice.year.spending += result.spending;
    slice.year.balance += result.balance;
    slice.year.months += 1;
    recordMonthly(ctx, slice.state, labor);

    if (ctx.tick === 0 || ctx.cadences.annual) {
      recordAnnual(ctx, slice, labor, result.employed, result.laborForce);
    }
    if (ctx.cadences.annual) {
      // Income since the start feeds next year's fertility and mortality.
      const feedback = incomeFeedback(slice.state, labor.population);
      const source = { kind: 'economy', id: 'income', label: 'Income since the start' };
      for (const [target, value] of [
        ['demography.fertility_multiplier', feedback.fertility],
        ['demography.mortality_multiplier', feedback.mortality],
      ] as const) {
        ctx.addModifier({
          source,
          target,
          scope: 'nation',
          op: 'multiply',
          value,
          startTick: ctx.tick + 1,
          endTick: ctx.tick + 13,
        });
      }
      slice.year = freshYear(slice.state);
    }
  },
});
