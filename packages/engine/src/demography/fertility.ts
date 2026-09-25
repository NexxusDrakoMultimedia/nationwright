// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Age-specific fertility (DESIGN.md §4.1). The share of lifetime births in each band
 * blends a late, concentrated schedule (low fertility) with an early, spread one (high
 * fertility); rates are then scaled to the total fertility rate.
 */

import { AGE_BANDS, BAND_YEARS } from './grid.ts';

/** Bands 15–19 … 45–49. */
export const FIRST_FERTILE_BAND = 3;
export const LAST_FERTILE_BAND = 9;

const LATE_SCHEDULE = [0.02, 0.12, 0.3, 0.33, 0.17, 0.05, 0.01];
const EARLY_SCHEDULE = [0.13, 0.24, 0.23, 0.18, 0.13, 0.07, 0.02];

/** Births per woman per year in each age band. */
export function fertilitySchedule(tfr: number): number[] {
  const w = Math.max(0, Math.min(1, (tfr - 1.5) / 3.5));
  const rates = new Array<number>(AGE_BANDS).fill(0);
  LATE_SCHEDULE.forEach((late, i) => {
    const share = late * (1 - w) + (EARLY_SCHEDULE[i] as number) * w;
    rates[FIRST_FERTILE_BAND + i] = (Math.max(0, tfr) * share) / BAND_YEARS;
  });
  return rates;
}
