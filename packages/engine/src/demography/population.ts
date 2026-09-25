// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The starting population of a nation (DESIGN.md §4.1): a cohort grid per region built
 * from the nation's sampled statistics. Mortality is calibrated to life expectancy and
 * infant mortality, fertility to the total fertility rate, the age structure to the
 * 0–14 and 65+ shares (a stable population, then rescaled), and education to expected
 * years of schooling and literacy.
 */

import { detExp } from '../random/detmath.ts';
import type { NationStats } from '../worldgen/nation-stats.ts';
import { educationTarget } from './education.ts';
import { fertilitySchedule } from './fertility.ts';
import {
  AGE_BANDS,
  BAND_YEARS,
  bandStart,
  emptyCohorts,
  FEMALE,
  forEachCell,
  SEXES,
} from './grid.ts';
import {
  bandRates,
  calibrateMortality,
  lifeExpectancyBySex,
  personYears,
  type MortalityParams,
} from './life-table.ts';
import { DEMOGRAPHY_TUNING as T } from './tuning.ts';

/** A nation's fixed demographic parameters (plain data, stored in the save). */
export interface DemographyModel {
  /** Female and male mortality. */
  readonly mortality: readonly [MortalityParams, MortalityParams];
  /** Baseline births per woman per year, by age band. */
  readonly fertility: readonly number[];
  /** Scales fertility per age band so the starting national rates match the baseline. */
  readonly fertilityNorm: readonly number[];
  /** Scales mortality per age band and sex (index age·2 + sex), likewise. */
  readonly mortalityNorm: readonly number[];
  /** Expected years of schooling for children starting school now. */
  readonly schoolingYears: number;
  /** Net international migrants per 1,000 people per year. */
  readonly netMigrationRate: number;
}

export interface NationPopulation {
  readonly model: DemographyModel;
  /** One cohort array per region (see grid.ts). */
  readonly regions: number[][];
}

export interface RegionSetup {
  readonly population: number;
  readonly urbanPopulation: number;
}

function stat(stats: NationStats, id: string, fallback: number): number {
  const v = stats[id];
  return v === undefined || !Number.isFinite(v) ? fallback : v;
}

export function fertilityMultiplier(settlement: number, education: number): number {
  return (
    (T.fertilityBySettlement[settlement] as number) * (T.fertilityByEducation[education] as number)
  );
}

export function mortalityMultiplier(settlement: number, age: number, education: number): number {
  const byEducation = age >= T.adultBand ? (T.mortalityByEducation[education] as number) : 1;
  return (T.mortalityBySettlement[settlement] as number) * byEducation;
}

/** Share of each band (both sexes) in a stable population growing at rate r. */
function stableShape(personYearsBySex: readonly (readonly number[])[], r: number): number[][] {
  const srb = [1, T.sexRatioAtBirth];
  const shape = Array.from({ length: AGE_BANDS }, (_, a) =>
    SEXES.map(
      (_, x) =>
        (srb[x] as number) *
        ((personYearsBySex[x] as number[])[a] as number) *
        detExp(-r * (bandStart(a) + BAND_YEARS / 2)),
    ),
  );
  const total = shape.reduce((s, band) => s + (band[0] as number) + (band[1] as number), 0);
  return shape.map((band) => band.map((v) => v / total));
}

function groupShare(shape: readonly (readonly number[])[], from: number, to: number): number {
  let s = 0;
  for (let a = from; a <= to; a++) s += (shape[a]?.[0] ?? 0) + (shape[a]?.[1] ?? 0);
  return s;
}

/**
 * Age–sex distribution (shares summing to 1) with the given 0–14 and 65+ shares, shaped
 * like a stable population under the given mortality.
 */
export function ageStructure(
  personYearsBySex: readonly (readonly number[])[],
  youngShare: number,
  oldShare: number,
): number[][] {
  let lo = -0.05;
  let hi = 0.08;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (groupShare(stableShape(personYearsBySex, mid), 0, 2) < youngShare) lo = mid;
    else hi = mid;
  }
  const shape = stableShape(personYearsBySex, (lo + hi) / 2);
  const groups: [number, number, number][] = [
    [0, 2, youngShare],
    [3, 12, 1 - youngShare - oldShare],
    [13, AGE_BANDS - 1, oldShare],
  ];
  for (const [from, to, target] of groups) {
    const current = groupShare(shape, from, to);
    const k = current > 0 ? target / current : 0;
    for (let a = from; a <= to; a++) shape[a] = (shape[a] as number[]).map((v) => v * k);
  }
  return shape;
}

