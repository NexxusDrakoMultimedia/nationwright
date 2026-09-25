// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SplitMix64, Xoshiro256StarStar, fnv1a64 } from '../../src/index.ts';

const MASK_64 = (1n << 64n) - 1n;

/** Straightforward bigint xoshiro256** used as an oracle for the 32-bit version. */
function referenceXoshiro(state: readonly bigint[]): () => bigint {
  const s = state.map((w) => BigInt.asUintN(64, w));
  const rotl = (x: bigint, k: bigint) => ((x << k) | (x >> (64n - k))) & MASK_64;
  return () => {
    const [s0 = 0n, s1 = 0n, s2 = 0n, s3 = 0n] = s;
    const result = (rotl((s1 * 5n) & MASK_64, 7n) * 9n) & MASK_64;
    const t = (s1 << 17n) & MASK_64;
    const n2 = s2 ^ s0;
    const n3 = s3 ^ s1;
    s[1] = s1 ^ n2;
    s[0] = s0 ^ n3;
    s[2] = n2 ^ t;
    s[3] = rotl(n3, 45n);
    return result;
  };
}

describe('fnv1a64', () => {
  it('matches the published FNV-1a 64 test vectors', () => {
    expect(fnv1a64('')).toBe(0xcbf29ce484222325n);
    expect(fnv1a64('a')).toBe(0xaf63dc4c8601ec8cn);
    expect(fnv1a64('foobar')).toBe(0x85944171f73967e8n);
  });
});

describe('SplitMix64', () => {
  it('matches the reference output for seed 1234567', () => {
    const mixer = new SplitMix64(1234567n);
    expect([mixer.next(), mixer.next(), mixer.next(), mixer.next(), mixer.next()]).toEqual([
      6457827717110365317n,
      3203168211198807973n,
      9817491932198370423n,
      4593380528125082431n,
      16408922859458223821n,
    ]);
  });
});

describe('Xoshiro256StarStar', () => {
  it('matches the reference output for state {1, 2, 3, 4}', () => {
    const rng = new Xoshiro256StarStar([1n, 2n, 3n, 4n]);
    expect(Array.from({ length: 6 }, () => rng.nextBigUint64())).toEqual([
      11520n,
      0n,
      1509978240n,
      1215971899390074240n,
      1216172134540287360n,
      607988272756665600n,
    ]);
  });

  it('agrees with the bigint oracle on random states', () => {
    const word = fc.bigInt({ min: 0n, max: MASK_64 });
    fc.assert(
      fc.property(fc.tuple(word, word, word, word), (state) => {
        fc.pre(state.some((w) => w !== 0n));
        const fast = new Xoshiro256StarStar(state);
        const oracle = referenceXoshiro(state);
        for (let i = 0; i < 64; i++) {
          expect(fast.nextBigUint64()).toBe(oracle());
        }
      }),
      { numRuns: 300 },
    );
  });

  it('rejects the all-zero state', () => {
    expect(() => new Xoshiro256StarStar([0n, 0n, 0n, 0n])).toThrow(RangeError);
  });

  it('derives nextUint32 and nextFloat64 from the same 64-bit output', () => {
    const a = new Xoshiro256StarStar([5n, 6n, 7n, 8n]);
    const b = new Xoshiro256StarStar([5n, 6n, 7n, 8n]);
    const c = new Xoshiro256StarStar([5n, 6n, 7n, 8n]);
    for (let i = 0; i < 100; i++) {
      const full = a.nextBigUint64();
      expect(b.nextUint32()).toBe(Number(full >> 32n));
      expect(c.nextFloat64()).toBe(Number(full >> 11n) / 2 ** 53);
    }
  });

  it('keeps floats in [0, 1) and integers in range', () => {
    const rng = new Xoshiro256StarStar([9n, 8n, 7n, 6n]);
    for (let i = 0; i < 10_000; i++) {
      const f = rng.nextFloat64();
      expect(f >= 0 && f < 1).toBe(true);
      const n = rng.nextIntBelow(7);
      expect(Number.isInteger(n) && n >= 0 && n < 7).toBe(true);
      const m = rng.nextIntBetween(-3, 3);
      expect(m >= -3 && m <= 3).toBe(true);
    }
    expect(rng.nextIntBelow(1)).toBe(0);
    expect(() => rng.nextIntBelow(0)).toThrow(RangeError);
    expect(() => rng.nextIntBelow(2 ** 32 + 1)).toThrow(RangeError);
    expect(() => rng.nextIntBetween(2, 1)).toThrow(RangeError);
  });

  it('draws small ranges roughly uniformly', () => {
    const rng = new Xoshiro256StarStar([11n, 22n, 33n, 44n]);
    const counts = new Array<number>(6).fill(0);
    const draws = 60_000;
    for (let i = 0; i < draws; i++) {
      const k = rng.nextIntBelow(6);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    // Chi-square with 5 degrees of freedom; 20.5 is the p = 0.001 critical value.
    const expected = draws / 6;
    const chi2 = counts.reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(20.5);
  });
});
