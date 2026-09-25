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
 * country's sampled rate, per 1,000 people per year), `demography.secularization_multiplier`
 * (1), `demography.language_shift_multiplier` (1), `demography.internal_migration_rate`
 * (tuning), and per region `demography.region_attractiveness` (1, multiplied into the
 * interim attractiveness from urban share and the capital).
 */

import {
  ageShare,
  buildPopulation,
  cellDistance,
  cohortsOf,
  composition,
  fractionalization,
  largestShare,
  migrateInternally,
  noReligionShare,
  pruneCombinations,
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
  type Combination,
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
  /** People per combination per cohort cell: `culture[k][cell]` (demography/culture.ts). */
  culture: number[][];
}

export interface YearCounters {
  births: number;
  deaths: number;
  netMigration: number;
  toUrban: number;
  secularized: number;
  languageShifted: number;
  /** Population when the year's counters started. */
  startPopulation: number;
}

export interface DemographySlice {
  /** The country this grid belongs to (the player's). */
  readonly country: number;
  readonly model: DemographyModel;
  /** Ethnicity × religion × language combinations in use (religion −1 = none). */
  combos: Combination[];
  regions: DemographyRegion[];
  /** Distance between regions' seats (their most populous map cells), km. */
  readonly distances: readonly (readonly number[])[];
  /** The region holding the capital. */
  readonly capitalRegion: number;
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
  indicator(
    'population.net_internal_migration',
    'people',
    'Net arrivals from other regions (regional scopes)',
    'sum',
  ),
  indicator('population.internal_migration', 'people', 'People moving between regions', 'sum'),
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
  indicator(
    'society.ethnic_fractionalization',
    'index 0–1',
    'Chance two random people are from different ethnic groups',
  ),
  indicator(
    'society.religious_fractionalization',
    'index 0–1',
    'Chance two random people have different religions (none counts as one)',
  ),
  indicator(
    'society.linguistic_fractionalization',
    'index 0–1',
    'Chance two random people speak different languages',
  ),
  indicator('society.largest_ethnic_share', '%', 'Share of the largest ethnic group'),
  indicator('society.no_religion_share', '%', 'Share of people with no religion'),
  indicator('society.largest_language_share', '%', 'Share speaking the most spoken language'),
  indicator('society.secularized', 'people', 'People who left their religion', 'sum'),
  indicator('society.language_shifted', 'people', 'People who switched language', 'sum'),
  indicator(
    'society.culture_combinations',
    'combinations',
    'Ethnicity × religion × language combinations tracked',
  ),
];

/**
 * Population and urban population of each of the country's provinces, their seats (most
 * populous cells), the distances between seats, and the capital's region.
 */
export function regionSetup(
  generated: GeneratedWorld,
  country: number,
  urbanShare: number,
): { provinces: number[]; regions: RegionSetup[]; distances: number[][]; capitalRegion: number } {
  const c = generated.countries[country];
  if (c === undefined) throw new RangeError(`No country ${country} in the generated world.`);
  const provinces = Array.from({ length: c.provinceCount }, (_, k) => c.firstProvince + k);
  const population = provinces.map(() => 0);
  const cityPopulation = provinces.map(() => 0);
  const seats = provinces.map(() => -1);
  const { owner, province, population: cellPopulation } = generated.map;
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] !== country) continue;
    const k = (province[i] as number) - c.firstProvince;
    if (k < 0 || k >= provinces.length) continue;
    population[k] = (population[k] as number) + (cellPopulation[i] as number);
    const seat = seats[k] as number;
    if (seat < 0 || (cellPopulation[i] as number) > (cellPopulation[seat] as number)) seats[k] = i;
  }
  const grid = generated.map.grid;
  const distances = seats.map((a) =>
    seats.map((b) => (a < 0 || b < 0 ? 0 : cellDistance(grid, a, b))),
  );
  const capitalRegion = Math.max(0, (province[c.capitalCell] as number) - c.firstProvince);
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
    distances,
    capitalRegion,
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

/** The engine's view of the slice: the same arrays, so the step updates the slice. */
function populationOf(slice: DemographySlice): NationPopulation {
  return { model: slice.model, combos: slice.combos, regions: slice.regions };
}

function totalOf(slice: DemographySlice): number {
  return summarize(cohortsOf(slice.regions)).total;
}

