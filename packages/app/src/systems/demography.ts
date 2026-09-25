// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The demography system (tick step 7, DESIGN.md §4.1): the player's nation as a cohort
 * grid per region (region × urban/rural × age × sex × education), projected monthly.
 * Regions are the country's generated provinces. The model itself lives in
 * `@nationwright/engine` (demography/); this system wires it to state, modifiers, and
 * indicators.
 *
 * Modifier targets (resolved monthly at nation scope; bases in parentheses):
 * `demography.fertility_multiplier` (1), `demography.mortality_multiplier` (1),
 * `demography.schooling_years` (the country's expected years of schooling),
 * `demography.urbanization_rate` (tuning), `demography.net_migration_rate` (the
 * country's sampled rate, per 1,000 people per year).
 */

import {
  ageShare,
  buildPopulation,
  defineSystem,
  DEMOGRAPHY_TUNING,
  dependencyRatio,
  medianAge,
  periodFertility,
  periodInfantMortality,
  periodLifeExpectancy,
  schoolingShare,
  stepMonth,
  summarize,
  tertiaryShare,
  type DemographyModel,
  type GeneratedWorld,
  type IndicatorDefinition,
  type NationPopulation,
  type RegionSetup,
  type Scope,
  type TickContext,
} from '@nationwright/engine';

export interface DemographyRegion {
  /** Global province id in the generated world. */
  readonly province: number;
  readonly name: string;
  /** Cohort grid (see the engine's demography/grid.ts). */
  cohorts: number[];
}

export interface YearCounters {
  births: number;
  deaths: number;
  netMigration: number;
  toUrban: number;
  /** Population when the year's counters started. */
  startPopulation: number;
}

export interface DemographySlice {
  /** The country this grid belongs to (the player's). */
  readonly country: number;
  readonly model: DemographyModel;
  regions: DemographyRegion[];
  year: YearCounters;
}

declare module '@nationwright/engine' {
  interface SystemSlices {
    demography: DemographySlice;
  }
}

const indicator = (
  id: string,
  unit: string,
  description: string,
  aggregation: IndicatorDefinition['aggregation'] = 'last',
): IndicatorDefinition => ({ id, unit, description, aggregation, owner: 'demography' });

export const DEMOGRAPHY_INDICATORS: readonly IndicatorDefinition[] = [
  indicator('population.total', 'people', 'Population'),
  indicator('population.births', 'people', 'Live births', 'sum'),
  indicator('population.deaths', 'people', 'Deaths', 'sum'),
  indicator('population.net_migration', 'people', 'Net international migrants', 'sum'),
  indicator('population.urban_share', '%', 'Share of people living in urban areas'),
  indicator('population.birth_rate', 'per 1,000 people', 'Crude birth rate over the year'),
  indicator('population.death_rate', 'per 1,000 people', 'Crude death rate over the year'),
  indicator(
    'population.net_migration_rate',
    'per 1,000 people',
    'Net international migrants over the year per 1,000 people',
  ),
  indicator('population.growth_rate', '%', 'Population growth over the year'),
  indicator('population.tfr', 'children per woman', 'Total fertility rate (period)'),
  indicator('population.life_expectancy', 'years', 'Life expectancy at birth (period)'),
  indicator('population.life_expectancy_female', 'years', 'Female life expectancy at birth'),
  indicator('population.life_expectancy_male', 'years', 'Male life expectancy at birth'),
  indicator('population.infant_mortality', 'per 1,000 births', 'Infant mortality rate'),
  indicator('population.median_age', 'years', 'Median age'),
  indicator('population.age_0_14_share', '%', 'Share aged 0–14'),
  indicator('population.age_65_plus_share', '%', 'Share aged 65 and over'),
  indicator('population.dependency_ratio', 'per 100 aged 15–64', 'Dependents (0–14 and 65+)'),
  indicator('education.any_schooling_share', '%', 'Share of people 15+ with any schooling'),
  indicator('education.tertiary_share', '%', 'Share of people 25+ with tertiary education'),
];

/** Population and urban population of each of the country's provinces. */
export function regionSetup(
  generated: GeneratedWorld,
  country: number,
  urbanShare: number,
): { provinces: number[]; regions: RegionSetup[] } {
  const c = generated.countries[country];
  if (c === undefined) throw new RangeError(`No country ${country} in the generated world.`);
  const provinces = Array.from({ length: c.provinceCount }, (_, k) => c.firstProvince + k);
  const population = provinces.map(() => 0);
  const cityPopulation = provinces.map(() => 0);
  const { owner, province, population: cellPopulation } = generated.map;
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] !== country) continue;
    const k = (province[i] as number) - c.firstProvince;
    if (k >= 0 && k < provinces.length)
      population[k] = (population[k] as number) + (cellPopulation[i] as number);
  }
  for (const city of generated.cities) {
    if (city.country !== country) continue;
    const k = (province[city.cell] as number) - c.firstProvince;
    if (k >= 0 && k < provinces.length)
      cityPopulation[k] = (cityPopulation[k] as number) + city.population;
  }
  // Every region has some towns (30% of the national share); cities take the rest, so
  // the national urban share matches the country's statistic.
  const total = population.reduce((s, n) => s + n, 0);
  const cities = cityPopulation.reduce((s, n) => s + n, 0);
  const target = total * urbanShare;
  const floor = 0.3 * urbanShare;
  const rest = Math.max(0, target - floor * total);
  return {
    provinces,
    regions: population.map((p, k) => ({
      population: p,
      urbanPopulation: Math.min(
        0.97 * p,
        floor * p +
          (cities > 0
            ? (rest * (cityPopulation[k] as number)) / cities
            : (rest * p) / Math.max(1, total)),
      ),
    })),
  };
}

