// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/** Number formatting for reports. */

export function people(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** 1.2M, 34.5k, 820. */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}

export function percent(share: number, digits = 1): string {
  return `${(100 * share).toFixed(digits)}%`;
}

/** A value in its indicator's unit, with sensible precision. */
export function statValue(id: string, value: number): string {
  if (id === 'population.total') return people(value);
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
