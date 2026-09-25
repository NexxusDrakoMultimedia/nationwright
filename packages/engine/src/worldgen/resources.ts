// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Resource deposits (DESIGN.md §4.12.2, deferred from M1 to M3). Each land cell holds at
 * most one deposit. Every commodity has a clustered noise field masked by where it forms:
 * hydrocarbons in lowland and coastal basins, coal in temperate interiors, ores and
 * precious metals in high ground. Thresholds give each commodity a fixed share of land
 * cells; richness grows with how far a cell clears its threshold.
 */

import type { RandomStream } from '../random/stream.ts';
import type { CellGrid } from './grid.ts';
import { FractalNoise } from './noise.ts';
import { BIOME, type Terrain } from './terrain.ts';

export const COMMODITIES = ['oil', 'gas', 'coal', 'ores', 'precious metals'] as const;
export type Commodity = (typeof COMMODITIES)[number];

/** Share of land cells holding each commodity (tuned, not from data). */
export const DEPOSIT_COVERAGE: readonly number[] = [0.035, 0.03, 0.035, 0.045, 0.025];

export interface Resources {
  /** 0 = none; otherwise 1 + commodity index. */
  readonly kind: Uint8Array;
  /** Deposit richness, 0.2–1.2 (0 where there is none). */
  readonly richness: Float32Array;
}

/** How suitable a land cell is for each commodity (0–1). */
function suitability(terrain: Terrain, i: number): number[] {
  const height = terrain.elevation[i] as number;
  const biome = terrain.biome[i] as number;
  const low = height < 0.25 ? 1 : height < 0.45 ? 0.4 : 0;
  const high = height > 0.35 ? Math.min(1, (height - 0.35) / 0.3 + 0.3) : 0;
  const basin =
    biome === BIOME.desert ||
    biome === BIOME.grassland ||
    biome === BIOME.tundra ||
    biome === BIOME.wetlands
      ? 1
      : 0.6;
  const temperate =
    biome === BIOME['temperate forest'] ||
    biome === BIOME['boreal forest'] ||
    biome === BIOME.grassland
      ? 1
      : 0.3;
  const coast = terrain.coastal[i] === 1 ? 1.2 : 1;
  const mountains = biome === BIOME.mountains ? 1 : 0.5;
  return [
    low * basin * coast,
    low * basin * coast,
    (height > 0.1 && height < 0.5 ? 1 : 0.2) * temperate,
    high * mountains,
    // Precious metals also form in hills (veins in older, eroded ranges).
    Math.max(high * mountains, height > 0.2 ? 0.5 : 0),
  ];
}

export function generateResources(
  grid: CellGrid,
  terrain: Terrain,
  stream: RandomStream,
): Resources {
  const n = grid.count;
  // Many smaller clusters: deposits spread over more countries, as in reality.
  const fields = COMMODITIES.map(() => new FractalNoise(24, 12, 3, stream));
  const scores = COMMODITIES.map(() => new Float64Array(n).fill(-Infinity));
  const landCells: number[] = [];
  for (let i = 0; i < n; i++) {
    if (terrain.land[i] !== 1) continue;
    landCells.push(i);
    const u = (grid.x[i] as number) / grid.width;
    const v = (grid.y[i] as number) / grid.height;
    const suit = suitability(terrain, i);
    COMMODITIES.forEach((_, c) => {
      const s = suit[c] as number;
      (scores[c] as Float64Array)[i] =
        s > 0 ? ((fields[c] as FractalNoise).value(u, v) + 1) * s : -Infinity;
    });
  }

  // Per-commodity thresholds hitting the target coverage among land cells.
  const thresholds = COMMODITIES.map((_, c) => {
    const values = landCells
      .map((i) => (scores[c] as Float64Array)[i] as number)
      .filter(Number.isFinite)
      .sort((a, b) => b - a);
    const k = Math.floor((DEPOSIT_COVERAGE[c] as number) * landCells.length);
    return {
      cut: values[Math.min(values.length - 1, Math.max(0, k))] ?? Infinity,
      top: values[0] ?? 0,
    };
  });

  const kind = new Uint8Array(n);
  const richness = new Float32Array(n);
  for (const i of landCells) {
    let best = -1;
    let bestMargin = 0;
    COMMODITIES.forEach((_, c) => {
      const { cut, top } = thresholds[c] as { cut: number; top: number };
      const score = (scores[c] as Float64Array)[i] as number;
      if (!(score > cut) || top <= cut) return;
      const margin = (score - cut) / (top - cut);
      if (margin > bestMargin) {
        bestMargin = margin;
        best = c;
      }
    });
    if (best >= 0) {
      kind[i] = best + 1;
      richness[i] = 0.2 + bestMargin;
    }
  }
  return { kind, richness };
}

/** Deposit richness per commodity for each country (sums over its cells). */
export function endowments(resources: Resources, owner: Int32Array, countries: number): number[][] {
  const out = Array.from({ length: countries }, () => COMMODITIES.map(() => 0));
  for (let i = 0; i < owner.length; i++) {
    const k = owner[i] as number;
    const c = (resources.kind[i] as number) - 1;
    if (k < 0 || c < 0) continue;
    const row = out[k] as number[];
    row[c] = (row[c] as number) + (resources.richness[i] as number);
  }
  return out;
}
