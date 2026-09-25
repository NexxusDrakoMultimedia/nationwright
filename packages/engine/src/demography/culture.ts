// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Ethnicity × religion × language, tracked jointly (D14, DESIGN.md §4.1). A nation keeps a
 * combination table (the triples that actually occur), and each region stores people per
 * combination per cohort cell: `culture[k][cell]`, whose sum over k is the cohort count.
 * Every flow in the monthly step goes through the helpers here, so the two always agree.
 */

import { normal } from '../random/distributions.ts';
import { detExp } from '../random/detmath.ts';
import type { RandomStream } from '../random/stream.ts';
import { CELLS_PER_REGION } from './grid.ts';

/** Religion id for people with no religion. */
export const NO_RELIGION = -1;

export interface Combination {
  readonly ethnic: number;
  /** A faith id, or NO_RELIGION. */
  readonly religion: number;
  readonly language: number;
}

/** One region's grid: cohort totals plus the same people split by combination. */
export interface RegionGrid {
  cohorts: number[];
  culture: number[][];
}

/** The nation-wide combination table, shared by every region's `culture` arrays. */
export interface CultureTable {
  combos: Combination[];
  regions: RegionGrid[];
}

export function sameCombination(a: Combination, b: Combination): boolean {
  return a.ethnic === b.ethnic && a.religion === b.religion && a.language === b.language;
}

export function findCombination(table: CultureTable, c: Combination): number {
  return table.combos.findIndex((x) => sameCombination(x, c));
}

/** Appends a combination with nobody in it yet and returns its index. */
export function addCombination(table: CultureTable, c: Combination): number {
  table.combos.push({ ethnic: c.ethnic, religion: c.religion, language: c.language });
  for (const region of table.regions)
    region.culture.push(new Array<number>(CELLS_PER_REGION).fill(0));
  return table.combos.length - 1;
}

function differences(a: Combination, b: Combination): number {
  return (
    (a.ethnic === b.ethnic ? 0 : 1) +
    (a.religion === b.religion ? 0 : 1) +
    (a.language === b.language ? 0 : 1)
  );
}

/** The existing combination closest to `c` (fewest differing dimensions, then lowest index). */
export function nearestCombination(table: CultureTable, c: Combination, except = -1): number {
  let best = -1;
  let bestD = Infinity;
  table.combos.forEach((x, k) => {
    if (k === except) return;
    const d = differences(x, c);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  });
  return best;
}

/**
 * The index for `c`, creating it when `create` is true; otherwise small flows into a
 * combination that doesn't exist yet go to the nearest existing one.
 */
export function resolveCombination(table: CultureTable, c: Combination, create: boolean): number {
  const k = findCombination(table, c);
  if (k >= 0) return k;
  return create ? addCombination(table, c) : nearestCombination(table, c);
}

// Flows. Each keeps cohorts[i] = Σ_k culture[k][i].

export function scaleCell(g: RegionGrid, i: number, factor: number): void {
  g.cohorts[i] = (g.cohorts[i] as number) * factor;
  for (const layer of g.culture) layer[i] = (layer[i] as number) * factor;
}

/** Moves a fraction of cell `from` (every combination alike) into cell `to`. */
export function moveFraction(g: RegionGrid, from: number, to: number, fraction: number): number {
  if (fraction <= 0) return 0;
  const f = Math.min(1, fraction);
  const moved = (g.cohorts[from] as number) * f;
  g.cohorts[from] = (g.cohorts[from] as number) - moved;
  g.cohorts[to] = (g.cohorts[to] as number) + moved;
  for (const layer of g.culture) {
    const m = (layer[from] as number) * f;
    layer[from] = (layer[from] as number) - m;
    layer[to] = (layer[to] as number) + m;
  }
  return moved;
}

/** Moves `amount` people out of cell `from` into `to`, proportionally across combinations. */
export function moveAmount(g: RegionGrid, from: number, to: number, amount: number): number {
  const n = g.cohorts[from] as number;
  return n > 0 && amount > 0 ? moveFraction(g, from, to, amount / n) : 0;
}

