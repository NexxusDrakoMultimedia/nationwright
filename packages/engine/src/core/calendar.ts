// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Simulation calendar (DESIGN.md §3.1). The base tick is one month; tick 0 is January of
 * the start year. Coarser cadences fire at the *end* of their period, so a quarterly step
 * sees three complete months and an annual step sees twelve.
 */

export interface SimDate {
  readonly year: number;
  /** 1 = January … 12 = December. */
  readonly month: number;
}

export interface Cadences {
  readonly monthly: true;
  /** Last month of a quarter: March, June, September, December. */
  readonly quarterly: boolean;
  /** Last month of the year: December. */
  readonly annual: boolean;
}

export function dateOfTick(startYear: number, tick: number): SimDate {
  assertTick(tick);
  return { year: startYear + Math.floor(tick / 12), month: (tick % 12) + 1 };
}

export function tickOfDate(startYear: number, date: SimDate): number {
  const tick = (date.year - startYear) * 12 + (date.month - 1);
  assertTick(tick);
  return tick;
}

export function cadencesOfTick(tick: number): Cadences {
  assertTick(tick);
  const month = (tick % 12) + 1;
  return { monthly: true, quarterly: month % 3 === 0, annual: month === 12 };
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function formatDate(date: SimDate): string {
  return `${MONTHS[date.month - 1] ?? '?'} ${date.year}`;
}

function assertTick(tick: number): void {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError(`A tick must be a non-negative safe integer; got ${tick}.`);
  }
}
