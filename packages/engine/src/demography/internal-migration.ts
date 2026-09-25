// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Internal migration between regions (DESIGN.md §4.1), gravity-style: the flow from region
 * r to q grows with both populations, falls with distance, and leans toward the more
 * attractive region; young adults and the educated move most. Until the economy exists (M3), attractiveness comes from the
 * caller (urban share and the capital, plus modifiers). All flows are computed from the
 * start-of-month state, so the order of regions doesn't matter.
 */

import { detExp, detLog } from '../random/detmath.ts';
import { cellIndex, CELLS_PER_REGION, forEachCell, RURAL, URBAN } from './grid.ts';
import type { RegionGrid } from './culture.ts';
import { DEMOGRAPHY_TUNING as T } from './tuning.ts';

export interface InternalMigration {
  /**
   * Yearly share of a region's people who would move if every other region were next
   * door, equally attractive, and held everyone else; real flows are smaller.
   */
  readonly rate: number;
  /** Attractiveness of each region (positive; only ratios matter). */
  readonly attractiveness: readonly number[];
  /** Distance between the regions' seats, km. */
  readonly distances: readonly (readonly number[])[];
}

/**
 * Distance decay relative to the country's own scale: weight 1/2 at the
 * population-weighted mean distance between its regions, so large and small countries
 * have similar mobility (people in big countries still move between regions).
 */
export function distanceWeight(km: number, typical: number): number {
  const r = typical > 0 ? km / typical : 0;
  return 1 / (1 + r * r);
}

function typicalDistance(
  populations: readonly number[],
  distances: readonly (readonly number[])[],
): number {
  let sum = 0;
  let weight = 0;
  populations.forEach((a, r) =>
    populations.forEach((b, q) => {
      if (q === r) return;
      sum += a * b * ((distances[r] as number[])[q] as number);
      weight += a * b;
    }),
  );
  return weight > 0 ? sum / weight : 0;
}

export interface InternalFlows {
  /** Each region's net change this month. */
  readonly net: number[];
  /** People who moved to another region this month. */
  readonly movers: number;
}

/** Moves people between regions. */
export function migrateInternally(regions: RegionGrid[], m: InternalMigration): InternalFlows {
  const n = regions.length;
  const net = new Array<number>(n).fill(0);
  let movers = 0;
  if (n < 2 || m.rate <= 0) return { net, movers };
  const populations = regions.map((g) => g.cohorts.reduce((s, v) => s + v, 0));
  const total = populations.reduce((s, v) => s + v, 0);
  if (total <= 0) return { net, movers };
  // Symmetric gravity: F[r][q] = rate · P_r · (P_q / total) · decay(d) · (A_q / A_r)^pull.
  // Equal attractiveness gives zero net flows, and no region's gross outflow exceeds
  // `rate` times the strongest pull, however large its neighbours are.
  const typical = typicalDistance(populations, m.distances);
  const gravity = regions.map((_, r) =>
    regions.map((__, q) =>
      q === r
        ? 0
        : m.rate *
          (populations[r] as number) *
          ((populations[q] as number) / total) *
          distanceWeight((m.distances[r] as number[])[q] as number, typical) *
          detExp(
            T.internalMigrationPull *
              detLog(
                (m.attractiveness[q] as number) / Math.max(1e-9, m.attractiveness[r] as number),
              ),
          ),
    ),
  );
  const outflow = gravity.map((row) => row.reduce((t, v) => t + v, 0));
  const destinations = gravity.map((row) => {
    const sum = row.reduce((t, v) => t + v, 0);
    return row.map((v) => (sum > 0 ? v / sum : 0));
  });
  const urbanArrival = regions.map((g, q) => {
    let urban = 0;
    forEachCell((s, _a, _x, _e, i) => {
      if (s === URBAN) urban += g.cohorts[i] as number;
    });
    const u = (populations[q] as number) > 0 ? urban / (populations[q] as number) : 0;
    const pref = T.immigrantUrbanPreference;
    return (pref * u) / (pref * u + (1 - u));
  });

  const incoming = regions.map((g) =>
    g.culture.map(() => new Array<number>(CELLS_PER_REGION).fill(0)),
  );
  const leaving = regions.map(() => new Array<number>(CELLS_PER_REGION).fill(0));

  regions.forEach((g, r) => {
    const population = populations[r] as number;
    if (population <= 0) return;
    let weighted = 0;
    forEachCell((_s, a, _x, e, i) => {
      weighted +=
        (g.cohorts[i] as number) *
        (T.urbanMigrationByAge[a] as number) *
        (T.internalMigrationByEducation[e] as number);
    });
    if (weighted <= 0) return;
    const perWeight = (outflow[r] as number) / 12 / weighted;
    forEachCell((_s, a, x, e, i) => {
      const fraction = Math.min(
        0.2,
        perWeight *
          (T.urbanMigrationByAge[a] as number) *
          (T.internalMigrationByEducation[e] as number),
      );
      if (fraction <= 0) return;
      (leaving[r] as number[])[i] = fraction;
      const dest = destinations[r] as number[];
      for (let q = 0; q < n; q++) {
        const share = fraction * (dest[q] as number);
        if (share <= 0) continue;
        const pu = urbanArrival[q] as number;
        const toUrban = cellIndex(URBAN, a, x, e);
        const toRural = cellIndex(RURAL, a, x, e);
        g.culture.forEach((layer, k) => {
          const moved = (layer[i] as number) * share;
          const inc = (incoming[q] as number[][])[k] as number[];
          inc[toUrban] = (inc[toUrban] as number) + moved * pu;
          inc[toRural] = (inc[toRural] as number) + moved * (1 - pu);
        });
      }
    });
  });

  regions.forEach((g, r) => {
    const out = leaving[r] as number[];
    const inc = incoming[r] as number[][];
    let before = 0;
    let after = 0;
    for (let i = 0; i < CELLS_PER_REGION; i++) {
      before += g.cohorts[i] as number;
      movers += (g.cohorts[i] as number) * (out[i] as number);
      let cell = 0;
      g.culture.forEach((layer, k) => {
        const v =
          (layer[i] as number) * (1 - (out[i] as number)) + ((inc[k] as number[])[i] as number);
        layer[i] = v;
        cell += v;
      });
      g.cohorts[i] = cell;
      after += cell;
    }
    net[r] = after - before;
  });
  return { net, movers };
}
