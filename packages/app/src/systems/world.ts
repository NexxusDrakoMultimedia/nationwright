// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The world system (tick step 4, DESIGN.md §4.10): owns every country's mutable state.
 * Geography stays in the generated world (read-only); what can change during play
 * (names, statistics, cultures) lives in this slice. Each December, foreign countries
 * advance a year under the reduced-form model (engine world/foreign.ts), and the player's
 * entry is refreshed from the detailed demography and economy, so comparisons between
 * countries stay consistent. Governments and foreign policy arrive in M4.
 */

import {
  cohortsOf,
  defineSystem,
  initForeign,
  realGdp,
  sectorShares,
  stepForeign,
  summarize,
  type CountryCulture,
  type ForeignState,
  type IndicatorDefinition,
  type NationStats,
  type Scope,
} from '@nationwright/engine';
import type { DemographySlice } from './demography.ts';
import type { EconomySlice } from './economy.ts';

export interface CountryState {
  readonly id: number;
  name: string;
  demonym: string;
  archetype: number;
  governmentCategory: string;
  stats: NationStats;
  culture: CountryCulture;
  /** The reduced-form model; null for the player's country (simulated in detail). */
  model: ForeignState | null;
}

export interface WorldSlice {
  countries: CountryState[];
  /**
   * The player's country. Until the creation wizard (M9) lets the player choose, it is
   * drawn at random from the world's countries (stream `init/world/player`).
   */
  playerCountry: number;
}

declare module '@nationwright/engine' {
  interface SystemSlices {
    world: WorldSlice;
  }
}

const indicator = (id: string, unit: string, description: string): IndicatorDefinition => ({
  id,
  unit,
  description,
  aggregation: 'last',
  owner: 'world',
});

/** Per-country series (country scopes), recorded each December from the stats. */
const COUNTRY_SERIES: readonly (readonly [string, string, string, string])[] = [
  ['country.population', 'population.total', 'people', 'Population'],
  [
    'country.gdp_per_capita_ppp',
    'economy.gdp_per_capita_ppp',
    'USD (2021, PPP)',
    'Real GDP per person',
  ],
  ['country.gdp_growth', 'economy.gdp_growth', '%/yr', 'Real GDP growth'],
  ['country.inflation', 'economy.inflation', '%/yr', 'Inflation'],
  ['country.unemployment', 'economy.unemployment', '%', 'Unemployment'],
  ['country.public_debt', 'economy.public_debt', '% of GDP', 'Public debt'],
  ['country.tfr', 'population.tfr', 'children per woman', 'Total fertility rate'],
  ['country.life_expectancy', 'population.life_expectancy', 'years', 'Life expectancy'],
];

export const WORLD_INDICATORS: readonly IndicatorDefinition[] = [
  indicator('world.population', 'people', 'Population of the whole world'),
  indicator('world.gdp_ppp', 'USD (2021, PPP)', 'Real GDP of the whole world'),
  ...COUNTRY_SERIES.map(([id, , unit, description]) =>
    indicator(id, unit, `${description} (country scopes)`),
  ),
];

/** The player's current figures from the detailed systems (last month's state). */
function playerStats(
  stats: NationStats,
  demography: DemographySlice | undefined,
  economy: EconomySlice | undefined,
): NationStats {
  const out: Record<string, number> = { ...stats };
  if (demography !== undefined) {
    const s = summarize(cohortsOf(demography.regions));
    out['population.total'] = s.total;
    out['population.urban_share'] = s.total > 0 ? (100 * s.urban) / s.total : 0;
  }
  if (economy !== undefined) {
    const e = economy.state;
    const gdp = realGdp(e);
    const shares = sectorShares(e);
    const population = out['population.total'] ?? 1;
    const previous = stats['economy.gdp_ppp_real'];
    out['economy.gdp_ppp_real'] = gdp;
    out['economy.gdp_per_capita_ppp'] = gdp / Math.max(1, population);
    if (previous !== undefined && previous > 0)
      out['economy.gdp_growth'] = 100 * (gdp / previous - 1);
    out['economy.gdp_nominal'] = e.nominalGdp;
    out['economy.price_level'] = e.priceLevel;
    out['economy.inflation'] = e.inflation;
    out['economy.unemployment'] = e.unemployment;
    out['economy.public_debt'] = e.nominalGdp > 0 ? (100 * e.debt) / e.nominalGdp : 0;
    out['economy.sector_agriculture'] = shares.agriculture;
    out['economy.sector_industry'] = shares.industry;
    out['economy.sector_services'] = shares.services;
  }
  return out;
}

export const worldSystem = defineSystem({
  id: 'world',
  slice: 'world',
  indicators: WORLD_INDICATORS,
  init(ctx) {
    const generated = ctx.generated;
    if (generated === undefined) throw new Error('The world system needs a generated world.');
    const playerCountry = ctx.stream('player').nextIntBelow(generated.countries.length);
    return {
      countries: generated.countries.map((c) => ({
        id: c.id,
        name: c.name,
        demonym: c.demonym,
        archetype: c.nation.archetype,
        governmentCategory: c.nation.governmentCategory,
        stats: { ...c.nation.stats },
        culture: c.culture,
        model: c.id === playerCountry ? null : initForeign(c.nation.stats),
      })),
      playerCountry,
    };
  },
  step(ctx, slice) {
    if (!ctx.cadences.annual) return;
    const demography = ctx.world.slices.demography as DemographySlice | undefined;
    const economy = ctx.world.slices.economy as EconomySlice | undefined;
    for (const country of slice.countries) {
      if (country.model === null) {
        country.stats = playerStats(country.stats, demography, economy);
      } else {
        country.stats = stepForeign(
          country.model,
          country.stats,
          ctx.stream(`country/${country.id}`),
        );
      }
    }
    let population = 0;
    let gdp = 0;
    for (const country of slice.countries) {
      const scope: Scope = `country:${country.id}`;
      for (const [id, stat] of COUNTRY_SERIES) {
        const value = country.stats[stat];
        if (value !== undefined && Number.isFinite(value)) ctx.record(id, scope, value);
      }
      population += country.stats['population.total'] ?? 0;
      gdp += country.stats['economy.gdp_ppp_real'] ?? 0;
    }
    ctx.record('world.population', 'nation', population);
    ctx.record('world.gdp_ppp', 'nation', gdp);
  },
});
