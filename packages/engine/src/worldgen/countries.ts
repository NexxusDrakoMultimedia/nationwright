// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Countries (DESIGN.md §4.12.2 step 6, §4.12.3):
 *  1. habitability per cell and landmasses;
 *  2. capitals, spread out and weighted toward habitable land;
 *  3. provisional regions (nearest capital) give a neighbour graph, used to choose
 *     archetypes with the real-world neighbour similarity, then sample each nation;
 *  4. territorial growth toward each nation's sampled area, where mountains and rivers
 *     are expensive to cross and so tend to become borders.
 */

import { detLog } from '../random/detmath.ts';
import type { RandomStream } from '../random/stream.ts';
import { forNeighbors, cellDistance, type CellGrid } from './grid.ts';
import { MinHeap, type Hydrology } from './hydrology.ts';
import {
  chooseArchetype,
  sampleNation,
  type NationSample,
  type PreparedModel,
} from './nation-stats.ts';
import { BIOME, type Terrain } from './terrain.ts';

export function computeHabitability(
  grid: CellGrid,
  terrain: Terrain,
  hydrology: Hydrology,
): Float32Array {
  const n = grid.count;
  const out = new Float32Array(n);
  const biomeFactor: Record<number, number> = {
    [BIOME.ice]: 0,
    [BIOME.tundra]: 0.12,
    [BIOME.desert]: 0.18,
    [BIOME.mountains]: 0.25,
    [BIOME['boreal forest']]: 0.45,
    [BIOME.wetlands]: 0.5,
    [BIOME['tropical forest']]: 0.7,
    [BIOME.savanna]: 0.85,
    [BIOME['temperate forest']]: 0.95,
    [BIOME.grassland]: 1,
  };
  for (let i = 0; i < n; i++) {
    if (terrain.land[i] === 0) continue;
    const t = terrain.temperature[i] as number;
    const m = terrain.moisture[i] as number;
    const temp = Math.max(0, 1 - Math.abs(t - 17) / 22);
    const wet = Math.max(0, 1 - Math.abs(m - 0.6) / 0.65);
    const flat = 1 - 0.6 * (terrain.elevation[i] as number);
    const water = 1 + 0.25 * (terrain.coastal[i] as number) + 0.3 * (hydrology.river[i] as number);
    out[i] = Math.min(
      1,
      (biomeFactor[terrain.biome[i] as number] ?? 0.5) * temp * wet * flat * water,
    );
  }
  return out;
}

/** Connected land components, numbered by descending size. */
export function findLandmasses(
  grid: CellGrid,
  land: Uint8Array,
): { id: Int32Array; sizes: number[] } {
  const n = grid.count;
  const raw = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < n; s++) {
    if (land[s] === 0 || raw[s] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [s];
    raw[s] = id;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      size++;
      forNeighbors(grid, i, (j) => {
        if (land[j] === 1 && raw[j] === -1) {
          raw[j] = id;
          stack.push(j);
        }
      });
    }
    sizes.push(size);
  }
  const order = sizes
    .map((size, id) => ({ size, id }))
    .sort((a, b) => b.size - a.size || a.id - b.id);
  const rename = new Map(order.map((e, rank) => [e.id, rank]));
  const id = raw.map((v) => (v < 0 ? -1 : (rename.get(v) as number)));
  return { id, sizes: order.map((e) => e.size) };
}

export interface Capitals {
  readonly cells: number[];
  /** True for capitals placed alone on a small island (island nations). */
  readonly island: boolean[];
}

/**
 * Picks capitals. First, `islandCount` go to separate small landmasses (island nations);
 * then the rest spread out over the remaining land, weighted toward habitable and coastal
 * cells.
 */
