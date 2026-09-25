// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Elevation, climate, and biomes (DESIGN.md §4.12.2 steps 2–3).
 */

import { detExp } from '../random/detmath.ts';
import type { RandomStream } from '../random/stream.ts';
import { forNeighbors, wrappedDistance, type CellGrid } from './grid.ts';
import { FractalNoise, PeriodicNoise } from './noise.ts';

export const BIOMES = [
  'ocean',
  'ice',
  'tundra',
  'boreal forest',
  'temperate forest',
  'grassland',
  'desert',
  'savanna',
  'tropical forest',
  'mountains',
  'wetlands',
] as const;
export type Biome = (typeof BIOMES)[number];
export const BIOME: Readonly<Record<Biome, number>> = Object.fromEntries(
  BIOMES.map((b, i) => [b, i]),
) as Record<Biome, number>;

export interface Terrain {
  /** Normalised elevation: land in (0, 1], sea in [−1, 0]. */
  readonly elevation: Float32Array;
  readonly land: Uint8Array;
  /** Mean annual temperature, °C. */
  readonly temperature: Float32Array;
  /** Wetness, 0–1. */
  readonly moisture: Float32Array;
  readonly biome: Uint8Array;
  /** Land cells touching the ocean. */
  readonly coastal: Uint8Array;
  /** Hops from the nearest ocean cell (0 at sea). */
  readonly oceanDistance: Uint16Array;
}

export interface TerrainOptions {
  readonly landFraction: number;
  readonly climateBias: number;
}

/** 0 at the equator, 1 at the poles. */
export function latitudeOf(grid: CellGrid, i: number): number {
  return Math.abs((grid.y[i] as number) / grid.height - 0.5) * 2;
}

/**
 * @param islandSeeds number of small archipelago blobs to add (island nations need
 *   islands; the real share of island states is about 20%).
 */
export function generateElevation(
  grid: CellGrid,
  landFraction: number,
  islandSeeds: number,
  stream: RandomStream,
): { elevation: Float32Array; land: Uint8Array } {
  const n = grid.count;
  const detail = new FractalNoise(4, 2, 5, stream);
  const ridges = new PeriodicNoise(12, 6, stream);

  // Continent cores: a few large blobs so land clusters into continents and islands.
  const cores = 6 + stream.nextIntBelow(7);
  const centres = Array.from({ length: cores }, () => ({
    x: stream.nextFloat64() * grid.width,
    y: (0.15 + 0.7 * stream.nextFloat64()) * grid.height,
    r:
      Math.sqrt((landFraction * grid.width * grid.height) / (cores * Math.PI)) *
      (0.6 + 0.8 * stream.nextFloat64()),
    weight: 0.6,
  }));
  // Archipelagos: small blobs a few cells across.
  for (let k = 0; k < islandSeeds; k++) {
    centres.push({
      x: stream.nextFloat64() * grid.width,
      y: (0.1 + 0.8 * stream.nextFloat64()) * grid.height,
      r: grid.spacing * (1.2 + 3 * stream.nextFloat64()),
      weight: 0.75,
    });
  }

  // Where land is: warped distance to continent and island cores, plus coastline noise.
  const warpX = new FractalNoise(6, 3, 3, stream);
  const warpY = new FractalNoise(6, 3, 3, stream);
  const raw = new Float64Array(n);
  const ridgeValue = new Float64Array(n);
  const detailValue = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u = (grid.x[i] as number) / grid.width;
    const v = (grid.y[i] as number) / grid.height;
    const px = (grid.x[i] as number) + 0.09 * grid.width * warpX.value(u, v);
    const py = (grid.y[i] as number) + 0.09 * grid.height * warpY.value(u, v);
    let mask = 0;
    for (const c of centres) {
      const d = wrappedDistance(grid, px, py, c.x, c.y) / c.r;
      mask = Math.max(mask, c.weight * Math.max(0, 1 - d * d));
    }
    const lat = latitudeOf(grid, i);
    const polar = Math.max(0, (lat - 0.82) / 0.18);
    detailValue[i] = detail.value(u, v);
    const r = 1 - Math.abs(ridges.value(u, v));
    ridgeValue[i] = r * r;
    raw[i] = mask + 0.55 * (detailValue[i] as number) - 0.3 * polar;
  }

  // Sea level: exactly the requested share of cells is land.
  const sorted = Float64Array.from(raw).sort();
  const seaIndex = Math.min(n - 1, Math.max(0, Math.round((1 - landFraction) * n)));
  const sea = sorted[seaIndex] as number;
  const top = sorted[n - 1] as number;
  const bottom = sorted[0] as number;
  const land = new Uint8Array(n);
  for (let i = 0; i < n; i++) if ((raw[i] as number) >= sea) land[i] = 1;

  // Altitude is separate from "land-ness": mountain ridges, rolling detail, and a gentle
  // rise inland. It's ranked among land cells and curved (p⁴) so high ground is rare.
  const landCells: number[] = [];
  const altitude = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (land[i] === 0) continue;
    landCells.push(i);
    const inland = ((raw[i] as number) - sea) / Math.max(1e-9, top - sea);
    altitude[i] =
      0.55 * (ridgeValue[i] as number) +
      0.25 * (((detailValue[i] as number) + 1) / 2) +
      0.2 * inland;
  }
  landCells.sort((a, b) => (altitude[a] as number) - (altitude[b] as number) || a - b);
  const elevation = new Float32Array(n);
  landCells.forEach((i, rank) => {
    const p = (rank + 1) / landCells.length;
    elevation[i] = Math.max(1e-4, p * p * p * p);
  });
  for (let i = 0; i < n; i++) {
    if (land[i] === 0) elevation[i] = ((raw[i] as number) - sea) / Math.max(1e-9, sea - bottom);
  }
  return { elevation, land };
}

