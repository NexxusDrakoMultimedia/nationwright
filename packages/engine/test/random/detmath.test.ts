// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { detExp, detLog, pow2 } from '../../src/index.ts';

/** Relative error; fine to use Math.* as the reference here (tests only). */
function relErr(actual: number, expected: number): number {
  return expected === 0 ? Math.abs(actual) : Math.abs(actual / expected - 1);
}

describe('pow2', () => {
  it('builds exact powers of two across the whole range', () => {
    expect(pow2(0)).toBe(1);
    expect(pow2(10)).toBe(1024);
    expect(pow2(-1)).toBe(0.5);
    expect(pow2(1023)).toBe(2 ** 1023);
    expect(pow2(1024)).toBe(Infinity);
    expect(pow2(-1022)).toBe(2 ** -1022);
    expect(pow2(-1074)).toBe(Number.MIN_VALUE);
  });
});

describe('detLog', () => {
  it('matches Math.log to within 4e-16 relative error', () => {
    fc.assert(
      fc.property(fc.double({ min: 1e-300, max: 1e300, noNaN: true }), (x) => {
        fc.pre(Math.abs(x - 1) > 1e-6); // log near 1 is tiny; checked absolutely below
        expect(relErr(detLog(x), Math.log(x))).toBeLessThan(4e-16);
      }),
      { numRuns: 20_000 },
    );
  });

  it('is accurate near 1, for subnormals, and at the edges', () => {
    for (const x of [1 + 1e-9, 1 - 1e-9, 1.5, 0.75]) {
      expect(Math.abs(detLog(x) - Math.log(x))).toBeLessThan(1e-16 + 4e-16 * Math.abs(Math.log(x)));
    }
    expect(relErr(detLog(Number.MIN_VALUE), Math.log(Number.MIN_VALUE))).toBeLessThan(1e-15);
    expect(detLog(1)).toBe(0);
    expect(detLog(0)).toBe(-Infinity);
    expect(detLog(Infinity)).toBe(Infinity);
    expect(detLog(-1)).toBeNaN();
    expect(detLog(Math.E)).toBeCloseTo(1, 15);
  });
});

describe('detExp', () => {
  it('matches Math.exp to within 4e-16 relative error', () => {
    fc.assert(
      fc.property(fc.double({ min: -700, max: 700, noNaN: true }), (x) => {
        expect(relErr(detExp(x), Math.exp(x))).toBeLessThan(4e-16);
      }),
      { numRuns: 20_000 },
    );
  });

  it('handles the edges', () => {
    expect(detExp(0)).toBe(1);
    expect(detExp(1000)).toBe(Infinity);
    expect(detExp(-1000)).toBe(0);
    expect(relErr(detExp(-740), Math.exp(-740))).toBeLessThan(1e-12); // subnormal result
    expect(detExp(Number.NaN)).toBeNaN();
  });

  it('inverts detLog', () => {
    for (const x of [1e-10, 0.3, 1, 7, 12345.678]) {
      expect(relErr(detExp(detLog(x)), x)).toBeLessThan(2e-15);
    }
  });

  // Golden values: these exact bits must never change, or worlds change across versions.
  it('produces pinned bit patterns', () => {
    expect([detLog(2), detLog(10), detExp(1), detExp(-2.5)]).toMatchInlineSnapshot(`
      [
        0.6931471805599453,
        2.302585092994046,
        2.7182818284590455,
        0.0820849986238988,
      ]
    `);
  });
});
