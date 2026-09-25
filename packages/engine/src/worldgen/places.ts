// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Provinces, population density, and cities (DESIGN.md §4.12.2 steps 8–9).
 */

import { detLog } from '../random/detmath.ts';
import { forNeighbors, type CellGrid } from './grid.ts';
import type { Hydrology } from './hydrology.ts';
import type { Terrain } from './terrain.ts';

/** Cells of each country, in ascending order. */
export function cellsByCountry(owner: Int32Array, countries: number): number[][] {
  const lists: number[][] = Array.from({ length: countries }, () => []);
  owner.forEach((k, i) => {
    if (k >= 0) (lists[k] as number[]).push(i);
  });
  return lists;
}

/** Provinces: farthest-point seeds from the capital, then flood fill within the country. */
export function assignProvinces(
  grid: CellGrid,
  owner: Int32Array,
  cells: readonly (readonly number[])[],
  capitals: readonly number[],
): { province: Int32Array; provinceCounts: number[] } {
  const province = new Int32Array(grid.count).fill(-1);
  const provinceCounts: number[] = [];
  const hops = new Int32Array(grid.count).fill(-1);
  let nextId = 0;

  cells.forEach((list, k) => {
    const count = Math.max(
      1,
      Math.min(8, 1 + Math.round(detLog(Math.max(1, list.length / 12)) / Math.LN2)),
    );
    const seeds: number[] = [capitals[k] as number];
    const bfs = (sources: readonly number[]) => {
      for (const c of list) hops[c] = -1;
      const queue = [...sources];
      for (const s of sources) hops[s] = 0;
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head] as number;
        forNeighbors(grid, i, (j) => {
          if (owner[j] === k && hops[j] === -1) {
            hops[j] = (hops[i] as number) + 1;
            queue.push(j);
          }
        });
      }
    };
    while (seeds.length < Math.min(count, list.length)) {
      bfs(seeds);
      let far = -1;
      let farHops = -1;
      for (const c of list) {
        const h = hops[c] as number;
        // Unreached cells (exclaves) count as far away, so they get their own province.
        const d = h === -1 ? 1_000_000 : h;
        if (d > farHops) {
          farHops = d;
          far = c;
        }
      }
      if (far < 0 || farHops === 0) break;
      seeds.push(far);
    }
    // Flood fill from the seeds; exclaves go to the seed nearest as the crow flies.
    const base = nextId;
    const queue: number[] = [];
    seeds.forEach((s, p) => {
      province[s] = base + p;
      queue.push(s);
    });
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head] as number;
      forNeighbors(grid, i, (j) => {
        if (owner[j] === k && province[j] === -1) {
          province[j] = province[i] as number;
          queue.push(j);
        }
      });
    }
    for (const c of list) {
      if (province[c] !== -1) continue;
      let best = 0;
      let bestD = Infinity;
      seeds.forEach((s, p) => {
        const dx = Math.abs((grid.x[s] as number) - (grid.x[c] as number));
        const wx = Math.min(dx, grid.width - dx);
        const dy = (grid.y[s] as number) - (grid.y[c] as number);
        const d = wx * wx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      });
      province[c] = base + best;
    }
    provinceCounts.push(seeds.length);
    nextId += seeds.length;
  });
  return { province, provinceCounts };
}

/** Spreads each country's population over its cells in proportion to habitability². */
export function distributePopulation(
  owner: Int32Array,
  cells: readonly (readonly number[])[],
  habitability: Float32Array,
  populations: readonly number[],
): Float64Array {
  const population = new Float64Array(owner.length);
  cells.forEach((list, k) => {
    const weights = list.map((c) => {
      const h = (habitability[c] as number) + 0.01;
      return h * h;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    list.forEach((c, t) => {
      population[c] = ((populations[k] as number) * (weights[t] as number)) / total;
    });
  });
  return population;
}

export interface City {
  readonly id: number;
  readonly country: number;
  readonly cell: number;
  readonly population: number;
  readonly capital: boolean;
  readonly coastal: boolean;
  readonly river: boolean;
}

/**
 * Cities: the capital plus the best-located other cells (population, coast, river), at
 * least two cells apart, with rank-size (Zipf) populations summing to most of the urban
 * population.
 */
export function placeCities(
  grid: CellGrid,
  terrain: Terrain,
  hydrology: Hydrology,
  cells: readonly (readonly number[])[],
  capitals: readonly number[],
  cellPopulation: Float64Array,
  urbanPopulation: readonly number[],
): City[] {
  const cities: City[] = [];
  cells.forEach((list, k) => {
    const urban = urbanPopulation[k] as number;
    const wanted = Math.max(
      1,
      Math.min(30, Math.round(1 + 2.2 * (detLog(Math.max(1e4, urban) / 1e4) / Math.LN10))),
    );
    const score = (c: number) =>
      (cellPopulation[c] as number) *
      (1 + 0.5 * (terrain.coastal[c] as number) + 0.5 * (hydrology.river[c] as number));
    const ranked = [...list].sort((a, b) => score(b) - score(a) || a - b);
    const chosen: number[] = [capitals[k] as number];
    const blocked = new Set<number>([capitals[k] as number]);
    forNeighbors(grid, capitals[k] as number, (j) => blocked.add(j));
    for (const c of ranked) {
      if (chosen.length >= wanted) break;
      if (blocked.has(c)) continue;
      chosen.push(c);
      blocked.add(c);
      forNeighbors(grid, c, (j) => blocked.add(j));
    }
    // Zipf: the r-th city has 1/r of the largest; together they hold 85% of urban people.
    const harmonic = chosen.reduce((s, _, r) => s + 1 / (r + 1), 0);
    chosen.forEach((cell, r) => {
      cities.push({
        id: cities.length,
        country: k,
        cell,
        population: Math.round((0.85 * urban) / harmonic / (r + 1)),
        capital: r === 0,
        coastal: terrain.coastal[cell] === 1,
        river: hydrology.river[cell] === 1,
      });
    });
  });
  return cities;
}
