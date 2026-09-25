// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Random variates built only on deterministic math (detmath.ts), so they give identical
 * results on every JavaScript engine. Each call consumes a variable but deterministic
 * number of draws from the stream.
 */

import { detExp, detLog } from './detmath.ts';
import type { RandomStream } from './stream.ts';

/** Uniform double in (0, 1): never exactly 0, safe to take the log of. */
export function uniformOpen(stream: RandomStream): number {
  for (;;) {
    const u = stream.nextFloat64();
    if (u > 0) return u;
  }
}

/** Normal variate (Marsaglia polar method; the second variate is discarded). */
export function normal(stream: RandomStream, mean = 0, sd = 1): number {
  if (!(sd >= 0)) throw new RangeError(`sd must be ≥ 0; got ${sd}.`);
  for (;;) {
    const u = 2 * stream.nextFloat64() - 1;
    const v = 2 * stream.nextFloat64() - 1;
    const s = u * u + v * v;
    if (s > 0 && s < 1) {
      return mean + sd * u * Math.sqrt((-2 * detLog(s)) / s);
    }
  }
}

/** Log-normal variate: exp(N(mu, sigma)). */
export function logNormal(stream: RandomStream, mu: number, sigma: number): number {
  return detExp(normal(stream, mu, sigma));
}

/** Exponential variate with the given rate (mean 1/rate). */
export function exponential(stream: RandomStream, rate = 1): number {
  if (!(rate > 0)) throw new RangeError(`rate must be > 0; got ${rate}.`);
  return -detLog(uniformOpen(stream)) / rate;
}

/** Poisson threshold above which the normal approximation is used. */
export const POISSON_EXACT_LIMIT = 30;

/**
 * Poisson variate. Exact (Knuth's product method) for λ < 30; above that a rounded
 * normal approximation with continuity correction, clamped at 0. The approximation's
 * error is far below what aggregate demographic models can resolve.
 */
export function poisson(stream: RandomStream, lambda: number): number {
  if (!(lambda >= 0) || !Number.isFinite(lambda)) {
    throw new RangeError(`lambda must be finite and ≥ 0; got ${lambda}.`);
  }
  if (lambda === 0) return 0;
  if (lambda < POISSON_EXACT_LIMIT) {
    const limit = detExp(-lambda);
    let k = 0;
    let product = stream.nextFloat64();
    while (product > limit) {
      k += 1;
      product *= stream.nextFloat64();
    }
    return k;
  }
  return Math.max(0, Math.floor(normal(stream, lambda, Math.sqrt(lambda)) + 0.5));
}

/** Index drawn with probability proportional to its weight. Weights must be ≥ 0. */
export function weightedIndex(stream: RandomStream, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) {
    if (!(w >= 0) || !Number.isFinite(w)) throw new RangeError(`Invalid weight ${w}.`);
    total += w;
  }
  if (!(total > 0)) throw new RangeError('At least one weight must be positive.');
  const target = stream.nextFloat64() * total;
  let cumulative = 0;
  let last = -1;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] ?? 0;
    if (w === 0) continue;
    cumulative += w;
    last = i;
    if (target < cumulative) return i;
  }
  return last; // rounding at the top end
}

/** Fisher–Yates shuffle in place; returns the same array. */
export function shuffle<T>(stream: RandomStream, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = stream.nextIntBelow(i + 1);
    const tmp = items[i] as T;
    items[i] = items[j] as T;
    items[j] = tmp;
  }
  return items;
}
