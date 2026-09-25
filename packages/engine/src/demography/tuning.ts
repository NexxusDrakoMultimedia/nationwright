// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Demography tuning constants (DESIGN.md §4.1). They move to the content tuning files
 * once `content/` exists. Multipliers are relative: each country's rates are normalized
 * at the start so its national totals match its sampled statistics.
 */

import { AGE_BANDS } from './grid.ts';

export const DEMOGRAPHY_TUNING = {
  /** Boys per girl at birth. */
  sexRatioAtBirth: 1.05,
  /** Fertility by settlement (urban, rural) and education (none … tertiary). */
  fertilityBySettlement: [0.9, 1.2],
  fertilityByEducation: [1.35, 1.15, 0.9, 0.9, 0.75],
  /** Mortality by settlement and, from age 25, by education. */
  mortalityBySettlement: [0.95, 1.05],
  mortalityByEducation: [1.25, 1.1, 0.95, 0.95, 0.8],
  /** First age band where education affects mortality (25–29). */
  adultBand: 5,
  /**
   * Urbanization: the urban share u rises by rate·u·(1 − u) per year through
   * rural-to-urban migration (about 0.5 percentage points a year at u = 0.5).
   */
  urbanizationRate: 0.02,
  /** Relative propensity to move from rural to urban areas, by age band. */
  urbanMigrationByAge: [
    0.6, 0.5, 0.6, 1.6, 2, 1.6, 1.2, 0.9, 0.7, 0.5, 0.4, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3,
    0.3, 0.3,
  ],
  /** Age profile of international migrants (shares by band, summing to 1). */
  migrantAgeProfile: [
    0.05, 0.04, 0.04, 0.07, 0.17, 0.2, 0.15, 0.1, 0.06, 0.04, 0.03, 0.02, 0.015, 0.01, 0.005, 0, 0,
    0, 0, 0, 0,
  ],
  /** Immigrants' preference for urban over rural areas. */
  immigrantUrbanPreference: 1.5,
  /** Emigration never takes more than this share of a band in one month. */
  maxMonthlyEmigrationShare: 0.05,
  /** Years of schooling, normal around the cohort's mean with this spread. */
  schoolingSpread: 3.5,
  /** Years of schooling at which primary, secondary, and tertiary are reached. */
  schoolingThresholds: [3, 9, 14],
  /**
   * Completed years of schooling per year of school life expectancy (which counts
   * repeated and part-time years).
   */
  schoolingCompletion: 0.85,
  /** Share of secondary-level attainment that is vocational. */
  vocationalShare: 0.3,
  /** Fraction of the gap to the education target closed per month (young bands). */
  educationCatchUp: 1 / 12,
  /**
   * Share of births whose father's ethnicity differs from the mother's pool: the child's
   * ethnicity is drawn from local men aged 20–44 (urban, rural). Religion and language
   * follow the mother.
   */
  intermarriage: [0.08, 0.04],
  /** Yearly rate at which people 15+ leave their religion for none, before factors. */
  secularizationRate: 0.0015,
  secularizationByEducation: [0.3, 0.7, 1.5, 1.5, 3],
  secularizationBySettlement: [1.3, 0.7],
  /**
   * Yearly rate at which speakers of other languages switch to the nation's most spoken
   * language, before factors; scaled by (1 − their language's share in the region), so
   * concentrated communities hold on longer.
   */
  languageShiftRate: 0.006,
  languageShiftByEducation: [0.5, 1, 1.5, 1.5, 1.5],
  languageShiftBySettlement: [1.5, 0.7],
  /** Age factor for language shift: children in school shift most (bands 0–4, 5–9, …). */
  languageShiftByAge: [
    0, 1.5, 1.5, 1.5, 1.2, 1, 0.5, 0.4, 0.3, 0.3, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
    0.1,
  ],
  /** Combinations below this share of the population are folded into a neighbour yearly. */
  pruneShare: 1e-4,
  /** A birth flow creates a new combination only above this share of the population. */
  newCombinationShare: 1e-6,
} as const;

if (DEMOGRAPHY_TUNING.urbanMigrationByAge.length !== AGE_BANDS) {
  throw new Error('urbanMigrationByAge needs one value per age band.');
}
if (DEMOGRAPHY_TUNING.languageShiftByAge.length !== AGE_BANDS) {
  throw new Error('languageShiftByAge needs one value per age band.');
}
if (DEMOGRAPHY_TUNING.migrantAgeProfile.length !== AGE_BANDS) {
  throw new Error('migrantAgeProfile needs one value per age band.');
}
