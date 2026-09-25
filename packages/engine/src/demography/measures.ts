// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Summary measures of a cohort grid (DESIGN.md §4.1 outputs): totals, age structure,
 * education, and period rates (total fertility, life expectancy, infant mortality) under
 * the current composition and multipliers.
 */

import { FIRST_FERTILE_BAND, LAST_FERTILE_BAND } from './fertility.ts';
import {
  AGE_BANDS,
  BAND_YEARS,
  bandStart,
  EDUCATION_LEVELS,
  FEMALE,
  forEachCell,
  MALE,
  NONE,
  TERTIARY,
  URBAN,
} from './grid.ts';
import { bandRates, infantMortality, lifeExpectancy } from './life-table.ts';
import { NO_RELIGION, type Combination } from './culture.ts';
import { fertilityMultiplier, mortalityMultiplier, type NationPopulation } from './population.ts';
import { DEMOGRAPHY_TUNING as T } from './tuning.ts';

export interface PopulationSummary {
  readonly total: number;
  readonly urban: number;
  /** People by age band and sex ([band][female, male]). */
  readonly byAgeSex: readonly (readonly number[])[];
  /** People 15+ and 25+ by education level. */
  readonly education15Plus: readonly number[];
  readonly education25Plus: readonly number[];
}

export function summarize(regions: readonly (readonly number[])[]): PopulationSummary {
  let total = 0;
  let urban = 0;
  const byAgeSex = Array.from({ length: AGE_BANDS }, () => [0, 0]);
  const education15Plus = new Array<number>(EDUCATION_LEVELS.length).fill(0);
  const education25Plus = new Array<number>(EDUCATION_LEVELS.length).fill(0);
  for (const c of regions) {
    forEachCell((s, a, x, e, i) => {
      const n = c[i] as number;
      total += n;
      if (s === URBAN) urban += n;
      const band = byAgeSex[a] as number[];
      band[x] = (band[x] as number) + n;
      if (a >= 3) education15Plus[e] = (education15Plus[e] as number) + n;
      if (a >= 5) education25Plus[e] = (education25Plus[e] as number) + n;
    });
  }
  return { total, urban, byAgeSex, education15Plus, education25Plus };
}

export function ageShare(summary: PopulationSummary, from: number, to: number): number {
  let n = 0;
  for (let a = from; a <= to; a++)
    n += (summary.byAgeSex[a]?.[0] ?? 0) + (summary.byAgeSex[a]?.[1] ?? 0);
  return summary.total > 0 ? n / summary.total : 0;
}

/** Median age, interpolating within the band that holds the midpoint. */
export function medianAge(summary: PopulationSummary): number {
  const half = summary.total / 2;
  let below = 0;
  for (let a = 0; a < AGE_BANDS; a++) {
    const n = (summary.byAgeSex[a]?.[0] ?? 0) + (summary.byAgeSex[a]?.[1] ?? 0);
    if (below + n >= half && n > 0) return bandStart(a) + (BAND_YEARS * (half - below)) / n;
    below += n;
  }
  return 0;
}

/** (0–14 + 65+) per 100 people aged 15–64. */
export function dependencyRatio(summary: PopulationSummary): number {
  const working = ageShare(summary, 3, 12);
  return working > 0
    ? (100 * (ageShare(summary, 0, 2) + ageShare(summary, 13, AGE_BANDS - 1))) / working
    : 0;
}

/** Period total fertility rate under the current composition. */
export function periodFertility(pop: NationPopulation, multiplier: number): number {
  let tfr = 0;
  for (let a = FIRST_FERTILE_BAND; a <= LAST_FERTILE_BAND; a++) {
    let women = 0;
    let weighted = 0;
    for (const { cohorts: c } of pop.regions) {
      forEachCell((s, age, x, e, i) => {
        if (age !== a || x !== FEMALE) return;
        women += c[i] as number;
        weighted += (c[i] as number) * fertilityMultiplier(s, e);
      });
    }
    const mean = women > 0 ? weighted / women : 1;
    tfr +=
      BAND_YEARS *
      (pop.model.fertility[a] as number) *
      (pop.model.fertilityNorm[a] as number) *
      mean *
      multiplier;
  }
  return tfr;
}