/** Adds people to a cell with the given mix (amounts by combination index). */
export function addPeople(
  g: RegionGrid,
  i: number,
  byCombination: ReadonlyMap<number, number>,
): number {
  let added = 0;
  for (const [k, amount] of [...byCombination.entries()].sort((a, b) => a[0] - b[0])) {
    if (amount <= 0) continue;
    const layer = g.culture[k] as number[];
    layer[i] = (layer[i] as number) + amount;
    added += amount;
  }
  g.cohorts[i] = (g.cohorts[i] as number) + added;
  return added;
}

/** Moves a fraction of one combination within a cell to another combination. */
export function shiftCombination(
  g: RegionGrid,
  i: number,
  from: number,
  to: number,
  fraction: number,
): number {
  if (from === to || fraction <= 0) return 0;
  const src = g.culture[from] as number[];
  const dst = g.culture[to] as number[];
  const moved = (src[i] as number) * Math.min(1, fraction);
  src[i] = (src[i] as number) - moved;
  dst[i] = (dst[i] as number) + moved;
  return moved;
}

/** People per combination, nation-wide. */
export function combinationTotals(table: CultureTable): number[] {
  return table.combos.map((_, k) => {
    let n = 0;
    for (const region of table.regions) for (const v of region.culture[k] as number[]) n += v;
    return n;
  });
}

/**
 * Folds combinations below `minShare` of the population into their nearest neighbour and
 * removes them, then resets cohort totals to the combination sums (clearing rounding drift).
 */
export function pruneCombinations(table: CultureTable, minShare: number): void {
  const totals = combinationTotals(table);
  const all = totals.reduce((s, n) => s + n, 0);
  // Smallest first, so a small group can absorb an even smaller one before being folded.
  const order = totals
    .map((n, k) => ({ n, k }))
    .filter((e) => e.n < minShare * all)
    .sort((a, b) => a.n - b.n || a.k - b.k);
  const removed = new Set<number>();
  for (const { k } of order) {
    if (table.combos.length - removed.size <= 1) break;
    let target = -1;
    let bestD = Infinity;
    table.combos.forEach((x, j) => {
      if (j === k || removed.has(j)) return;
      const d = differences(x, table.combos[k] as Combination);
      if (d < bestD) {
        bestD = d;
        target = j;
      }
    });
    if (target < 0) continue;
    for (const region of table.regions) {
      const src = region.culture[k] as number[];
      const dst = region.culture[target] as number[];
      for (let i = 0; i < CELLS_PER_REGION; i++) dst[i] = (dst[i] as number) + (src[i] as number);
    }
    removed.add(k);
  }
  if (removed.size > 0) {
    const keep = table.combos.map((_, k) => !removed.has(k));
    table.combos.splice(0, table.combos.length, ...table.combos.filter((_, k) => keep[k]));
    for (const region of table.regions) {
      region.culture.splice(0, region.culture.length, ...region.culture.filter((_, k) => keep[k]));
    }
  }
  for (const region of table.regions) {
    for (let i = 0; i < CELLS_PER_REGION; i++) {
      let n = 0;
      for (const layer of region.culture) n += layer[i] as number;
      region.cohorts[i] = n;
    }
  }
}

/**
 * Regional people per combination: national shares, with each combination concentrated
 * in some regions (random log-normal weights; the largest combination is spread more
 * evenly), balanced by iterative proportional fitting so regional populations and
 * national shares both hold exactly.
 */
export function regionalMix(
  regionPopulations: readonly number[],
  nationalShares: readonly number[],
  stream: RandomStream,
): number[][] {
  const total = regionPopulations.reduce((s, n) => s + n, 0);
  const largest = nationalShares.indexOf(Math.max(...nationalShares));
  const m = regionPopulations.map((p) =>
    nationalShares.map(
      (share, k) => p * share * detExp((k === largest ? 0.3 : 1) * normal(stream)),
    ),
  );
  for (let iter = 0; iter < 200; iter++) {
    m.forEach((row, r) => {
      const sum = row.reduce((s, n) => s + n, 0);
      const target = regionPopulations[r] as number;
      if (sum > 0) row.forEach((v, k) => (row[k] = (v * target) / sum));
    });
    nationalShares.forEach((share, k) => {
      const sum = m.reduce((s, row) => s + (row[k] as number), 0);
      if (sum > 0) m.forEach((row) => (row[k] = ((row[k] as number) * share * total) / sum));
    });
  }
  return m;
}
