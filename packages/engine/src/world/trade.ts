// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Bilateral trade (DESIGN.md §4.3, §4.10.2): a gravity model over every pair of
 * countries, flow(i→j) = e_i · m_j · Y_i · Y_j / (Y_world · distance_ij) ·
 * competitiveness_i. Dividing by world GDP keeps openness stable when every economy grows
 * alike. The exporter and importer propensities e and m are fitted at the start
 * (iterative proportional fitting) so every country's exports and imports equal its
 * statistics; afterwards flows follow nominal GDP and price competitiveness (a real
 * appreciation makes a country's exports dearer). Values are nominal, in the reference
 * currency.
 */

import { detExp, detLog } from '../random/detmath.ts';

export const TRADE_TUNING = {
  /** Exports fall by this elasticity with the exporter's real appreciation. */
  priceElasticity: 0.5,
  /** Distance elasticity of trade. */
  distanceElasticity: 1,
} as const;

export interface TradeModel {
  /** Exporter and importer propensities, fitted at the start. */
  readonly exporter: number[];
  readonly importer: number[];
  /** Each country's starting price level (for competitiveness). */
  readonly startPriceLevel: number[];
  /** World GDP at the start (reference currency). */
  readonly startWorldGdp: number;
}

export interface TradeInputs {
  /** Nominal GDP, reference currency. */
  readonly gdp: readonly number[];
  readonly priceLevel: readonly number[];
  readonly distances: readonly (readonly number[])[];
}

function gravity(inputs: TradeInputs): number[][] {
  const n = inputs.gdp.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i === j) return 0;
      const d = Math.max(100, (inputs.distances[i] as number[])[j] as number);
      const decay = detExp(-TRADE_TUNING.distanceElasticity * detLog(d));
      return (inputs.gdp[i] as number) * (inputs.gdp[j] as number) * decay;
    }),
  );
}

/**
 * Fits propensities so exports and imports match `exports` and `imports` (reference
 * currency). The world's totals must balance, so both targets are scaled to their mean.
 */
export function fitTrade(
  inputs: TradeInputs,
  exports: readonly number[],
  imports: readonly number[],
): TradeModel {
  const n = inputs.gdp.length;
  const base = gravity(inputs);
  const totalX = exports.reduce((a, b) => a + b, 0);
  const totalM = imports.reduce((a, b) => a + b, 0);
  const world = (totalX + totalM) / 2;
  const x = exports.map((v) => (totalX > 0 ? (v * world) / totalX : 0));
  const m = imports.map((v) => (totalM > 0 ? (v * world) / totalM : 0));
  const e = new Array<number>(n).fill(1);
  const f = new Array<number>(n).fill(1);
  for (let iter = 0; iter < 200; iter++) {
    for (let i = 0; i < n; i++) {
      let row = 0;
      for (let j = 0; j < n; j++) row += ((base[i] as number[])[j] as number) * (f[j] as number);
      e[i] = row > 0 ? (x[i] as number) / row : 0;
    }
    for (let j = 0; j < n; j++) {
      let col = 0;
      for (let i = 0; i < n; i++) col += ((base[i] as number[])[j] as number) * (e[i] as number);
      f[j] = col > 0 ? (m[j] as number) / col : 0;
    }
  }
  return {
    exporter: e,
    importer: f,
    startPriceLevel: [...inputs.priceLevel],
    startWorldGdp: inputs.gdp.reduce((a, b) => a + b, 0),
  };
}

/** Current bilateral flows: flows[i][j] = exports from i to j (reference currency). */
export function tradeFlows(model: TradeModel, inputs: TradeInputs): number[][] {
  const base = gravity(inputs);
  const worldGdp = inputs.gdp.reduce((a, b) => a + b, 0);
  const scale = worldGdp > 0 ? model.startWorldGdp / worldGdp : 1;
  const competitiveness = inputs.priceLevel.map((p, i) => {
    const start = model.startPriceLevel[i] as number;
    return start > 0 && p > 0 ? detExp(-TRADE_TUNING.priceElasticity * detLog(p / start)) : 1;
  });
  return base.map((row, i) =>
    row.map(
      (v, j) =>
        v *
        (model.exporter[i] as number) *
        (model.importer[j] as number) *
        (competitiveness[i] as number) *
        scale,
    ),
  );
}

export function exportsOf(flows: readonly (readonly number[])[], i: number): number {
  return (flows[i] as number[]).reduce((a, b) => a + b, 0);
}

export function importsOf(flows: readonly (readonly number[])[], j: number): number {
  return flows.reduce((sum, row) => sum + (row[j] as number), 0);
}
