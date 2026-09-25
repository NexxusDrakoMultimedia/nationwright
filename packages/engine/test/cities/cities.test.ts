// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { describe, expect, it } from 'vitest';
import {
  baseAttractiveness,
  CITY_TUNING,
  driftShares,
  initialShares,
  zipfExponent,
} from '../../src/index.ts';

describe('cities', () => {
  it('start as shares of their region’s urban population, capped', () => {
    const shares = initialShares([400, 100, 900, 300], [0, 0, 1, 1], [1000, 1000]);
    expect(shares[0]).toBeCloseTo(0.4, 12);
    expect(shares[1]).toBeCloseTo(0.1, 12);
    // Region 1's cities (1,200 people) exceed its urban population: scaled to the cap.
    expect(shares[2]! + shares[3]!).toBeCloseTo(CITY_TUNING.maxShareOfUrban, 12);
    expect(shares[2]! / shares[3]!).toBeCloseTo(3, 12);
  });

  it('drift toward attractive cities without changing a region’s total', () => {
    const shares = [0.3, 0.3, 0.5];
    const regionOf = [0, 0, 1];
    for (let m = 0; m < 120; m++) driftShares(shares, regionOf, [1.3, 1, 1], 2);
    expect(shares[0]! + shares[1]!).toBeCloseTo(0.6, 12);
    expect(shares[0]!).toBeGreaterThan(shares[1]!);
    expect(shares[2]).toBe(0.5);
  });

  it('rate the capital, coasts, and rivers', () => {
    expect(baseAttractiveness({ capital: true, coastal: false, river: false })).toBe(
      CITY_TUNING.capital,
    );
    expect(baseAttractiveness({ capital: false, coastal: true, river: true })).toBeCloseTo(
      CITY_TUNING.coastal * CITY_TUNING.river,
      12,
    );
  });

  it('measure a rank-size exponent of 1 for a perfect Zipf system', () => {
    const sizes = Array.from({ length: 30 }, (_, i) => 1e6 / (i + 1));
    expect(zipfExponent(sizes)).toBeCloseTo(1, 9);
    expect(zipfExponent([5, 3])).toBe(0);
  });
});