export function placeCapitals(
  grid: CellGrid,
  land: Uint8Array,
  coastal: Uint8Array,
  habitability: Float32Array,
  landmass: Int32Array,
  landmassSizes: readonly number[],
  count: number,
  islandCount: number,
  stream: RandomStream,
): Capitals {
  const landCells: number[] = [];
  for (let i = 0; i < grid.count; i++) if (land[i] === 1) landCells.push(i);
  const averageCells = landCells.length / count;

  // Island nations: small landmasses, each taking its most habitable cell as capital.
  const small = landmassSizes
    .map((size, id) => ({ id, size }))
    .filter((l) => l.size >= 1 && l.size <= Math.max(3, 1.5 * averageCells))
    .map((l) => ({ ...l, key: -detLog(1 - stream.nextFloat64()) / l.size }))
    .sort((a, b) => a.key - b.key || a.id - b.id)
    .slice(0, Math.min(islandCount, count - 1));
  const islandIds = new Set(small.map((l) => l.id));
  const best = new Map<number, number>();
  for (const i of landCells) {
    const lm = landmass[i] as number;
    if (!islandIds.has(lm)) continue;
    const current = best.get(lm);
    if (current === undefined || (habitability[i] as number) > (habitability[current] as number))
      best.set(lm, i);
  }
  const chosen: number[] = small.map((l) => best.get(l.id) as number);
  const island = chosen.map(() => true);
  if (landCells.length < count * 3) {
    throw new RangeError(
      `Not enough land for ${count} countries (${landCells.length} land cells); raise landFraction or cellsPerCountry.`,
    );
  }
  // Weighted random order: key = −ln(u)/w (exponential race), smallest first. Island
  // nations' landmasses are left to them.
  const keyed = landCells
    .filter((i) => !islandIds.has(landmass[i] as number))
    .map((i) => ({
      i,
      key:
        -detLog(1 - stream.nextFloat64()) /
        (((habitability[i] as number) + 0.03) * (1 + (coastal[i] as number))),
    }))
    .sort((a, b) => a.key - b.key || a.i - b.i);
  const landArea = (landCells.length * grid.width * grid.height) / grid.count;
  let radius = 0.55 * Math.sqrt(landArea / count);
  const taken = new Uint8Array(grid.count);
  for (const c of chosen) taken[c] = 1;
  while (chosen.length < count) {
    for (const { i } of keyed) {
      if (chosen.length >= count) break;
      if (taken[i] === 1) continue;
      if (chosen.every((c) => cellDistance(grid, c, i) >= radius)) {
        chosen.push(i);
        island.push(false);
        taken[i] = 1;
      }
    }
    radius *= 0.8;
    if (radius < 1e-6) throw new RangeError('Could not place every capital.');
  }
  return { cells: chosen, island };
}

/** Multi-source BFS over land: each land cell goes to the nearest capital by hops. */
function nearestCapital(grid: CellGrid, land: Uint8Array, capitals: readonly number[]): Int32Array {
  const owner = new Int32Array(grid.count).fill(-1);
  const queue: number[] = [];
  capitals.forEach((c, k) => {
    owner[c] = k;
    queue.push(c);
  });
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    forNeighbors(grid, i, (j) => {
      if (land[j] === 1 && owner[j] === -1) {
        owner[j] = owner[i] as number;
        queue.push(j);
      }
    });
  }
  // Land unreachable over land (islands without a capital): nearest capital as the crow flies.
  for (let i = 0; i < grid.count; i++) {
    if (land[i] === 1 && owner[i] === -1) {
      let best = 0;
      let bestD = Infinity;
      capitals.forEach((c, k) => {
        const d = cellDistance(grid, c, i);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      owner[i] = best;
    }
  }
  return owner;
}

export function landNeighbors(grid: CellGrid, owner: Int32Array, countries: number): number[][] {
  const sets = Array.from({ length: countries }, () => new Set<number>());
  for (let i = 0; i < grid.count; i++) {
    const a = owner[i] as number;
    if (a < 0) continue;
    forNeighbors(grid, i, (j) => {
      const b = owner[j] as number;
      if (b >= 0 && b !== a) (sets[a] as Set<number>).add(b);
    });
  }
  return sets.map((s) => [...s].sort((x, y) => x - y));
}

/**
 * Chooses archetypes breadth-first over the provisional neighbour graph (copying
 * neighbours at the real-world rate), samples one nation per archetype slot, then gives
 * the largest nations of each archetype the capitals with the most room, so small
 * countries aren't walled in by big ones.
 */
export function sampleNations(
  prepared: PreparedModel,
  neighbors: readonly (readonly number[])[],
  island: readonly boolean[],
  room: readonly number[],
  stream: RandomStream,
): NationSample[] {
  const n = neighbors.length;
  const archetype = new Int32Array(n).fill(-1);
  for (let start = 0; start < n; start++) {
    if (archetype[start] !== -1) continue;
    const queue = [start];
    archetype[start] = chooseArchetype(prepared, stream, [], island[start] as boolean);
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head] as number;
      for (const j of neighbors[i] ?? []) {
        if (archetype[j] !== -1) continue;
        const placed = (neighbors[j] ?? [])
          .filter((k) => archetype[k] !== -1)
          .map((k) => archetype[k] as number);
        archetype[j] = chooseArchetype(prepared, stream, placed, island[j] as boolean);
        queue.push(j);
      }
    }
  }
  const samples = Array.from(archetype, (a) => sampleNation(prepared, a, stream));

  // Within each archetype: largest sampled area ↔ most room.
  const result: NationSample[] = new Array<NationSample>(n);
  for (let a = 0; a < prepared.model.archetypes.length; a++) {
    const slots = [...Array(n).keys()].filter((i) => archetype[i] === a);
    const byRoom = [...slots].sort((x, y) => (room[y] as number) - (room[x] as number) || x - y);
    const byArea = slots
      .map((i) => samples[i] as NationSample)
      .sort((x, y) => (y.stats['geography.area_km2'] ?? 0) - (x.stats['geography.area_km2'] ?? 0));
    byRoom.forEach((slot, r) => (result[slot] = byArea[r] as NationSample));
  }
  return result;
}

