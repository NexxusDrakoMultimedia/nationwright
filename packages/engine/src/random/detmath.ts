// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Deterministic elementary functions (DESIGN.md §3.3).
 *
 * ECMAScript lets engines approximate Math.log, Math.exp, Math.sin, … differently, so the
 * same seed could produce different worlds on different platforms or Electron versions.
 * These versions use only IEEE-754 basic operations (+ − × ÷, Math.sqrt, Math.round,
 * exact bit manipulation), in a fixed order, so every engine computes identical bits.
 * Accuracy is within a few ulps of the true value.
 */

const view = new DataView(new ArrayBuffer(8));

// ln 2 split so that k · LN2_HI is exact for |k| < 2^11 (fdlibm constants).
const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.442695040888963387;
const SQRT2 = 1.41421356237309514547;

/** 2^k exactly, for integer k in [-1074, 1024]. */
export function pow2(k: number): number {
  if (k > 1023) return pow2(k - 1) * 2;
  if (k < -1022) return pow2(k + 1022) * pow2(-1022);
  view.setUint32(0, ((k + 1023) << 20) >>> 0);
  view.setUint32(4, 0);
  return view.getFloat64(0);
}

/** Splits positive finite x into m · 2^k with m in [√½, √2). */
function reduce(x: number): { m: number; k: number } {
  view.setFloat64(0, x);
  const biased = (view.getUint32(0) >>> 20) & 0x7ff;
  if (biased === 0) {
    const scaled = reduce(x * pow2(54)); // subnormal: scale into the normal range
    return { m: scaled.m, k: scaled.k - 54 };
  }
  let k = biased - 1023;
  let m = x * pow2(-k); // exact: in [1, 2)
  if (m >= SQRT2) {
    m /= 2; // exact
    k += 1;
  }
  return { m, k };
}

/** Natural logarithm. */
export function detLog(x: number): number {
  if (Number.isNaN(x) || x < 0) return Number.NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  const { m, k } = reduce(x);
  // log(m) = 2·atanh(s) = 2(s + s³/3 + s⁵/5 + …), s = (m − 1)/(m + 1), |s| ≤ 0.1716.
  const s = (m - 1) / (m + 1);
  const z = s * s;
  // Horner form of 1/3 + z/5 + z²/7 + … + z¹¹/25.
  let series = 1 / 25;
  for (let n = 11; n >= 1; n--) series = 1 / (2 * n + 1) + z * series;
  const logM = 2 * s + 2 * s * z * series;
  return k * LN2_HI + (logM + k * LN2_LO);
}

/** e^x. */
export function detExp(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019412) return 0;
  const k = Math.round(x * INV_LN2);
  const r = x - k * LN2_HI - k * LN2_LO; // |r| ≤ 0.35
  // Taylor series of e^r to r^14/14!, Horner form.
  let sum = 1;
  for (let n = 14; n >= 1; n--) sum = 1 + (r * sum) / n;
  return sum * pow2(k);
}
