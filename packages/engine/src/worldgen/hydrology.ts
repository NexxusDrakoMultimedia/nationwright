// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Drainage, rivers, and lakes (DESIGN.md §4.12.2 step 4): priority-flood depression
 * filling from the sea, then rainfall accumulated downstream.
 */

import { forNeighbors, type CellGrid } from './grid.ts';
import { BIOME, type Terrain } from './terrain.ts';

export interface Hydrology {
  /** Cell each land cell drains into (−1 for sea cells). */
  readonly downstream: Int32Array;
  /** Rainfall collected from upstream, in cell-moisture units. */
  readonly flow: Float32Array;
  readonly river: Uint8Array;
  readonly lake: Uint8Array;
}

/** Binary min-heap keyed by (priority, index): deterministic tie-breaking. */
class MinHeap {
  readonly #keys: number[] = [];
  readonly #items: number[] = [];

  get size(): number {
    return this.#items.length;
  }

  push(key: number, item: number): void {
    const keys = this.#keys;
    const items = this.#items;
    let i = items.length;
    keys.push(key);
    items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.#less(i, parent)) break;
      this.#swap(i, parent);
      i = parent;
    }
  }

  pop(): { key: number; item: number } {
    const keys = this.#keys;
    const items = this.#items;
    const top = { key: keys[0] as number, item: items[0] as number };
    const lastKey = keys.pop() as number;
    const lastItem = items.pop() as number;
    if (items.length > 0) {
      keys[0] = lastKey;
      items[0] = lastItem;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.#less(l, m)) m = l;
        if (r < items.length && this.#less(r, m)) m = r;
        if (m === i) break;
        this.#swap(i, m);
        i = m;
      }
    }
    return top;
  }

  #less(a: number, b: number): boolean {
    const ka = this.#keys[a] as number;
    const kb = this.#keys[b] as number;
    return ka < kb || (ka === kb && (this.#items[a] as number) < (this.#items[b] as number));
  }

  #swap(a: number, b: number): void {
    const k = this.#keys[a] as number;
    this.#keys[a] = this.#keys[b] as number;
    this.#keys[b] = k;
    const t = this.#items[a] as number;
    this.#items[a] = this.#items[b] as number;
    this.#items[b] = t;
  }
}

export { MinHeap };

export function generateHydrology(grid: CellGrid, terrain: Terrain): Hydrology {
  const n = grid.count;
  const { land, elevation, moisture } = terrain;
  const filled = new Float64Array(n);
  const downstream = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  const order: number[] = [];
  const heap = new MinHeap();
  const epsilon = 1e-5;

  for (let i = 0; i < n; i++) {
    if (land[i] === 0) {
      visited[i] = 1;
      filled[i] = 0;
      forNeighbors(grid, i, (j) => {
        if (land[j] === 1 && visited[j] === 0) {
          visited[j] = 1;
          filled[j] = elevation[j] as number;
          downstream[j] = i;
          heap.push(filled[j] as number, j);
        }
      });
    }
  }
  while (heap.size > 0) {
    const { item: i } = heap.pop();
    order.push(i);
    forNeighbors(grid, i, (j) => {
      if (visited[j] === 1) return;
      visited[j] = 1;
      filled[j] = Math.max(elevation[j] as number, (filled[i] as number) + epsilon);
      downstream[j] = i;
      heap.push(filled[j] as number, j);
    });
  }

  // Accumulate rainfall from the highest cells downwards.
  const flow = new Float32Array(n);
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k] as number;
    flow[i] = (flow[i] as number) + (moisture[i] as number);
    const d = downstream[i] as number;
    if (d >= 0 && land[d] === 1) flow[d] = (flow[d] as number) + (flow[i] as number);
  }

  // Rivers: the wettest few percent of land cells by accumulated flow.
  const landFlows = order.map((i) => flow[i] as number).sort((a, b) => a - b);
  const threshold =
    landFlows.length > 0 ? (landFlows[Math.floor(landFlows.length * 0.93)] as number) : Infinity;
  const river = new Uint8Array(n);
  const lake = new Uint8Array(n);
  for (const i of order) {
    if ((flow[i] as number) >= threshold && terrain.biome[i] !== BIOME.ice) river[i] = 1;
    if ((filled[i] as number) - (elevation[i] as number) > 0.015 && terrain.biome[i] !== BIOME.ice)
      lake[i] = 1;
  }
  return { downstream, flow, river, lake };
}
