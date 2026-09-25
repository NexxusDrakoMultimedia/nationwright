// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The cohort grid (DESIGN.md §4.1): every region holds a dense array over settlement ×
 * age band × sex × education. Counts are real numbers (people), as usual in
 * cohort-component models; reports round them.
 */

/** 5-year bands 0–4 … 95–99, then 100+. */
export const AGE_BANDS = 21;
export const BAND_YEARS = 5;
export const SETTLEMENTS = ['urban', 'rural'] as const;
export const SEXES = ['female', 'male'] as const;
export const EDUCATION_LEVELS = ['none', 'primary', 'secondary', 'vocational', 'tertiary'] as const;

export const URBAN = 0;
export const RURAL = 1;
export const FEMALE = 0;
export const MALE = 1;
export const NONE = 0;
export const PRIMARY = 1;
export const SECONDARY = 2;
export const VOCATIONAL = 3;
export const TERTIARY = 4;

const S = SETTLEMENTS.length;
const X = SEXES.length;
const E = EDUCATION_LEVELS.length;

export const CELLS_PER_REGION = S * AGE_BANDS * X * E;

export function cellIndex(settlement: number, age: number, sex: number, education: number): number {
  return ((settlement * AGE_BANDS + age) * X + sex) * E + education;
}

/** First age in a band (100 for the open band). */
export function bandStart(age: number): number {
  return age * BAND_YEARS;
}

/** Label such as "20–24" or "100+". */
export function bandLabel(age: number): string {
  return age === AGE_BANDS - 1 ? `${bandStart(age)}+` : `${bandStart(age)}–${bandStart(age) + 4}`;
}

export function emptyCohorts(): number[] {
  return new Array<number>(CELLS_PER_REGION).fill(0);
}

/** Calls `fn` for every cell in a fixed order. */
export function forEachCell(
  fn: (settlement: number, age: number, sex: number, education: number, index: number) => void,
): void {
  for (let s = 0; s < S; s++)
    for (let a = 0; a < AGE_BANDS; a++)
      for (let x = 0; x < X; x++) for (let e = 0; e < E; e++) fn(s, a, x, e, cellIndex(s, a, x, e));
}