/**
 * Attainment by age band. The age gradient (fewer years for older cohorts) is chosen so
 * the share of people 15+ with no schooling matches illiteracy.
 */
export function educationByAge(
  shape: readonly (readonly number[])[],
  schoolingYears: number,
  literacy: number,
): number[][] {
  const illiterate = Math.max(0, Math.min(1, 1 - literacy / 100));
  const noneShare = (gradient: number) => {
    let none = 0;
    let people = 0;
    for (let a = 3; a < AGE_BANDS; a++) {
      const n = (shape[a]?.[0] ?? 0) + (shape[a]?.[1] ?? 0);
      none += n * (educationTarget(a, schoolingYears, gradient)[0] as number);
      people += n;
    }
    return people > 0 ? none / people : 0;
  };
  let lo = 0;
  let hi = 6;
  if (noneShare(lo) >= illiterate) hi = lo;
  else if (noneShare(hi) <= illiterate) lo = hi;
  else {
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (noneShare(mid) < illiterate) lo = mid;
      else hi = mid;
    }
  }
  const gradient = (lo + hi) / 2;
  return Array.from({ length: AGE_BANDS }, (_, a) => educationTarget(a, schoolingYears, gradient));
}

export function buildPopulation(
  stats: NationStats,
  regions: readonly RegionSetup[],
): NationPopulation {
  const e0 = stat(stats, 'population.life_expectancy', 70);
  const imr = stat(stats, 'population.infant_mortality', 20);
  const tfr = stat(stats, 'population.tfr', 2.2);
  const young = stat(stats, 'population.age_0_14_share', 25) / 100;
  const old = stat(stats, 'population.age_65_plus_share', 9) / 100;
  const literacy = stat(stats, 'education.literacy', 90);
  const schoolingYears = stat(stats, 'education.school_life_expectancy', 12);
  const netMigrationRate = stat(stats, 'population.net_migration_rate', 0);

  const bySex = lifeExpectancyBySex(e0, T.sexRatioAtBirth);
  const mortality: [MortalityParams, MortalityParams] = [
    calibrateMortality(bySex.female, imr * 0.92),
    calibrateMortality(bySex.male, imr * 1.08),
  ];
  const shape = ageStructure(
    mortality.map((p) => personYears(bandRates(p))),
    young,
    old,
  );
  const education = educationByAge(shape, schoolingYears, literacy);

  const cohorts = regions.map((region) => {
    const c = emptyCohorts();
    const urban = Math.max(0, Math.min(region.population, region.urbanPopulation));
    const settlement = [urban, region.population - urban];
    forEachCell((s, a, x, e, i) => {
      c[i] =
        (settlement[s] as number) *
        ((shape[a] as number[])[x] as number) *
        ((education[a] as number[])[e] as number);
    });
    return c;
  });

  // Normalize the relative multipliers so the starting national rates are the baseline.
  const fertility = fertilitySchedule(tfr);
  const fertilityPlain = new Array<number>(AGE_BANDS).fill(0);
  const fertilityWeighted = new Array<number>(AGE_BANDS).fill(0);
  const mortalityPlain = new Array<number>(AGE_BANDS * 2).fill(0);
  const mortalityWeighted = new Array<number>(AGE_BANDS * 2).fill(0);
  for (const c of cohorts) {
    forEachCell((s, a, x, e, i) => {
      const n = c[i] as number;
      if (x === FEMALE) {
        fertilityPlain[a] = (fertilityPlain[a] as number) + n;
        fertilityWeighted[a] = (fertilityWeighted[a] as number) + n * fertilityMultiplier(s, e);
      }
      const k = a * 2 + x;
      mortalityPlain[k] = (mortalityPlain[k] as number) + n;
      mortalityWeighted[k] = (mortalityWeighted[k] as number) + n * mortalityMultiplier(s, a, e);
    });
  }
  return {
    model: {
      mortality,
      fertility,
      fertilityNorm: fertilityPlain.map((p, a) => {
        const w = fertilityWeighted[a] as number;
        return w > 0 ? p / w : 1;
      }),
      mortalityNorm: mortalityPlain.map((p, k) => {
        const w = mortalityWeighted[k] as number;
        return w > 0 ? p / w : 1;
      }),
      schoolingYears,
      netMigrationRate,
    },
    regions: cohorts,
  };
}
