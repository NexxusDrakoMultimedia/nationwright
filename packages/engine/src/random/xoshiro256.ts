// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * xoshiro256** 1.0 (Blackman & Vigna), implemented with 32-bit integer operations so the
 * hot path never allocates `bigint`s. Each 64-bit state word sN is stored as two
 * unsigned 32-bit halves, #sNh (high) and #sNl (low).
 */

const TWO_POW_32 = 0x1_0000_0000;
const TWO_POW_21 = 0x20_0000;
const TWO_POW_NEG_53 = 1 / 2 ** 53;
const LOW_32 = 0xffff_ffffn;

export class Xoshiro256StarStar {
  #s0h: number;
  #s0l: number;
  #s1h: number;
  #s1l: number;
  #s2h: number;
  #s2l: number;
  #s3h: number;
  #s3l: number;
  /** Output of the most recent step, as (hi, lo). */
  #outHi = 0;
  #outLo = 0;

  /** Creates a generator from four 64-bit words; they must not all be zero. */
  constructor(state: readonly [bigint, bigint, bigint, bigint]) {
    const [w0, w1, w2, w3] = state.map((word) => BigInt.asUintN(64, word)) as [
      bigint,
      bigint,
      bigint,
      bigint,
    ];
    if (w0 === 0n && w1 === 0n && w2 === 0n && w3 === 0n) {
      throw new RangeError('xoshiro256** state must not be all zero.');
    }
    this.#s0h = Number(w0 >> 32n);
    this.#s0l = Number(w0 & LOW_32);
    this.#s1h = Number(w1 >> 32n);
    this.#s1l = Number(w1 & LOW_32);
    this.#s2h = Number(w2 >> 32n);
    this.#s2l = Number(w2 & LOW_32);
    this.#s3h = Number(w3 >> 32n);
    this.#s3l = Number(w3 & LOW_32);
  }

  /** Advances one step; the 64-bit output is left in (#outHi, #outLo). */
  #step(): void {
    const s0h = this.#s0h;
    const s0l = this.#s0l;
    const s1h = this.#s1h;
    const s1l = this.#s1l;

    // result = rotl(s1 * 5, 7) * 9
    mul64(s1h, s1l, 0, 5);
    rotl64(scratchHi, scratchLo, 7);
    mul64(scratchHi, scratchLo, 0, 9);
    this.#outHi = scratchHi;
    this.#outLo = scratchLo;

    // t = s1 << 17
    const th = ((s1h << 17) | (s1l >>> 15)) >>> 0;
    const tl = (s1l << 17) >>> 0;

    const s2h = (this.#s2h ^ s0h) >>> 0; // s2 ^= s0
    const s2l = (this.#s2l ^ s0l) >>> 0;
    const s3h = (this.#s3h ^ s1h) >>> 0; // s3 ^= s1
    const s3l = (this.#s3l ^ s1l) >>> 0;
    this.#s1h = (s1h ^ s2h) >>> 0; // s1 ^= s2
    this.#s1l = (s1l ^ s2l) >>> 0;
    this.#s0h = (s0h ^ s3h) >>> 0; // s0 ^= s3
    this.#s0l = (s0l ^ s3l) >>> 0;
    this.#s2h = (s2h ^ th) >>> 0; // s2 ^= t
    this.#s2l = (s2l ^ tl) >>> 0;
    rotl64(s3h, s3l, 45); // s3 = rotl(s3, 45)
    this.#s3h = scratchHi;
    this.#s3l = scratchLo;
  }

  /** Next 64-bit output as a bigint (convenient, slower). */
  nextBigUint64(): bigint {
    this.#step();
    return (BigInt(this.#outHi) << 32n) | BigInt(this.#outLo);
  }

  /** Next 32 random bits (the high half of the 64-bit output, the strongest bits). */
  nextUint32(): number {
    this.#step();
    return this.#outHi;
  }

  /** Uniform double in [0, 1) using the top 53 bits of the output. Exact, no rounding. */
  nextFloat64(): number {
    this.#step();
    return (this.#outHi * TWO_POW_21 + (this.#outLo >>> 11)) * TWO_POW_NEG_53;
  }

  /** Uniform integer in [0, bound) for 1 ≤ bound ≤ 2^32, without modulo bias. */
  nextIntBelow(bound: number): number {
    if (!Number.isInteger(bound) || bound < 1 || bound > TWO_POW_32) {
      throw new RangeError(`bound must be an integer in [1, 2^32]; got ${bound}.`);
    }
    // Accept only draws below the largest multiple of `bound` that fits in 32 bits.
    const limit = TWO_POW_32 - (TWO_POW_32 % bound);
    for (;;) {
      const x = this.nextUint32();
      if (x < limit) return x % bound;
    }
  }

  /** Uniform integer in [min, max] (inclusive); the span must be at most 2^32. */
  nextIntBetween(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
      throw new RangeError(`need safe integers with min ≤ max; got [${min}, ${max}].`);
    }
    return min + this.nextIntBelow(max - min + 1);
  }

  /** True with probability p (p clamped to [0, 1]). */
  nextBoolean(p = 0.5): boolean {
    return this.nextFloat64() < p;
  }
}

// Scratch registers for the 64-bit helpers (single-threaded engine; no reentrancy).
let scratchHi = 0;
let scratchLo = 0;

/** (ah:al) * (bh:bl) mod 2^64 -> (scratchHi, scratchLo). */
function mul64(ah: number, al: number, bh: number, bl: number): void {
  const a0 = al & 0xffff,
    a1 = al >>> 16;
  const b0 = bl & 0xffff,
    b1 = bl >>> 16;
  const p00 = a0 * b0;
  const p01 = a0 * b1;
  const p10 = a1 * b0;
  const p11 = a1 * b1;
  const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
  scratchLo = (((mid & 0xffff) << 16) | (p00 & 0xffff)) >>> 0;
  const high =
    p11 + Math.floor(p01 / 0x1_0000) + Math.floor(p10 / 0x1_0000) + Math.floor(mid / 0x1_0000);
  scratchHi = (high + Math.imul(ah, bl) + Math.imul(al, bh)) >>> 0;
}

/** Rotate (hi:lo) left by k bits, 0 < k < 64 -> (scratchHi, scratchLo). */
function rotl64(hi: number, lo: number, k: number): void {
  if (k >= 32) {
    const t = hi;
    hi = lo;
    lo = t;
    k -= 32;
  }
  if (k === 0) {
    scratchHi = hi >>> 0;
    scratchLo = lo >>> 0;
    return;
  }
  scratchHi = ((hi << k) | (lo >>> (32 - k))) >>> 0;
  scratchLo = ((lo << k) | (hi >>> (32 - k))) >>> 0;
}
