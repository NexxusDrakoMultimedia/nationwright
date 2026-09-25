// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Map colours. Choropleths use the validated single-hue blue ramp (light → dark = low →
 * high; reversed on dark surfaces so low values recede). Political fills are muted tints
 * chosen so neighbours differ; they carry no data, and identity always comes from labels,
 * tooltips, and the table. Physical colours are conventional cartography.
 */

export type RGB = readonly [number, number, number];

export function hex(value: string): RGB {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blue sequential ramp, steps 100 → 700 (reference palette). */
export const SEQUENTIAL = [
  '#cde2fb',
  '#9ec5f4',
  '#6da7ec',
  '#3987e5',
  '#256abf',
  '#184f95',
  '#0d366b',
].map(hex);

export function sequentialFor(dark: boolean): readonly RGB[] {
  return dark ? [...SEQUENTIAL].reverse() : SEQUENTIAL;
}

/** No-data fill: neutral gray, distinct from every ramp step. */
export const NO_DATA: RGB = hex('#b9b8b2');

/** Muted political tints; greedy graph colouring keeps neighbours apart. */
export const POLITICAL = [
  '#d9c7a3',
  '#b8cfa5',
  '#a9c4d6',
  '#d6b1b1',
  '#c7b8d9',
  '#d8d0a0',
  '#a8d0c3',
].map(hex);

/** Neutral water for the statistics layer (light and dark surfaces). */
export const WATER_NEUTRAL_LIGHT: RGB = hex('#e4e3de');
export const WATER_NEUTRAL_DARK: RGB = hex('#2b2c2e');

export const OCEAN_SHALLOW: RGB = hex('#9fc2dc');
export const OCEAN_DEEP: RGB = hex('#3f6f9a');
export const RIVER: RGB = hex('#4f86c6');
export const BORDER: RGB = hex('#3a3a36');
export const SELECTED_BORDER: RGB = hex('#b3261e');

/** Biome colours, indexed like BIOMES in the engine. */
export const BIOME_COLORS: readonly RGB[] = [
  '#3f6f9a', // ocean
  '#eef1f3', // ice
  '#b5b8a3', // tundra
  '#5f7f5c', // boreal forest
  '#6f9a5a', // temperate forest
  '#b7c77f', // grassland
  '#dcc690', // desert
  '#c6b56e', // savanna
  '#3f7d46', // tropical forest
  '#8b7d6b', // mountains
  '#6c9486', // wetlands
].map(hex);

export const BIOME_NAMES = [
  'Ocean',
  'Ice',
  'Tundra',
  'Boreal forest',
  'Temperate forest',
  'Grassland',
  'Desert',
  'Savanna',
  'Tropical forest',
  'Mountains',
  'Wetlands',
] as const;

/** Greedy colouring of the land-border graph: each country gets the first free tint. */
export function politicalColors(neighbors: readonly (readonly number[])[]): number[] {
  const color = new Array<number>(neighbors.length).fill(-1);
  const order = [...neighbors.keys()].sort(
    (a, b) => (neighbors[b]?.length ?? 0) - (neighbors[a]?.length ?? 0) || a - b,
  );
  for (const i of order) {
    const used = new Set((neighbors[i] ?? []).map((j) => color[j]));
    let c = 0;
    while (used.has(c)) c++;
    color[i] = c % POLITICAL.length;
  }
  return color;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
