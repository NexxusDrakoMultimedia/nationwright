// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * International migration channels (DESIGN.md §4.1, §4.10.2): bilateral flows between the
 * player's nation and every other country, and the diaspora stocks they build. Flows lean
 * toward richer, closer countries that share a language and already hold a diaspora;
 * two scales are fitted so the starting net flow matches the nation's net migration rate
 * with a realistic gross turnover. Emigrants send remittances that follow their hosts'
 * incomes. Immigration policy and refugee surges join with politics and war (M4–M5).
 */

import { detExp, detLog } from '../random/detmath.ts';

export const MIGRATION_TUNING = {
  /** Gross migration each way at the start, beyond the net flow, per person per year. */
  baseTurnover: 0.002,
  /** Starting immigrant and emigrant stocks: base share plus years of net migration. */
  baseStockShare: 0.02,
  stockYears: 20,
  /** Elasticity of flows to the destination/origin income ratio. */
  incomeElasticity: 0.5,
  /** Network effect: flows grow by this factor per unit of diaspora share of the origin. */
  networkEffect: 20,
  /** Weight of language affinity (0–1 share of speakers of a shared language). */
  languageWeight: 3,
  /** Yearly share of a diaspora that returns home or dies. */
  diasporaAttrition: 0.02,
} as const;

const M = MIGRATION_TUNING;

export interface MigrationPartner {
  readonly population: number;
  /** GDP per person, PPP. */
  readonly income: number;
  /** Effective distance from the player, km. */
  readonly distance: number;
  /** Share (0–1) of the partner's people speaking a language common in the player's nation. */
  readonly languageAffinity: number;
}

export interface MigrationChannels {
  /** People born in each country living in the player's nation. */
  immigrants: number[];
  /** The player's emigrants living in each country. */
  emigrants: number[];
  /** Fitted scales for flows into and out of the player's nation. */
  readonly inScale: number;
  readonly outScale: number;
  /** Remittances per emigrant per unit of host income (reference currency). */
  readonly remittanceRate: number;
  /** Typical distance, km (for the distance decay). */
  readonly typicalDistance: number;
}

export interface MigrationFlows {
  /** People arriving from / leaving to each country this year. */
  readonly inflow: number[];
  readonly outflow: number[];
}

function decay(km: number, typical: number): number {
  const r = typical > 0 ? km / typical : 0;
  return 1 / (1 + r * r);
}

function pow(x: number, a: number): number {
  return x > 0 ? detExp(a * detLog(x)) : 0;
}

/** Relative pull of each partner, before scaling, for flows into (to=true) or out of the player. */
function pulls(
  partners: readonly MigrationPartner[],
  playerIncome: number,
  playerPopulation: number,
  diaspora: readonly number[],
  typical: number,
  inward: boolean,
): number[] {
  return partners.map((p, j) => {
    if (p.population <= 0) return 0;
    const incomeRatio = inward
      ? playerIncome / Math.max(1, p.income)
      : p.income / Math.max(1, playerIncome);
    const network =
      1 +
      M.networkEffect *
        ((diaspora[j] as number) / Math.max(1, inward ? p.population : playerPopulation));
    const size = inward ? p.population : 1;
    return (
      size *
      pow(incomeRatio, M.incomeElasticity) *
      decay(p.distance, typical) *
      (1 + M.languageWeight * p.languageAffinity) *
      network
    );
  });
}

/** Stocks spread over partners by the same pulls (population-weighted for emigrants). */
function spread(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (sum > 0 ? (total * w) / sum : 0));
}

/**
 * Starting channels for a nation with the given population, income, net migration rate
 * (per 1,000 per year), and remittances (share of GDP, %; GDP nominal, reference currency).
 */
export function initMigration(
  partners: readonly MigrationPartner[],
  player: {
    readonly population: number;
    readonly income: number;
    readonly netMigrationRate: number;
    readonly remittancesShare: number;
    readonly gdpNominal: number;
  },
): MigrationChannels {
  const distances = partners
    .map((p) => p.distance)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const typical = distances[Math.floor(distances.length / 2)] ?? 5000;
  const net = player.netMigrationRate / 1000;
  const zeros = partners.map(() => 0);
  const immigrantShare = M.baseStockShare + M.stockYears * Math.max(0, net);
  const emigrantShare = M.baseStockShare + M.stockYears * Math.max(0, -net);
  const inPull = pulls(partners, player.income, player.population, zeros, typical, true);
  const outPull = pulls(partners, player.income, player.population, zeros, typical, false);
  const immigrants = spread(immigrantShare * player.population, inPull);
  const emigrants = spread(
    emigrantShare * player.population,
    outPull.map((w, j) => w * (partners[j] as MigrationPartner).population),
  );

  // Fit gross flows: in − out = net · P, in + out = |net| · P + 2 · baseTurnover · P.
  const gross = Math.abs(net) * player.population + 2 * M.baseTurnover * player.population;
  const totalIn = (gross + net * player.population) / 2;
  const totalOut = (gross - net * player.population) / 2;
  const rawIn = pulls(partners, player.income, player.population, immigrants, typical, true).reduce(
    (a, b) => a + b,
    0,
  );
  const rawOut = pulls(
    partners,
    player.income,
    player.population,
    emigrants,
    typical,
    false,
  ).reduce((a, b) => a + b, 0);
  const hostIncome = emigrants.reduce(
    (s, e, j) => s + e * (partners[j] as MigrationPartner).income,
    0,
  );
  return {
    immigrants,
    emigrants,
    inScale: rawIn > 0 ? totalIn / rawIn : 0,
    outScale: rawOut > 0 ? totalOut / (rawOut * player.population) : 0,
    remittanceRate:
      hostIncome > 0 ? ((player.remittancesShare / 100) * player.gdpNominal) / hostIncome : 0,
    typicalDistance: typical,
  };
}

/** This year's flows from current incomes, populations, and diasporas. */
export function migrationFlows(
  channels: MigrationChannels,
  partners: readonly MigrationPartner[],
  player: { readonly population: number; readonly income: number },
  /** Multiplier on arrivals (immigration policy; 1 = unchanged). */
  openness = 1,
): MigrationFlows {
  const inPull = pulls(
    partners,
    player.income,
    player.population,
    channels.immigrants,
    channels.typicalDistance,
    true,
  );
  const outPull = pulls(
    partners,
    player.income,
    player.population,
    channels.emigrants,
    channels.typicalDistance,
    false,
  );
  return {
    inflow: inPull.map((w) => w * channels.inScale * openness),
    outflow: outPull.map((w) => w * channels.outScale * player.population),
  };
}

/** Updates diaspora stocks with a year's flows and attrition. */
export function stepDiaspora(channels: MigrationChannels, flows: MigrationFlows): void {
  const keep = 1 - M.diasporaAttrition;
  channels.immigrants = channels.immigrants.map((s, j) => s * keep + (flows.inflow[j] as number));
  channels.emigrants = channels.emigrants.map((s, j) => s * keep + (flows.outflow[j] as number));
}

/** Remittances received this year (reference currency). */
export function remittances(
  channels: MigrationChannels,
  partners: readonly MigrationPartner[],
): number {
  return channels.emigrants.reduce(
    (s, e, j) => s + e * (partners[j] as MigrationPartner).income * channels.remittanceRate,
    0,
  );
}