function freshYear(population: number): YearCounters {
  return {
    births: 0,
    deaths: 0,
    netMigration: 0,
    toUrban: 0,
    secularized: 0,
    languageShifted: 0,
    startPopulation: population,
  };
}

/** Structure indicators: recorded after the first month and every December. */
function recordStructure(
  ctx: Pick<TickContext, 'record'>,
  slice: DemographySlice,
  multipliers: { fertility: number; mortality: number },
): void {
  const pop = populationOf(slice);
  const nation = summarize(cohortsOf(pop.regions));
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
  const mix = composition(slice.combos, slice.regions);
  record('society.ethnic_fractionalization', fractionalization(mix.ethnic, mix.total));
  record('society.religious_fractionalization', fractionalization(mix.religion, mix.total));
  record('society.linguistic_fractionalization', fractionalization(mix.language, mix.total));
  record('society.largest_ethnic_share', 100 * largestShare(mix.ethnic, mix.total));
  record('society.no_religion_share', 100 * noReligionShare(mix));
  record('society.largest_language_share', 100 * largestShare(mix.language, mix.total));
  record('society.culture_combinations', slice.combos.length);
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
    const { provinces, regions, distances, capitalRegion } = regionSetup(
      generated,
      country,
      (stats['population.urban_share'] ?? 50) / 100,
    );
    const culture = world.countries[country]?.culture;
    const pop = buildPopulation(
      stats,
      regions,
      culture === undefined ? undefined : { joint: culture.joint, stream: ctx.stream('culture') },
    );
    const slice: DemographySlice = {
      country,
      model: pop.model,
      combos: pop.combos,
      distances,
      capitalRegion,
      regions: provinces.map((p, k) => {
        const grid = pop.regions[k];
        if (grid === undefined) throw new Error(`Missing region ${k}.`);
        return {
          province: p,
          name: generated.provinceNames[p] ?? `Region ${k + 1}`,
          cohorts: grid.cohorts,
          culture: grid.culture,
        };
      }),
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
      secularization: value('demography.secularization_multiplier', 1),
      languageShift: value('demography.language_shift_multiplier', 1),
    });
    const sum = (xs: readonly number[]) => xs.reduce((s, n) => s + n, 0);

    // Internal migration. Interim attractiveness: urban share and the capital (the
    // economy replaces this with wages, jobs, and services in M3).
    const internal = migrateInternally(slice.regions, {
      rate: value('demography.internal_migration_rate', DEMOGRAPHY_TUNING.internalMigrationRate),
      distances: slice.distances,
      attractiveness: slice.regions.map((region, r) => {
        const s = summarize([region.cohorts]);
        const base =
          (0.2 + (s.total > 0 ? s.urban / s.total : 0)) *
          (r === slice.capitalRegion ? DEMOGRAPHY_TUNING.capitalAttraction : 1);
        return ctx.resolve('demography.region_attractiveness', `region:${r}`, 1).value * base;
      }),
    });
    internal.net.forEach((n, r) =>
      ctx.record('population.net_internal_migration', `region:${r}`, n),
    );
    ctx.record('population.internal_migration', 'nation', internal.movers);

    const births = sum(flows.births);
    const deaths = sum(flows.deaths);
    const netMigration = sum(flows.netMigration);
    slice.year.births += births;
    slice.year.deaths += deaths;
    slice.year.netMigration += netMigration;
    slice.year.toUrban += sum(flows.toUrban);
    slice.year.secularized += sum(flows.secularized);
    slice.year.languageShifted += sum(flows.languageShifted);
    ctx.record('society.secularized', 'nation', sum(flows.secularized));
    ctx.record('society.language_shifted', 'nation', sum(flows.languageShifted));

    recordTotals(ctx, slice);
    ctx.record('population.births', 'nation', births);
    ctx.record('population.deaths', 'nation', deaths);
    ctx.record('population.net_migration', 'nation', netMigration);

    // Structure after the first month (the starting census) and every December.
    if (ctx.tick === 0) recordStructure(ctx, slice, multipliers);
    if (ctx.cadences.annual) {
      pruneCombinations(
        { combos: slice.combos, regions: slice.regions },
        DEMOGRAPHY_TUNING.pruneShare,
      );
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
