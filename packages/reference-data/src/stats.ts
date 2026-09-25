// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import type { ShareItem } from './text.ts';

/** Quantile with linear interpolation between order statistics (R type 7). */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) throw new RangeError('quantile of an empty list');
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const a = sorted[lower] as number;
  const b = sorted[upper] as number;
  return a + (b - a) * (position - lower);
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

/**
 * Fractionalization 1 − Σ sᵢ² over listed shares. Unlisted remainder is treated as one
 * more group. Returns null when the listed shares cover less than 80% (too incomplete).
 */
export function fractionalization(items: readonly ShareItem[]): number | null {
  const shares = items.map((i) => i.share).filter((s): s is number => s !== null && s > 0);
  const listed = shares.reduce((a, b) => a + b, 0);
  if (listed < 80 || listed > 102) return null;
  const all = listed < 100 ? [...shares, 100 - listed] : shares;
  const total = all.reduce((a, b) => a + b, 0);
  return 1 - all.reduce((acc, s) => acc + (s / total) ** 2, 0);
}
