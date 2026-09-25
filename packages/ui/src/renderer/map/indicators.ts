// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import type { MapCountry, MapData } from '../../shared/protocol.ts';

export interface Indicator {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly format: (value: number) => string;
  /** Value per country; density is per cell instead. */
  readonly value?: (country: MapCountry) => number;
  readonly perCell?: (map: MapData, cell: number) => number;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const one = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const significant = new Intl.NumberFormat('en', { maximumSignificantDigits: 2 });

const stat = (id: string) => (c: MapCountry) => c.stats[id] ?? Number.NaN;

export const INDICATORS: readonly Indicator[] = [
  {
    id: 'density',
    label: 'Population density',
    unit: 'people per km²',
    format: (v) => significant.format(v),
    perCell: (map, cell) => (map.population[cell] ?? 0) / map.cellArea,
  },
  {
    id: 'population.total',
    label: 'Population',
    unit: 'people',
    format: (v) => compact.format(v),
    value: stat('population.total'),
  },
  {
    id: 'economy.gdp_per_capita_ppp',
    label: 'GDP per capita',
    unit: 'USD, PPP',
    format: (v) => `$${compact.format(v)}`,
    value: stat('economy.gdp_per_capita_ppp'),
  },
  {
    id: 'population.life_expectancy',
    label: 'Life expectancy',
    unit: 'years',
    format: (v) => one.format(v),
    value: stat('population.life_expectancy'),
  },
  {
    id: 'population.tfr',
    label: 'Fertility rate',
    unit: 'children per woman',
    format: (v) => one.format(v),
    value: stat('population.tfr'),
  },
  {
    id: 'population.median_age',
    label: 'Median age',
    unit: 'years',
    format: (v) => one.format(v),
    value: stat('population.median_age'),
  },
  {
    id: 'population.urban_share',
    label: 'Urban population',
    unit: '%',
    format: (v) => `${whole.format(v)}%`,
    value: stat('population.urban_share'),
  },
  {
    id: 'communications.internet_users',
    label: 'Internet users',
    unit: '%',
    format: (v) => `${whole.format(v)}%`,
    value: stat('communications.internet_users'),
  },
];

/** Six quantile cut points → seven bins. */
export function quantileBreaks(values: readonly number[]): number[] {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  return [1, 2, 3, 4, 5, 6].map(
    (k) => sorted[Math.min(sorted.length - 1, Math.floor((k / 7) * sorted.length))] as number,
  );
}

export function binOf(breaks: readonly number[], value: number): number {
  if (!Number.isFinite(value)) return -1;
  let bin = 0;
  while (bin < breaks.length && value >= (breaks[bin] as number)) bin++;
  return bin;
}

export { compact, one, whole };