function effectiveRates(pop: NationPopulation, multiplier: number): number[][] {
  const people = Array.from({ length: AGE_BANDS * 2 }, () => 0);
  const weighted = Array.from({ length: AGE_BANDS * 2 }, () => 0);
  for (const { cohorts: c } of pop.regions) {
    forEachCell((s, a, x, e, i) => {
      const k = a * 2 + x;
      people[k] = (people[k] as number) + (c[i] as number);
      weighted[k] = (weighted[k] as number) + (c[i] as number) * mortalityMultiplier(s, a, e);
    });
  }
  return [FEMALE, MALE].map((x) => {
    const base = bandRates(pop.model.mortality[x] as (typeof pop.model.mortality)[0]);
    return base.map((m, a) => {
      const k = a * 2 + x;
      const mean = (people[k] as number) > 0 ? (weighted[k] as number) / (people[k] as number) : 1;
      return m * (pop.model.mortalityNorm[k] as number) * mean * multiplier;
    });
  });
}

/** Period life expectancy at birth by sex and for both sexes. */
export function periodLifeExpectancy(
  pop: NationPopulation,
  multiplier: number,
): { female: number; male: number; both: number } {
  const [female, male] = effectiveRates(pop, multiplier).map(lifeExpectancy) as [number, number];
  return { female, male, both: (female + T.sexRatioAtBirth * male) / (1 + T.sexRatioAtBirth) };
}

/** Infant deaths per 1,000 births under current rates. */
export function periodInfantMortality(pop: NationPopulation, multiplier: number): number {
  const effective = effectiveRates(pop, multiplier);
  const [female, male] = [FEMALE, MALE].map((x) => {
    const params = pop.model.mortality[x] as (typeof pop.model.mortality)[0];
    const base = bandRates(params)[0] as number;
    const k = base > 0 ? ((effective[x] as number[])[0] as number) / base : 1;
    return infantMortality({
      juvenile: params.juvenile * k,
      background: params.background * k,
      senescent: params.senescent * k,
    });
  }) as [number, number];
  return (female + T.sexRatioAtBirth * male) / (1 + T.sexRatioAtBirth);
}

/** Share of people 15+ with any schooling, as a literacy proxy (percent). */
export function schoolingShare(summary: PopulationSummary): number {
  const all = summary.education15Plus.reduce((s, n) => s + n, 0);
  return all > 0 ? 100 * (1 - (summary.education15Plus[NONE] as number) / all) : 0;
}

/** Share of people 25+ with tertiary education (percent). */
export function tertiaryShare(summary: PopulationSummary): number {
  const all = summary.education25Plus.reduce((s, n) => s + n, 0);
  return all > 0 ? (100 * (summary.education25Plus[TERTIARY] as number)) / all : 0;
}

/** Cohort arrays of a nation's regions, for `summarize`. */
export function cohortsOf(
  regions: readonly { readonly cohorts: readonly number[] }[],
): (readonly number[])[] {
  return regions.map((g) => g.cohorts);
}

export interface Composition {
  /** People by ethnic group, faith (NO_RELIGION for none), and language id. */
  readonly ethnic: ReadonlyMap<number, number>;
  readonly religion: ReadonlyMap<number, number>;
  readonly language: ReadonlyMap<number, number>;
  readonly total: number;
}

export function composition(
  combos: readonly Combination[],
  regions: readonly { readonly culture: readonly (readonly number[])[] }[],
): Composition {
  const ethnic = new Map<number, number>();
  const religion = new Map<number, number>();
  const language = new Map<number, number>();
  let total = 0;
  combos.forEach((c, k) => {
    let n = 0;
    for (const g of regions) for (const v of g.culture[k] ?? []) n += v;
    ethnic.set(c.ethnic, (ethnic.get(c.ethnic) ?? 0) + n);
    religion.set(c.religion, (religion.get(c.religion) ?? 0) + n);
    language.set(c.language, (language.get(c.language) ?? 0) + n);
    total += n;
  });
  return { ethnic, religion, language, total };
}

/** Chance that two random people fall in different groups. */
export function fractionalization(groups: ReadonlyMap<number, number>, total: number): number {
  if (total <= 0) return 0;
  let sum = 0;
  for (const n of [...groups.values()].sort((a, b) => a - b)) sum += (n / total) * (n / total);
  return 1 - sum;
}

/** Largest group's share (0–1). */
export function largestShare(groups: ReadonlyMap<number, number>, total: number): number {
  return total > 0 ? Math.max(0, ...groups.values()) / total : 0;
}

/** Share of people with no religion (0–1). */
export function noReligionShare(c: Composition): number {
  return c.total > 0 ? (c.religion.get(NO_RELIGION) ?? 0) / c.total : 0;
}
