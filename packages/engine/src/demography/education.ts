// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Educational attainment by age (DESIGN.md §4.1). A cohort's years of schooling are
 * normal around a mean; thresholds turn years into levels. Young bands are still in
 * school, so their targets are partial; adults keep what they reached.
 */

import { normalCdf } from '../math/normal.ts';
import { bandStart, BAND_YEARS, EDUCATION_LEVELS } from './grid.ts';
import { DEMOGRAPHY_TUNING as T } from './tuning.ts';

/** Shares by level (none … tertiary) for completed schooling around `meanYears`. */
export function attainment(meanYears: number): number[] {
  const mean = Math.max(0, meanYears);
  const below = (years: number) => normalCdf((years - mean) / T.schoolingSpread);
  const [primary, secondary, tertiary] = T.schoolingThresholds;
  const none = below(primary);
  const primaryOnly = below(secondary) - none;
  const secondaryLevel = below(tertiary) - below(secondary);
  return [
    none,
    primaryOnly,
    secondaryLevel * (1 - T.vocationalShare),
    secondaryLevel * T.vocationalShare,
    1 - below(tertiary),
  ];
}

/**
 * Target attainment for an age band, given today's expected years of schooling. With a
 * positive `gradient`, cohorts older than 30 have `gradient` fewer years per decade of
 * age (older generations had less schooling). Bands up to 25–29 still follow today's
 * schooling, which is what the monthly progression targets (gradient 0), so the starting
 * population has no catch-up jump.
 */
export function educationTarget(age: number, schoolingYears: number, gradient = 0): number[] {
  const v = T.vocationalShare;
  const s = Math.max(0, schoolingYears);
  if (age === 0) return [1, 0, 0, 0, 0];
  if (age === 1) {
    const enrolled = Math.min(1, s / 10) * 0.8;
    return [1 - enrolled, enrolled, 0, 0, 0];
  }
  if (age === 2) {
    const primary = Math.min(1, s / 8);
    const secondary = Math.min(primary, Math.max(0, Math.min(1, (s - 8) / 8)) * 0.3);
    return [1 - primary, primary - secondary, secondary * (1 - v), secondary * v, 0];
  }
  const mid = bandStart(age) + BAND_YEARS / 2;
  const d = attainment(s * T.schoolingCompletion - (gradient * Math.max(0, mid - 30)) / 10);
  const [none, primary, secondary, vocational, tertiary] = d as [
    number,
    number,
    number,
    number,
    number,
  ];
  // 15–19: nobody has finished tertiary yet; 20–24: about half have.
  const finished = age === 3 ? 0 : age === 4 ? 0.5 : 1;
  const pending = tertiary * (1 - finished);
  return [
    none,
    primary,
    secondary + pending * (1 - v),
    vocational + pending * v,
    tertiary * finished,
  ];
}

if (EDUCATION_LEVELS.length !== 5) throw new Error('educationTarget assumes five levels.');