/** Breadth-first hop distance from the ocean, and the coastal flag. */
function oceanDistances(
  grid: CellGrid,
  land: Uint8Array,
): { distance: Uint16Array; coastal: Uint8Array } {
  const n = grid.count;
  const distance = new Uint16Array(n).fill(65535);
  const coastal = new Uint8Array(n);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (land[i] === 0) {
      distance[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    forNeighbors(grid, i, (j) => {
      if (land[i] === 0 && land[j] === 1) coastal[j] = 1;
      if ((distance[j] as number) === 65535) {
        distance[j] = (distance[i] as number) + 1;
        queue.push(j);
      }
    });
  }
  return { distance, coastal };
}

/** Zonal mean temperature (°C) by latitude (0 = equator, 1 = pole), Earth-like. */
const TEMPERATURE_BY_LATITUDE: readonly (readonly [number, number])[] = [
  [0, 27],
  [0.2, 25],
  [0.33, 20],
  [0.5, 12],
  [0.67, 2],
  [0.78, -7],
  [0.89, -20],
  [1, -30],
];

/** Precipitation by latitude: wet tropics, dry subtropics, wet mid-latitudes, dry poles. */
const RAIN_BY_LATITUDE: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.12, 0.8],
  [0.28, 0.2],
  [0.45, 0.45],
  [0.6, 0.75],
  [0.78, 0.45],
  [1, 0.1],
];

function interpolate(table: readonly (readonly [number, number])[], x: number): number {
  for (let k = 1; k < table.length; k++) {
    const [x1, y1] = table[k] as readonly [number, number];
    const [x0, y0] = table[k - 1] as readonly [number, number];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return (table[table.length - 1] as readonly [number, number])[1];
}

export function generateClimate(
  grid: CellGrid,
  elevation: Float32Array,
  land: Uint8Array,
  options: TerrainOptions,
  stream: RandomStream,
): Terrain {
  const n = grid.count;
  const { distance, coastal } = oceanDistances(grid, land);
  const tempNoise = new FractalNoise(8, 4, 3, stream);
  const wetNoise = new FractalNoise(6, 3, 4, stream);
  const temperature = new Float32Array(n);
  const moisture = new Float32Array(n);
  const biome = new Uint8Array(n);
  // Moisture decays inland over about this many cells (scaled to resolution).
  const inland = Math.max(3, 1500 / grid.spacing);

  for (let i = 0; i < n; i++) {
    const lat = latitudeOf(grid, i);
    const u = (grid.x[i] as number) / grid.width;
    const v = (grid.y[i] as number) / grid.height;
    const height = land[i] === 1 ? (elevation[i] as number) : 0;
    temperature[i] =
      interpolate(TEMPERATURE_BY_LATITUDE, lat) -
      30 * height +
      3 * tempNoise.value(u, v) +
      options.climateBias;
    const continental = detExp(-(distance[i] as number) / inland);
    moisture[i] = Math.max(
      0,
      Math.min(
        1,
        0.55 * interpolate(RAIN_BY_LATITUDE, lat) + 0.3 * continental + 0.25 * wetNoise.value(u, v),
      ),
    );
    biome[i] =
      land[i] === 1
        ? classify(temperature[i] as number, moisture[i] as number, height)
        : BIOME.ocean;
  }
  return { elevation, land, temperature, moisture, biome, coastal, oceanDistance: distance };
}

export function classify(t: number, m: number, height: number): number {
  if (t < -8) return BIOME.ice;
  if (height > 0.62) return BIOME.mountains;
  if (t < 0) return BIOME.tundra;
  if (t < 8) return m > 0.4 ? BIOME['boreal forest'] : BIOME.tundra;
  if (t < 20)
    return m > 0.55 ? BIOME['temperate forest'] : m > 0.28 ? BIOME.grassland : BIOME.desert;
  return m > 0.62 ? BIOME['tropical forest'] : m > 0.32 ? BIOME.savanna : BIOME.desert;
}
