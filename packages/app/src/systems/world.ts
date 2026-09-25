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
  capEndowment,
  COMMODITIES,
  createMarket,
  defineSystem,
  endowments,
  ECONOMY_TUNING,
  exportsOf,
  fitTrade,
  importsOf,
  initForeign,
  prices,
  rentIndex,
  rents,
  stepMarket,
  tradeFlows,
  tradeGeography,
  realGdp,
  sectorShares,
  stepForeign,
  summarize,
  type CommodityMarket,
  type CountryCulture,
  type ForeignState,
  type IndicatorDefinition,
  type NationStats,
  type Scope,
  type TradeInputs,
  type TradeModel,
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

export interface WorldTrade {
  /** Effective transport distance between countries, km. */
  readonly distances: number[][];
  /** Port cell of each country, and whether it is on the country's own coast. */
  readonly ports: number[];
  readonly ownCoast: boolean[];
  readonly model: TradeModel;
  /** The player's exports and imports as shares of its GDP (%), as of last December. */
  playerExportsShare: number;
  playerImportsShare: number;
}

export interface WorldCommodities {
  market: CommodityMarket;
  /** Deposit richness per commodity for each country (scaled so rent shares saturate). */
  readonly endowments: number[][];
  /** The player's real rent index (1 at the start), as of last December. */
  playerRentIndex: number;
  /** The player's resource rents as a share of GDP at the start (fraction). */
  readonly playerRentShare: number;
}

