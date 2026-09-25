// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Cities (DESIGN.md §4.2). A city's population is a share of its region's urban
 * population, so cities grow with the region's urban growth (births, urbanization,
 * migration). Shares drift toward more attractive cities; whatever the named cities
 * don't hold is smaller towns.
 */

import { detLog } from '../random/detmath.ts';

export interface CityShare {
  /** Share of the region's urban population living in this city. */
  share: number;
}

export const CITY_TUNING = {
  /** Attractiveness factors (multiplied). */
  capital: 1.3,
  coastal: 1.05,
  river: 1.03,
  /** Yearly share growth per unit of attractiveness above the region's average. */
  drift: 0.02,
  /** Named cities never hold more than this share of a region's urban population. */
  maxShareOfUrban: 0.95,
} as const;

export interface CityTraits {
  readonly capital: boolean;
  readonly coastal: boolean;
  readonly river: boolean;
}

export function baseAttractiveness(t: CityTraits): number {
  return (
    (t.capital ? CITY_TUNING.capital : 1) *
    (t.coastal ? CITY_TUNING.coastal : 1) *
    (t.river ? CITY_TUNING.river : 1)
  );
}

/**
 * Starting shares: each city's generated population over its region's urban population,
 * scaled down if the named cities would exceed `maxShareOfUrban`.
 */
export function initialShares(
  cityPopulations: readonly number[],
  regionOf: readonly number[],
  urbanByRegion: readonly number[],
): number[] {
  const shares = cityPopulations.map((p, c) => {
    const u = urbanByRegion[regionOf[c] as number] as number;
    return u > 0 ? p / u : 0;
  });
  const sums = urbanByRegion.map(() => 0);
  shares.forEach(
    (s, c) => (sums[regionOf[c] as number] = (sums[regionOf[c] as number] as number) + s),
  );
  return shares.map((s, c) => {
    const sum = sums[regionOf[c] as number] as number;
    return sum > CITY_TUNING.maxShareOfUrban ? (s * CITY_TUNING.maxShareOfUrban) / sum : s;
  });
}

/**
 * One month of drift: each city's share grows by drift × (attractiveness − regional
 * mean) per year, then the region's named-city total is restored, so drift moves people
 * between cities, not into them.
 */
export function driftShares(
  shares: number[],
  regionOf: readonly number[],
  attractiveness: readonly number[],
  regions: number,
): void {
  for (let r = 0; r < regions; r++) {
    const members = shares.map((_, c) => c).filter((c) => regionOf[c] === r);
    if (members.length < 2) continue;
    const total = members.reduce((s, c) => s + (shares[c] as number), 0);
    if (total <= 0) continue;
    const mean =
      members.reduce((s, c) => s + (shares[c] as number) * (attractiveness[c] as number), 0) /
      total;
    for (const c of members) {
      const growth = (CITY_TUNING.drift * ((attractiveness[c] as number) - mean)) / 12;
      shares[c] = Math.max(0, (shares[c] as number) * (1 + growth));
    }
    const after = members.reduce((s, c) => s + (shares[c] as number), 0);
    if (after > 0) for (const c of members) shares[c] = ((shares[c] as number) * total) / after;
  }
}

/**
 * Rank-size (Zipf) exponent: minus the slope of log(size) on log(rank), by least squares.
 * Close to 1 for real urban systems.
 */
export function zipfExponent(populations: readonly number[]): number {
  const sizes = populations.filter((p) => p > 0).sort((a, b) => b - a);
  if (sizes.length < 3) return 0;
  const xs = sizes.map((_, i) => detLog(i + 1));
  const ys = sizes.map((s) => detLog(s));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * ((ys[i] as number) - my);
    sxx += (x - mx) * (x - mx);
  });
  return sxx > 0 ? -sxy / sxx : 0;
}
