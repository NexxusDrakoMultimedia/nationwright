// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Samples fictional nations' statistics from the guiding variables (DESIGN.md §4.12.3):
 * archetype → correlated normal scores → real-world marginals → consistency fixes.
 */

import { cholesky, lowerTimes, type Matrix } from '../math/linalg.ts';
import { normalCdf } from '../math/normal.ts';
import { normal, weightedIndex } from '../random/distributions.ts';
import type { RandomStream } from '../random/stream.ts';
import type { GuidingVariables } from './guiding.ts';

/** A sampled nation: every model variable by id, in the variable's real-world units. */
export type NationStats = Readonly<Record<string, number>>;

export interface NationSample {
  readonly archetype: number;
  readonly stats: NationStats;
  readonly governmentCategory: string;
  readonly ethnicGroups: number;
  readonly religions: number;
  readonly languages: number;
}

/** Precomputed pieces of a model, reused for every nation in a world. */
export interface PreparedModel {
  readonly model: GuidingVariables;
  readonly choleskyFactor: Matrix;
  /** Probability of copying a neighbour's archetype (from the observed border agreement). */
  readonly copyNeighborArchetype: number;
}

export function prepareModel(model: GuidingVariables): PreparedModel {
  const { archetypeAgreement: a, archetypeAgreementChance: c } = model.spatial;
  return {
    model,
    choleskyFactor: cholesky(model.covariance.map((row) => [...row])),
    copyNeighborArchetype: c < 1 ? Math.max(0, Math.min(1, (a - c) / (1 - c))) : 0,
  };
}

/**
 * Chooses an archetype. With probability `copyNeighborArchetype`, copy a random
 * already-placed neighbour's; otherwise draw by weight. This reproduces the real-world
 * rate at which bordering states resemble each other.
 */
export function chooseArchetype(
  prepared: PreparedModel,
  stream: RandomStream,
  neighborArchetypes: readonly number[] = [],
  island?: boolean,
): number {
  const copy = stream.nextFloat64() < prepared.copyNeighborArchetype;
  if (copy && neighborArchetypes.length > 0) {
    return neighborArchetypes[stream.nextIntBelow(neighborArchetypes.length)] as number;
  }
  // Knowing whether the country is an island shifts the odds (Bayes: weight × P(island | k)).
  return weightedIndex(
    stream,
    prepared.model.archetypes.map((a) =>
      island === undefined
        ? a.weight
        : a.weight * (island ? a.islandShare : 1 - a.islandShare) + 1e-6,
    ),
  );
}

/** Reads a percentile table at probability u ∈ [0, 1], interpolating linearly. */
export function quantileAt(quantiles: readonly number[], u: number): number {
  const position = Math.max(0, Math.min(1, u)) * (quantiles.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(quantiles.length - 1, lower + 1);
  const a = quantiles[lower] as number;
  const b = quantiles[upper] as number;
  return a + (b - a) * (position - lower);
}

export function sampleNation(
  prepared: PreparedModel,
  archetype: number,
  stream: RandomStream,
): NationSample {
  const { model, choleskyFactor } = prepared;
  const type = model.archetypes[archetype];
  if (type === undefined) throw new RangeError(`No archetype ${archetype}.`);

  const epsilon = model.variables.map(() => normal(stream));
  const offset = lowerTimes(choleskyFactor, epsilon);
  const raw: Record<string, number> = {};
  model.variables.forEach((v, j) => {
    const z = (type.mean[j] as number) + (offset[j] as number);
    raw[v.id] = quantileAt(v.quantiles, normalCdf(z));
  });

  return {
    archetype,
    stats: makeConsistent(raw),
    governmentCategory: pickCategory(type.governmentCategories, stream),
    ethnicGroups: Number(pickCategory(type.ethnicGroupCounts, stream)),
    religions: Number(pickCategory(type.religionCounts, stream)),
    languages: Number(pickCategory(type.languageCounts, stream)),
  };
}

function pickCategory(shares: Readonly<Record<string, number>>, stream: RandomStream): string {
  const entries = Object.entries(shares).sort(([a], [b]) => (a < b ? -1 : 1));
  if (entries.length === 0) throw new Error('Empty category table.');
  return (
    entries[
      weightedIndex(
        stream,
        entries.map(([, w]) => w),
      )
    ] as [string, number]
  )[0];
}

/**
 * Enforces identities the copula only approximates (DESIGN.md §4.12.3 step 4):
 * age shares sum to 100; sector shares sum to 100; population growth equals births −
 * deaths + migration; derived totals (GDP) follow from population and per-capita values.
 */
export function makeConsistent(raw: Readonly<Record<string, number>>): Record<string, number> {
  const s: Record<string, number> = { ...raw };
  const get = (id: string) => s[id] ?? 0;

  // Age structure.
  const young = Math.max(5, Math.min(60, get('population.age_0_14_share')));
  const old = Math.max(0.5, Math.min(45, get('population.age_65_plus_share')));
  const scale = young + old > 70 ? 70 / (young + old) : 1;
  s['population.age_0_14_share'] = young * scale;
  s['population.age_65_plus_share'] = old * scale;
  s['population.age_15_64_share'] = 100 - (young + old) * scale;

  // Sectors: renormalize to 100%.
  const sectors = [
    'economy.sector_agriculture',
    'economy.sector_industry',
    'economy.sector_services',
  ];
  const total = sectors.reduce((sum, id) => sum + Math.max(0, get(id)), 0);
  if (total > 0) for (const id of sectors) s[id] = (100 * Math.max(0, get(id))) / total;

  // Demographic balance (rates per 1,000 → growth in % per year).
  s['population.growth_rate'] =
    (get('population.birth_rate') -
      get('population.death_rate') +
      get('population.net_migration_rate')) /
    10;

  // Totals.
  s['population.total'] = Math.max(1000, Math.round(get('population.total')));
  s['economy.gdp_ppp_real'] = s['population.total'] * get('economy.gdp_per_capita_ppp');
  s['economy.gdp_nominal'] = s['economy.gdp_ppp_real'] * get('economy.price_level');
  return s;
}
