// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Model life tables (DESIGN.md §4.1). Mortality follows a Siler hazard,
 *   μ(x) = juvenile·e^(−J·x) + background + senescent·e^(S·x),
 * with fixed slopes J and S. The juvenile term is set from infant mortality; background
 * and senescent terms scale together until life expectancy matches. The simulation uses
 * each 5-year band's average hazard, and life expectancy is computed from those same band
 * rates, so the calibrated value is exactly what the simulation produces.
 */

import { detExp, detLog } from '../random/detmath.ts';
import { AGE_BANDS, BAND_YEARS, bandStart } from './grid.ts';

export interface MortalityParams {
  readonly juvenile: number;
  readonly background: number;
  readonly senescent: number;
}

/** Decay of juvenile mortality per year of age. */
export const JUVENILE_DECAY = 1.3;
/** Gompertz slope of adult mortality per year of age. */
export const SENESCENT_SLOPE = 0.095;
const BASE_BACKGROUND = 0.0015;
const BASE_SENESCENT = 2.2e-5;

/** Average hazard over each age band (per person-year). */
export function bandRates(p: MortalityParams): number[] {
  return Array.from({ length: AGE_BANDS }, (_, a) => {
    const x0 = bandStart(a);
    const x1 = x0 + BAND_YEARS;
    const juvenile =
      (p.juvenile * (detExp(-JUVENILE_DECAY * x0) - detExp(-JUVENILE_DECAY * x1))) /
      (JUVENILE_DECAY * BAND_YEARS);
    const senescent =
      (p.senescent * (detExp(SENESCENT_SLOPE * x1) - detExp(SENESCENT_SLOPE * x0))) /
      (SENESCENT_SLOPE * BAND_YEARS);
    return juvenile + p.background + senescent;
  });
}

/** Person-years lived in each band by a radix of 1 (the open band's is l/m). */
export function personYears(rates: readonly number[]): number[] {
  let l = 1;
  return rates.map((m, a) => {
    if (a === rates.length - 1) return m > 0 ? l / m : 0;
    const survive = detExp(-BAND_YEARS * m);
    const lived = m > 0 ? (l * (1 - survive)) / m : BAND_YEARS * l;
    l *= survive;
    return lived;
  });
}

/** Life expectancy at birth from band rates. */
export function lifeExpectancy(rates: readonly number[]): number {
  return personYears(rates).reduce((sum, years) => sum + years, 0);
}

/** Deaths before age 1 per 1,000 births under the continuous hazard. */
export function infantMortality(p: MortalityParams): number {
  const cumulative =
    (p.juvenile * (1 - detExp(-JUVENILE_DECAY))) / JUVENILE_DECAY +
    p.background +
    (p.senescent * (detExp(SENESCENT_SLOPE) - 1)) / SENESCENT_SLOPE;
  return 1000 * (1 - detExp(-cumulative));
}

function paramsAt(scale: number, infantHazard: number): MortalityParams {
  const background = BASE_BACKGROUND * scale;
  const senescent = BASE_SENESCENT * scale;
  const otherFirstYear = background + (senescent * (detExp(SENESCENT_SLOPE) - 1)) / SENESCENT_SLOPE;
  const juvenile =
    (Math.max(0, infantHazard - otherFirstYear) * JUVENILE_DECAY) / (1 - detExp(-JUVENILE_DECAY));
  return { juvenile, background, senescent };
}

/**
 * Parameters with the given life expectancy at birth (years) and infant mortality (per
 * 1,000 births). Inconsistent targets are met as closely as the model allows: life
 * expectancy takes priority over infant mortality.
 */
export function calibrateMortality(lifeExpectancyTarget: number, imr: number): MortalityParams {
  const q0 = Math.max(0.0005, Math.min(0.3, imr / 1000));
  const infantHazard = -detLog(1 - q0);
  const e0 = (scale: number) => lifeExpectancy(bandRates(paramsAt(scale, infantHazard)));
  // e0 falls as the scale rises; bisect geometrically.
  let lo = 1e-3;
  let hi = 1e3;
  for (let i = 0; i < 80; i++) {
    const mid = Math.sqrt(lo * hi);
    if (e0(mid) > lifeExpectancyTarget) lo = mid;
    else hi = mid;
  }
  let params = paramsAt(Math.sqrt(lo * hi), infantHazard);
  // Very high infant mortality with high life expectancy: scale the juvenile term down.
  if (Math.abs(lifeExpectancy(bandRates(params)) - lifeExpectancyTarget) > 0.05) {
    let jlo = 0;
    let jhi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (jlo + jhi) / 2;
      const p = { ...params, juvenile: params.juvenile * mid };
      if (lifeExpectancy(bandRates(p)) > lifeExpectancyTarget) jlo = mid;
      else jhi = mid;
    }
    params = { ...params, juvenile: params.juvenile * jlo };
  }
  return params;
}

/**
 * Splits a both-sexes life expectancy into female and male values. The female advantage
 * grows with life expectancy (about 3.6 years at 60 and 4.8 at 80).
 */
export function lifeExpectancyBySex(
  both: number,
  sexRatioAtBirth: number,
): { female: number; male: number } {
  const gap = Math.max(2, Math.min(7, 3 + 0.06 * (both - 50)));
  const male = both - gap / (1 + sexRatioAtBirth);
  return { female: male + gap, male };
}
