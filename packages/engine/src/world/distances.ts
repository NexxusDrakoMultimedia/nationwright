// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Sea lanes and transport distances between countries (DESIGN.md §4.12.2 step 10). Each
 * country has a port: the coastal cell nearest its capital over land (landlocked
 * countries reach the sea through their neighbours). Shipping distances are shortest
 * paths over ocean cells between ports. The effective distance between two countries is
 * the cheaper of shipping (with the overland legs to the ports) and, on the same
 * landmass, overland transport.
 */

import { cellDistance, forNeighbors } from '../worldgen/grid.ts';
import type { GeneratedWorld } from '../worldgen/generate.ts';
import { MinHeap } from '../worldgen/hydrology.ts';

export const DISTANCE_TUNING = {
  /** Overland routes are this much longer than the straight line. */
  overlandDetour: 1.3,
  /** Overland transport costs this much more per km than shipping. */
  overlandCost: 2,
} as const;

export interface TradeGeography {
  /** Port cell of each country. */
  readonly ports: number[];
  /** Overland distance from each capital to its port, km. */
  readonly inland: number[];
  /** Whether the port is on the country's own coast. */
  readonly ownCoast: boolean[];
  /** Effective transport distance between countries, km (0 on the diagonal). */
  readonly distances: number[][];
}

/** Nearest coastal land cell to `start` over land, by path length. */
function nearestCoast(world: GeneratedWorld, start: number): { cell: number; km: number } {
  const { grid, terrain } = world.map;
  const dist = new Map<number, number>([[start, 0]]);
  const heap = new MinHeap();
  heap.push(0, start);
  while (heap.size > 0) {
    const { key, item } = heap.pop();
    if (key > (dist.get(item) ?? Infinity)) continue;
    if (terrain.coastal[item] === 1) return { cell: item, km: key };
    forNeighbors(grid, item, (j) => {
      if (terrain.land[j] !== 1) return;
      const d = key + cellDistance(grid, item, j);
      if (d < (dist.get(j) ?? Infinity)) {
        dist.set(j, d);
        heap.push(d, j);
      }
    });
  }
  return { cell: start, km: 0 };
}

/** Shipping distances from one port to every port (Infinity if unreachable). */
function shippingFrom(world: GeneratedWorld, source: number, ports: readonly number[]): number[] {
  const { grid, terrain } = world.map;
  const isPort = new Map<number, number[]>();
  ports.forEach((p, k) => isPort.set(p, [...(isPort.get(p) ?? []), k]));
  const out = ports.map(() => Infinity);
  let remaining = ports.length;
  const dist = new Float64Array(grid.count).fill(Infinity);
  dist[source] = 0;
  const heap = new MinHeap();
  heap.push(0, source);
  while (heap.size > 0 && remaining > 0) {
    const { key, item } = heap.pop();
    if (key > (dist[item] as number)) continue;
    const here = isPort.get(item);
    if (here !== undefined) {
      for (const k of here) {
        if (out[k] === Infinity) {
          out[k] = key;
          remaining--;
        }
      }
      // Ports are land: ships only leave from the source port.
      if (item !== source) continue;
    }
    forNeighbors(grid, item, (j) => {
      if (terrain.land[j] === 1 && !isPort.has(j)) return;
      const d = key + cellDistance(grid, item, j);
      if (d < (dist[j] as number)) {
        dist[j] = d;
        heap.push(d, j);
      }
    });
  }
  return out;
}

export function tradeGeography(world: GeneratedWorld): TradeGeography {
  const { grid, landmass } = world.map;
  const countries = world.countries;
  const coasts = countries.map((c) => nearestCoast(world, c.capitalCell));
  const ports = coasts.map((c) => c.cell);
  const inland = coasts.map((c) => c.km);
  const owner = world.map.owner;
  const ownCoast = countries.map((c, k) => owner[ports[k] as number] === c.id);
  const shipping = ports.map((p) => shippingFrom(world, p, ports));
  const T = DISTANCE_TUNING;
  const distances = countries.map((a, i) =>
    countries.map((b, j) => {
      if (i === j) return 0;
      const sea =
        T.overlandCost * ((inland[i] as number) + (inland[j] as number)) +
        ((shipping[i] as number[])[j] as number);
      const sameLand = landmass[a.capitalCell] === landmass[b.capitalCell];
      const overland = sameLand
        ? T.overlandCost * T.overlandDetour * cellDistance(grid, a.capitalCell, b.capitalCell)
        : Infinity;
      const best = Math.min(sea, overland);
      // Unreachable pairs (enclosed seas): fall back to a long overland-and-sea route.
      return Math.round(
        Number.isFinite(best)
          ? best
          : T.overlandCost * T.overlandDetour * cellDistance(grid, a.capitalCell, b.capitalCell),
      );
    }),
  );
  return { ports, inland: inland.map(Math.round), ownCoast, distances };
}
