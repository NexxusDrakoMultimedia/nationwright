// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The cell grid (DESIGN.md §4.12.2 step 1): a jittered hexagonal lattice of sites on a
 * plane that wraps east–west, with Delaunay adjacency.
 *
 * Determinism audit of d3-delaunay 6 / delaunator 5 (the only code used here is the
 * triangulation and `neighbors`): basic arithmetic plus Math.abs/floor/ceil/sqrt/max and
 * Math.pow(2, −52), an exact power of two. d3's Math.sin/cos jitter only runs for
 * collinear input, which a jittered lattice never is; `find` (Math.pow) is not used.
 */

import { Delaunay } from 'd3-delaunay';
import type { RandomStream } from '../random/stream.ts';

export interface CellGrid {
  readonly width: number;
  readonly height: number;
  readonly count: number;
  /** Site coordinates in km; x ∈ [0, width), y ∈ [0, height]. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** CSR adjacency: neighbours of i are neighbors[offsets[i] .. offsets[i+1]). */
  readonly offsets: Uint32Array;
  readonly neighbors: Uint32Array;
  /** Typical distance between neighbouring sites, km. */
  readonly spacing: number;
}

const JITTER = 0.35;

export function generateGrid(
  targetCount: number,
  width: number,
  height: number,
  stream: RandomStream,
): CellGrid {
  const dx0 = Math.sqrt((width * height) / (targetCount * (Math.sqrt(3) / 2)));
  const cols = Math.max(8, Math.round(width / dx0));
  const dx = width / cols;
  const rows = Math.max(4, Math.round(height / (dx * (Math.sqrt(3) / 2))));
  const dy = height / rows;
  const count = cols * rows;
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const jx = (stream.nextFloat64() * 2 - 1) * JITTER;
      const jy = (stream.nextFloat64() * 2 - 1) * JITTER;
      let px = (c + 0.5 * (r % 2) + 0.5 + jx) * dx;
      if (px >= width) px -= width;
      if (px < 0) px += width;
      x[i] = px;
      y[i] = (r + 0.5 + jy) * dy;
    }
  }

  // Ghost copies near the seam make the triangulation wrap east–west.
  const margin = 3 * dx;
  const points: number[] = [];
  const owner: number[] = [];
  for (let i = 0; i < count; i++) {
    points.push(x[i] as number, y[i] as number);
    owner.push(i);
  }
  for (let i = 0; i < count; i++) {
    const px = x[i] as number;
    if (px < margin) {
      points.push(px + width, y[i] as number);
      owner.push(i);
    } else if (px > width - margin) {
      points.push(px - width, y[i] as number);
      owner.push(i);
    }
  }
  const delaunay = new Delaunay(Float64Array.from(points));
  const sets: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  for (let p = 0; p < owner.length; p++) {
    const i = owner[p] as number;
    for (const q of delaunay.neighbors(p)) {
      const j = owner[q] as number;
      if (j !== i) {
        (sets[i] as Set<number>).add(j);
        (sets[j] as Set<number>).add(i);
      }
    }
  }
  const offsets = new Uint32Array(count + 1);
  const lists = sets.map((s) => [...s].sort((a, b) => a - b));
  for (let i = 0; i < count; i++)
    offsets[i + 1] = (offsets[i] as number) + (lists[i] as number[]).length;
  const neighbors = new Uint32Array(offsets[count] as number);
  lists.forEach((list, i) => neighbors.set(list, offsets[i] as number));
  return { width, height, count, x, y, offsets, neighbors, spacing: dx };
}

/** Calls fn for each neighbour of cell i. */
export function forNeighbors(grid: CellGrid, i: number, fn: (j: number) => void): void {
  const end = grid.offsets[i + 1] as number;
  for (let k = grid.offsets[i] as number; k < end; k++) fn(grid.neighbors[k] as number);
}

/** Distance in km between two points, wrapping east–west. */
export function wrappedDistance(
  grid: CellGrid,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  let dx = Math.abs(ax - bx);
  if (dx > grid.width / 2) dx = grid.width - dx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

export function cellDistance(grid: CellGrid, a: number, b: number): number {
  return wrappedDistance(
    grid,
    grid.x[a] as number,
    grid.y[a] as number,
    grid.x[b] as number,
    grid.y[b] as number,
  );
}
