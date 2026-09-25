// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The world system (tick step 4, DESIGN.md §4.10): owns every country's mutable state.
 * Geography stays in the generated world (read-only); what can change during play
 * (names, statistics, cultures) lives in this slice. For M1 it only initializes; the
 * foreign-country models arrive in M3–M4.
 */

import { defineSystem, type CountryCulture, type NationStats } from '@nationwright/engine';

export interface CountryState {
  readonly id: number;
  name: string;
  demonym: string;
  archetype: number;
  governmentCategory: string;
  stats: NationStats;
  culture: CountryCulture;
}

export interface WorldSlice {
  countries: CountryState[];
  /** The player's country, chosen in the creation wizard (M9); null until then. */
  playerCountry: number | null;
}

declare module '@nationwright/engine' {
  interface SystemSlices {
    world: WorldSlice;
  }
}

export const worldSystem = defineSystem({
  id: 'world',
  slice: 'world',
  indicators: [
    {
      id: 'world.population',
      unit: 'people',
      description: 'Population of the whole world',
      aggregation: 'last',
      owner: 'world',
    },
  ],
  init(ctx) {
    const generated = ctx.generated;
    if (generated === undefined) throw new Error('The world system needs a generated world.');
    return {
      countries: generated.countries.map((c) => ({
        id: c.id,
        name: c.name,
        demonym: c.demonym,
        archetype: c.nation.archetype,
        governmentCategory: c.nation.governmentCategory,
        stats: { ...c.nation.stats },
        culture: c.culture,
      })),
      playerCountry: null,
    };
  },
  step(ctx, slice) {
    if (!ctx.cadences.annual) return;
    const total = slice.countries.reduce((sum, c) => sum + (c.stats['population.total'] ?? 0), 0);
    ctx.record('world.population', 'nation', total);
  },
});