export interface Territories {
  readonly owner: Int32Array;
  readonly provisional: Int32Array;
  readonly neighbors: number[][];
}

/**
 * Grows each country from its capital toward its target size. Entering a cell costs its
 * distance, more across mountains, deserts, ice, and rivers, so those become borders.
 * Countries compete for cells in order of cost relative to their target, which keeps
 * large and small countries growing at matching rates.
 */
export function growTerritories(
  grid: CellGrid,
  terrain: Terrain,
  hydrology: Hydrology,
  capitals: readonly number[],
  targets: readonly number[],
): Int32Array {
  const n = grid.count;
  const owner = new Int32Array(n).fill(-1);
  const size = new Int32Array(capitals.length);
  const cost = new Float64Array(n).fill(Infinity);
  const heap = new MinHeap();
  const encode = (country: number, cell: number) => cell * capitals.length + country;
  capitals.forEach((c, k) => {
    heap.push(0, encode(k, c));
  });
  const scale = capitals.map((_, k) => Math.sqrt(Math.max(1, targets[k] as number)));
  const stepCost = (from: number, to: number) => {
    let c = 1;
    const b = terrain.biome[to] as number;
    if (b === BIOME.mountains) c += 4;
    else if (b === BIOME.desert || b === BIOME.ice) c += 1.5;
    if (hydrology.river[to] === 1 && hydrology.river[from] === 0) c += 1.5;
    return c;
  };

  while (heap.size > 0) {
    const { key, item } = heap.pop();
    const k = item % capitals.length;
    const cell = (item - k) / capitals.length;
    if (owner[cell] !== -1) continue;
    if ((size[k] as number) >= (targets[k] as number)) continue;
    owner[cell] = k;
    size[k] = (size[k] as number) + 1;
    cost[cell] = key;
    forNeighbors(grid, cell, (j) => {
      if (terrain.land[j] === 0 || owner[j] !== -1) return;
      heap.push(key + stepCost(cell, j) / (scale[k] as number), encode(k, j));
    });
  }

  // Land still unclaimed (every neighbour reached its target): join the nearest owner.
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if ((owner[i] as number) >= 0) queue.push(i);
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    forNeighbors(grid, i, (j) => {
      if (terrain.land[j] === 1 && owner[j] === -1) {
        owner[j] = owner[i] as number;
        queue.push(j);
      }
    });
  }
  // Islands nobody reached: nearest capital as the crow flies.
  for (let i = 0; i < n; i++) {
    if (terrain.land[i] === 1 && owner[i] === -1) {
      let best = 0;
      let bestD = Infinity;
      capitals.forEach((c, k) => {
        const d = cellDistance(grid, c, i);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      owner[i] = best;
    }
  }
  return owner;
}

export { nearestCapital };
