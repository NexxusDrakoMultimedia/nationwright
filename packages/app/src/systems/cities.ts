// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The cities system (tick step 12, DESIGN.md §4.2): the player's named cities. Each city
 * holds a share of its region's urban population (from the demography slice), drifting
 * toward more attractive cities. Modifier target: `cities.attractiveness` at city scope
 * (multiplies the base from capital, coast, and river). Founding new cities needs
 * infrastructure (M6).
 */

import {
  baseAttractiveness,
  defineSystem,
  driftShares,
  initialShares,
  summarize,
  zipfExponent,
  type IndicatorDefinition,
  type TickContext,
} from '@nationwright/engine';
import type { DemographySlice } from './demography.ts';

export interface CityState {
  /** Generated city id (also its `city:<id>` scope). */
  readonly id: number;
  readonly name: string;
  readonly region: number;
  readonly cell: number;
  readonly capital: boolean;
  readonly coastal: boolean;
  readonly river: boolean;
  /** Share of the region's urban population. */
  share: number;
  population: number;
}

export interface CitiesSlice {
  cities: CityState[];
}

declare module '@nationwright/engine' {
  interface SystemSlices {
    cities: CitiesSlice;
  }
}

const indicator = (id: string, unit: string, description: string): IndicatorDefinition => ({
  id,
  unit,
  description,
  aggregation: 'last',
  owner: 'cities',
});

export const CITY_INDICATORS: readonly IndicatorDefinition[] = [
  indicator('city.population', 'people', 'City population (city scopes)'),
  indicator('cities.count', 'cities', 'Named cities'),
  indicator('cities.largest_share', '%', 'Largest city as a share of the urban population'),
  indicator('cities.in_cities_share', '%', 'Share of the urban population in named cities'),
  indicator('cities.zipf_exponent', 'exponent', 'Rank-size slope (about 1 in real countries)'),
];

function urbanByRegion(demography: DemographySlice): number[] {
  return demography.regions.map((r) => summarize([r.cohorts]).urban);
}

function updatePopulations(slice: CitiesSlice, urban: readonly number[]): void {
  for (const c of slice.cities) c.population = c.share * (urban[c.region] ?? 0);
}

function recordAll(
  ctx: Pick<TickContext, 'record'>,
  slice: CitiesSlice,
  urban: readonly number[],
): void {
  const totalUrban = urban.reduce((s, n) => s + n, 0);
  const populations = slice.cities.map((c) => c.population);
  const inCities = populations.reduce((s, n) => s + n, 0);
  for (const c of slice.cities) ctx.record('city.population', `city:${c.id}`, c.population);
  ctx.record('cities.count', 'nation', slice.cities.length);
  ctx.record(
    'cities.largest_share',
    'nation',
    totalUrban > 0 ? (100 * Math.max(0, ...populations)) / totalUrban : 0,
  );
  ctx.record(
    'cities.in_cities_share',
    'nation',
    totalUrban > 0 ? (100 * inCities) / totalUrban : 0,
  );
  ctx.record('cities.zipf_exponent', 'nation', zipfExponent(populations));
}

export const citiesSystem = defineSystem({
  id: 'cities',
  slice: 'cities',
  indicators: CITY_INDICATORS,
  init(ctx) {
    const generated = ctx.generated;
    const demography = ctx.world.slices.demography;
    if (generated === undefined || demography === undefined) {
      throw new Error('The cities system needs a generated world and the demography system.');
    }
    const regionOfProvince = new Map(demography.regions.map((r, k) => [r.province, k]));
    const mine = generated.cities.filter((c) => c.country === demography.country);
    const regionOf = mine.map(
      (c) => regionOfProvince.get(generated.map.province[c.cell] as number) ?? 0,
    );
    const urban = urbanByRegion(demography as DemographySlice);
    const shares = initialShares(
      mine.map((c) => c.population),
      regionOf,
      urban,
    );
    const slice: CitiesSlice = {
      cities: mine.map((c, k) => ({
        id: c.id,
        name: c.name,
        region: regionOf[k] as number,
        cell: c.cell,
        capital: c.capital,
        coastal: c.coastal,
        river: c.river,
        share: shares[k] as number,
        population: 0,
      })),
    };
    updatePopulations(slice, urban);
    return slice;
  },
  step(ctx, slice) {
    const demography = ctx.world.slices.demography;
    if (demography === undefined) return;
    const shares = slice.cities.map((c) => c.share);
    driftShares(
      shares,
      slice.cities.map((c) => c.region),
      slice.cities.map(
        (c) =>
          ctx.resolve('cities.attractiveness', `city:${c.id}`, 1).value * baseAttractiveness(c),
      ),
      demography.regions.length,
    );
    slice.cities.forEach((c, k) => (c.share = shares[k] as number));
    const urban = urbanByRegion(demography as DemographySlice);
    updatePopulations(slice, urban);
    if (ctx.tick === 0 || ctx.cadences.annual) recordAll(ctx, slice, urban);
  },
});