export interface WorldSlice {
  countries: CountryState[];
  trade: WorldTrade;
  commodities: WorldCommodities;
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
  indicator('world.trade', 'USD', 'World exports (reference currency)'),
  indicator('trade.exports_to', 'USD', 'Your exports to a country (country scopes)'),
  indicator('trade.imports_from', 'USD', 'Your imports from a country (country scopes)'),
  ...COMMODITIES.map((c) =>
    indicator(
      `commodity.${c.replace(/ /g, '_')}_price`,
      'index',
      `World ${c} price (1 at the start, in start-year prices)`,
    ),
  ),
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

/** Trade inputs from the countries' current statistics. */
export function tradeInputs(
  countries: readonly { readonly stats: NationStats }[],
  distances: readonly (readonly number[])[],
): TradeInputs {
  return {
    gdp: countries.map((c) => Math.max(1, c.stats['economy.gdp_nominal'] ?? 1)),
    priceLevel: countries.map((c) => c.stats['economy.price_level'] ?? 0.5),
    distances,
  };
}

/** Current bilateral flows (flows[i][j] = exports from i to j), recomputed on demand. */
export function currentTrade(slice: WorldSlice): number[][] {
  return tradeFlows(slice.trade.model, tradeInputs(slice.countries, slice.trade.distances));
}

export const worldSystem = defineSystem({
  id: 'world',
  slice: 'world',
  indicators: WORLD_INDICATORS,
  init(ctx) {
    const generated = ctx.generated;
    if (generated === undefined) throw new Error('The world system needs a generated world.');
    const playerCountry = ctx.stream('player').nextIntBelow(generated.countries.length);
    const geography = tradeGeography(generated);
    const inputs = tradeInputs(
      generated.countries.map((c) => ({ stats: c.nation.stats })),
      geography.distances,
    );
    const share = (c: (typeof generated.countries)[number], id: string) =>
      ((c.nation.stats[id] ?? 30) / 100) * Math.max(1, c.nation.stats['economy.gdp_nominal'] ?? 1);
    const model = fitTrade(
      inputs,
      generated.countries.map((c) => share(c, 'economy.exports_share_gdp')),
      generated.countries.map((c) => share(c, 'economy.imports_share_gdp')),
    );
    const flows = tradeFlows(model, inputs);
    const playerGdp = inputs.gdp[playerCountry] as number;

    // Resource deposits and the commodity market.
    const raw = endowments(
      generated.map.resources,
      generated.map.owner,
      generated.countries.length,
    );
    const market = createMarket(
      raw,
      inputs.gdp.reduce((a, b) => a + b, 0),
    );
    const capped = raw.map((e, k) => capEndowment(market, e, inputs.gdp[k] as number));
    const rentShare = (k: number) =>
      rents(market, capped[k] as number[]) / (inputs.gdp[k] as number);
    return {
      commodities: {
        market,
        endowments: capped,
        playerRentIndex: 1,
        playerRentShare: rentShare(playerCountry),
      },
      trade: {
        distances: geography.distances,
        ports: geography.ports,
        ownCoast: geography.ownCoast,
        model,
        playerExportsShare: (100 * exportsOf(flows, playerCountry)) / playerGdp,
        playerImportsShare: (100 * importsOf(flows, playerCountry)) / playerGdp,
      },
      countries: generated.countries.map((c) => ({
        id: c.id,
        name: c.name,
        demonym: c.demonym,
        archetype: c.nation.archetype,
        governmentCategory: c.nation.governmentCategory,
        stats: { ...c.nation.stats, 'economy.resource_rents_share': 100 * rentShare(c.id) },
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
    const { market, endowments: endowment } = slice.commodities;
    const rentsBefore = slice.countries.map((c) => rents(market, endowment[c.id] as number[]));
    stepMarket(market, ctx.stream('commodities'), ECONOMY_TUNING.worldInflation);
    for (const country of slice.countries) {
      const k = country.id;
      if (country.model === null) {
        country.stats = playerStats(country.stats, demography, economy);
        continue;
      }
      const before = country.stats;
      const stepped = stepForeign(country.model, before, ctx.stream(`country/${k}`));
      // Commodity windfall: rents beyond what growth alone would bring. It adds to
      // nominal GDP, and a third of it to real income per person.
      const oldGdp = Math.max(1, before['economy.gdp_nominal'] ?? 1);
      const newGdp = Math.max(1, stepped['economy.gdp_nominal'] ?? oldGdp);
      const now = rents(market, endowment[k] as number[]);
      const windfall = now - (rentsBefore[k] as number) * (newGdp / oldGdp);
      const gdpNominal = Math.max(1, newGdp + windfall);
      const perPerson = stepped['economy.gdp_per_capita_ppp'] ?? 0;
      country.stats = {
        ...stepped,
        'economy.gdp_nominal': gdpNominal,
        'economy.gdp_per_capita_ppp': perPerson * (1 + windfall / newGdp / 3),
        'economy.resource_rents_share': (100 * now) / gdpNominal,
      };
    }
    const playerEndowment = endowment[slice.playerCountry] as number[];
    slice.commodities.playerRentIndex = rentIndex(market, playerEndowment);
    const price = prices(market);
    COMMODITIES.forEach((c, i) =>
      ctx.record(`commodity.${c.replace(/ /g, '_')}_price`, 'nation', price[i] as number),
    );
    // Trade follows this year's GDP and prices.
    const flows = currentTrade(slice);
    const player = slice.playerCountry;
    slice.countries.forEach((country, k) => {
      const gdpNominal = Math.max(1, country.stats['economy.gdp_nominal'] ?? 1);
      country.stats = {
        ...country.stats,
        'economy.exports_share_gdp': (100 * exportsOf(flows, k)) / gdpNominal,
        'economy.imports_share_gdp': (100 * importsOf(flows, k)) / gdpNominal,
      };
      if (k !== player) {
        ctx.record(
          'trade.exports_to',
          `country:${country.id}`,
          (flows[player] as number[])[k] as number,
        );
        ctx.record(
          'trade.imports_from',
          `country:${country.id}`,
          (flows[k] as number[])[player] as number,
        );
      }
    });
    const playerStatsNow = slice.countries[player]?.stats;
    slice.trade.playerExportsShare = playerStatsNow?.['economy.exports_share_gdp'] ?? 0;
    slice.trade.playerImportsShare = playerStatsNow?.['economy.imports_share_gdp'] ?? 0;
    ctx.record(
      'world.trade',
      'nation',
      flows.reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0), 0),
    );

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
