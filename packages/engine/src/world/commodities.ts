// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Commodity markets and resource rents (DESIGN.md §4.3, §4.10). World prices move yearly
 * (mean-reverting in logs, with occasional spikes). A country's rents are its deposits ×
 * unit values × prices, depleting slowly; unit values are set so world rents are a fixed
 * share of world GDP at the start. Price swings are terms-of-trade shocks: they change
 * nominal income, government royalties, and demand, not the volume of output.
 */

import { normal } from '../random/distributions.ts';
import { detExp } from '../random/detmath.ts';
import type { RandomStream } from '../random/stream.ts';
import { COMMODITIES } from '../worldgen/resources.ts';

export const COMMODITY_TUNING = {
  /** Yearly persistence of log prices and their shock size, per commodity. */
  persistence: [0.8, 0.8, 0.85, 0.85, 0.9],
  volatility: [0.25, 0.22, 0.15, 0.2, 0.12],
  /** Chance of a price spike each year, and its size (log points). */
  spikeChance: 0.05,
  spikeSize: 0.5,
  /** World resource rents as a share of world GDP at the start, split by commodity. */
  worldRentShare: 0.025,
  rentWeights: [0.45, 0.2, 0.1, 0.18, 0.07],
  /** Yearly depletion of every deposit. */
  depletion: 0.01,
  /** Share of rents the government collects as royalties and taxes. */
  royaltyShare: 0.4,
  /**
   * A country's rent share of GDP at the start saturates toward this value: a raw share x
   * becomes x / (1 + x / saturation), so small economies with large deposits stay
   * plausible.
   */
  rentSaturation: 0.5,
} as const;

const C = COMMODITY_TUNING;

export interface CommodityMarket {
  /** Log price index per commodity (0 at the start). */
  logPrices: number[];
  /** Reference-currency value per unit of richness per year, at start prices. */
  readonly unitValues: number[];
  /** Remaining share of every deposit. */
  remaining: number;
  /** World price level of the reference currency (1 at the start). */
  worldPrices: number;
}

/** Unit values so each commodity's world rents are its weight × worldRentShare × world GDP. */
export function createMarket(
  endowments: readonly (readonly number[])[],
  worldGdp: number,
): CommodityMarket {
  const unitValues = COMMODITIES.map((_, c) => {
    const total = endowments.reduce((s, row) => s + (row[c] as number), 0);
    return total > 0 ? ((C.rentWeights[c] as number) * C.worldRentShare * worldGdp) / total : 0;
  });
  return { logPrices: COMMODITIES.map(() => 0), unitValues, remaining: 1, worldPrices: 1 };
}

/** One year of prices, depletion, and world inflation. */
export function stepMarket(
  market: CommodityMarket,
  stream: RandomStream,
  worldInflation: number,
): void {
  market.logPrices = market.logPrices.map((p, c) => {
    const spike = stream.nextFloat64() < C.spikeChance ? C.spikeSize : 0;
    return (C.persistence[c] as number) * p + (C.volatility[c] as number) * normal(stream) + spike;
  });
  market.remaining *= 1 - C.depletion;
  market.worldPrices *= 1 + worldInflation / 100;
}

export function prices(market: CommodityMarket): number[] {
  return market.logPrices.map((p) => detExp(p));
}

/** A country's rents this year, reference currency (nominal). */
export function rents(market: CommodityMarket, endowment: readonly number[]): number {
  const p = prices(market);
  let total = 0;
  COMMODITIES.forEach((_, c) => {
    total += (endowment[c] as number) * (market.unitValues[c] as number) * (p[c] as number);
  });
  return total * market.remaining * market.worldPrices;
}

/**
 * Real rent index: current rents over rents at the start, in start-year prices (1 at the
 * start; follows commodity prices and depletion).
 */
export function rentIndex(market: CommodityMarket, endowment: readonly number[]): number {
  let base = 0;
  COMMODITIES.forEach((_, c) => {
    base += (endowment[c] as number) * (market.unitValues[c] as number);
  });
  return base > 0 ? rents(market, endowment) / market.worldPrices / base : 1;
}

/** Scales an endowment so its starting rent share of GDP saturates (see rentSaturation). */
export function capEndowment(
  market: CommodityMarket,
  endowment: readonly number[],
  gdp: number,
): number[] {
  const value = rents(market, endowment);
  if (value <= 0 || gdp <= 0) return [...endowment];
  const raw = value / gdp;
  const target = raw / (1 + raw / C.rentSaturation);
  return endowment.map((e) => (e * target) / raw);
}
