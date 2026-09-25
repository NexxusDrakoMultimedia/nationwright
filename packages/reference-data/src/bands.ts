// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Validation bands (DESIGN.md §10.1): the real-world spread of each indicator across
 * states, after projection to the target year.
 *
 *   typical      10th–90th percentile
 *   plausible    min–max
 *   implausible  more than 10% of the range beyond min or max
 */

import { FIELDS } from './fields.ts';
import { DERIVED_INDICATORS, type ProjectedCountry } from './project.ts';
import { quantile } from './stats.ts';

export interface Band {
  readonly id: string;
  readonly unit: string;
  readonly description: string;
  /** Number of states with a value. */
  readonly n: number;
  /** How many of those values are low-confidence projections. */
  readonly lowConfidence: number;
  readonly min: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  readonly max: number;
  readonly implausibleBelow: number;
  readonly implausibleAbove: number;
}

/** Bands need at least this many states to mean anything. */
export const MIN_BAND_SIZE = 20;

export function computeBands(countries: readonly ProjectedCountry[]): Band[] {
  const states = countries.filter((c) => c.kind === 'state');
  const indicators = [
    ...FIELDS.map(({ id, unit, description }) => ({ id, unit, description })),
    ...DERIVED_INDICATORS,
  ];
  const bands: Band[] = [];
  for (const { id, unit, description } of indicators) {
    const entries = states.map((s) => s.fields[id]).filter((f) => f !== undefined);
    if (entries.length < MIN_BAND_SIZE) continue;
    const values = entries.map((e) => e.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const margin = 0.1 * (max - min);
    bands.push({
      id,
      unit,
      description,
      n: values.length,
      lowConfidence: entries.filter((e) => e.lowConfidence).length,
      min,
      p10: round(quantile(values, 0.1)),
      p50: round(quantile(values, 0.5)),
      p90: round(quantile(values, 0.9)),
      max,
      implausibleBelow: round(min - margin),
      implausibleAbove: round(max + margin),
    });
  }
  return bands;
}

function round(value: number): number {
  return Number(value.toPrecision(10));
}
