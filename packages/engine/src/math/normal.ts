// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Standard normal CDF and quantile, built on deterministic log/exp so they give identical
 * results on every JavaScript engine.
 */

import { detExp, detLog } from '../random/detmath.ts';

/**
 * Complementary error function (Numerical Recipes `erfcc`, Chebyshev fit, fractional
 * error < 1.2e-7 everywhere).
 */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const poly =
    -z * z -
    1.26551223 +
    t *
      (1.00002368 +
        t *
          (0.37409196 +
            t *
              (0.09678418 +
                t *
                  (-0.18628806 +
                    t *
                      (0.27886807 +
                        t *
                          (-1.13520398 +
                            t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  const r = t * detExp(poly);
  return x >= 0 ? r : 2 - r;
}

/** Φ(x): probability that a standard normal variate is ≤ x. */
export function normalCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

// Acklam's rational approximation (relative error < 1.15e-9).
const A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
  -3.066479806614716e1, 2.506628277459239,
];
const B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
  -1.328068155288572e1,
];
const C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
  4.374664141464968, 2.938163982698783,
];
const D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

function horner(coefficients: readonly number[], x: number): number {
  let sum = 0;
  for (const c of coefficients) sum = sum * x + c;
  return sum;
}

/** Φ⁻¹(p): the standard normal quantile, for 0 < p < 1. */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    return Number.NaN;
  }
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * detLog(p));
    return horner(C, q) / (horner(D, q) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * detLog(1 - p));
    return -horner(C, q) / (horner(D, q) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (horner(A, r) * q) / (horner(B, r) * r + 1);
}