function populationOf(slice: DemographySlice): NationPopulation {
  return { model: slice.model, regions: slice.regions.map((r) => r.cohorts) };
}

function totalOf(slice: DemographySlice): number {
  return summarize(slice.regions.map((r) => r.cohorts)).total;
}

function freshYear(population: number): YearCounters {
  return { births: 0, deaths: 0, netMigration: 0, toUrban: 0, startPopulation: population };
}

/** Structure indicators: recorded after the first month and every December. */
function recordStructure(
  ctx: Pick<TickContext, 'record'>,
  slice: DemographySlice,
  multipliers: { fertility: number; mortality: number },
): void {
  const pop = populationOf(slice);
  const nation = summarize(pop.regions);
  const life = periodLifeExpectancy(pop, multipliers.mortality);
  const record = (id: string, value: number, scope: Scope = 'nation') =>
    ctx.record(id, scope, value);
  record('population.urban_share', nation.total > 0 ? (100 * nation.urban) / nation.total : 0);
  record('population.tfr', periodFertility(pop, multipliers.fertility));
  record('population.life_expectancy', life.both);
  record('population.life_expectancy_female', life.female);
  record('population.life_expectancy_male', life.male);
  record('population.infant_mortality', periodInfantMortality(pop, multipliers.mortality));
  record('population.median_age', medianAge(nation));
  record('population.age_0_14_share', 100 * ageShare(nation, 0, 2));
  record('population.age_65_plus_share', 100 * ageShare(nation, 13, 20));
  record('population.dependency_ratio', dependencyRatio(nation));
  record('education.any_schooling_share', schoolingShare(nation));
  record('education.tertiary_share', tertiaryShare(nation));
  slice.regions.forEach((region, r) => {
    const s = summarize([region.cohorts]);
    const scope: Scope = `region:${r}`;
    record('population.urban_share', s.total > 0 ? (100 * s.urban) / s.total : 0, scope);
    record('population.median_age', medianAge(s), scope);
    record('education.any_schooling_share', schoolingShare(s), scope);
  });
}

function recordTotals(ctx: Pick<TickContext, 'record'>, slice: DemographySlice): void {
  ctx.record('population.total', 'nation', totalOf(slice));
  slice.regions.forEach((region, r) => {
    ctx.record('population.total', `region:${r}`, summarize([region.cohorts]).total);
  });
}

export const demographySystem = defineSystem({
  id: 'demography',
  slice: 'demography',
  indicators: DEMOGRAPHY_INDICATORS,
  init(ctx) {
    const generated = ctx.generated;
    const world = ctx.world.slices.world;
    if (generated === undefined || world === undefined) {
      throw new Error('The demography system needs a generated world and the world system.');
    }
    const country = world.playerCountry;
    const stats = world.countries[country]?.stats;
    if (stats === undefined) throw new RangeError(`No country ${country}.`);
    const { provinces, regions } = regionSetup(
      generated,
      country,
      (stats['population.urban_share'] ?? 50) / 100,
    );
    const pop = buildPopulation(stats, regions);
    const slice: DemographySlice = {
      country,
      model: pop.model,
      regions: provinces.map((p, k) => ({
        province: p,
        name: generated.provinceNames[p] ?? `Region ${k + 1}`,
        cohorts: pop.regions[k] as number[],
      })),
      year: freshYear(0),
    };
    slice.year.startPopulation = totalOf(slice);
    return slice;
  },
  step(ctx, slice) {
    const value = (target: string, base: number) => ctx.resolve(target, 'nation', base).value;
    const multipliers = {
      fertility: value('demography.fertility_multiplier', 1),
      mortality: value('demography.mortality_multiplier', 1),
    };
    const flows = stepMonth(populationOf(slice), {
      ...multipliers,
      schoolingYears: value('demography.schooling_years', slice.model.schoolingYears),
      urbanization: value('demography.urbanization_rate', DEMOGRAPHY_TUNING.urbanizationRate),
      netMigrationRate: value('demography.net_migration_rate', slice.model.netMigrationRate),
    });
    const sum = (xs: readonly number[]) => xs.reduce((s, n) => s + n, 0);
    const births = sum(flows.births);
    const deaths = sum(flows.deaths);
    const netMigration = sum(flows.netMigration);
    slice.year.births += births;
    slice.year.deaths += deaths;
    slice.year.netMigration += netMigration;
    slice.year.toUrban += sum(flows.toUrban);

    recordTotals(ctx, slice);
    ctx.record('population.births', 'nation', births);
    ctx.record('population.deaths', 'nation', deaths);
    ctx.record('population.net_migration', 'nation', netMigration);

    // Structure after the first month (the starting census) and every December.
    if (ctx.tick === 0) recordStructure(ctx, slice, multipliers);
    if (ctx.cadences.annual) {
      const y = slice.year;
      const now = totalOf(slice);
      const mid = (y.startPopulation + now) / 2;
      const perThousand = (n: number) => (mid > 0 ? (1000 * n) / mid : 0);
      ctx.record('population.birth_rate', 'nation', perThousand(y.births));
      ctx.record('population.death_rate', 'nation', perThousand(y.deaths));
      ctx.record('population.net_migration_rate', 'nation', perThousand(y.netMigration));
      ctx.record(
        'population.growth_rate',
        'nation',
        y.startPopulation > 0 ? 100 * (now / y.startPopulation - 1) : 0,
      );
      recordStructure(ctx, slice, multipliers);
      slice.year = freshYear(now);
    }
  },
});
