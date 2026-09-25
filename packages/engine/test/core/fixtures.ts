// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/** Toy systems for engine tests. They exercise every engine feature without real models. */

import { defineSystem, type CommandSpec } from '../../src/index.ts';

export interface ToyPopulation {
  people: number;
  births: number[];
}

export interface ToyEconomy {
  taxRate: number;
  revenue: number;
}

declare module '../../src/index.ts' {
  interface SystemSlices {
    toyPopulation: ToyPopulation;
    toyEconomy: ToyEconomy;
  }
}

export const toyDemography = defineSystem({
  id: 'demography',
  slice: 'toyPopulation',
  indicators: [
    {
      id: 'population.total',
      unit: 'people',
      description: 'Total population',
      aggregation: 'last',
      owner: 'demography',
    },
  ],
  init: (ctx) => ({ people: 1000 + ctx.stream().nextIntBelow(1000), births: [] }),
  step(ctx, slice) {
    const rate = ctx.resolve('demography.birth_rate', 'nation', 0.01).value;
    const noise = ctx.stream().nextFloat64() * 0.002;
    const births = Math.round(slice.people * (rate + noise));
    slice.people += births;
    slice.births.push(births);
    ctx.record('population.total', 'nation', slice.people);
    if (ctx.cadences.annual) {
      ctx.chronicle({
        category: 'milestone',
        text: `Population ${slice.people}`,
        refs: ['nation'],
      });
    }
  },
});

export const toyEconomy = defineSystem({
  id: 'economy',
  slice: 'toyEconomy',
  indicators: [
    {
      id: 'economy.revenue',
      unit: 'currency',
      description: 'Tax revenue this month',
      aggregation: 'sum',
      owner: 'economy',
    },
  ],
  init: () => ({ taxRate: 0.2, revenue: 0 }),
  step(ctx, slice) {
    const people = ctx.world.slices.toyPopulation?.people ?? 0;
    slice.revenue = Math.round(people * slice.taxRate * 100) / 100;
    ctx.record('economy.revenue', 'nation', slice.revenue);
  },
});

export const setTaxRate: CommandSpec<{ rate: number }> = {
  type: 'economy/set-tax-rate',
  validate(payload) {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return { ok: false, reason: 'payload must be an object' };
    }
    const rate = (payload as { rate?: unknown }).rate;
    if (typeof rate !== 'number' || rate < 0 || rate > 1) {
      return { ok: false, reason: 'rate must be a number in [0, 1]' };
    }
    return { ok: true, payload: { rate } };
  },
  apply(world, payload) {
    const economy = world.slices.toyEconomy;
    if (economy) economy.taxRate = payload.rate;
  },
};

export const baseOptions = {
  seed: 'q3Zk1d0XbAc',
  startYear: 2026,
  systems: [toyDemography, toyEconomy],
  commands: [setTaxRate],
} as const;
