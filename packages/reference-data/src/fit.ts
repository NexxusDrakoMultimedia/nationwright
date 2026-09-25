// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Fits the guiding variables (DESIGN.md §4.12.1) from the projected snapshot: the
 * statistical model every fictional nation is sampled from.
 *
 * Model: a Gaussian mixture copula.
 *  - Marginals: each variable's real distribution across states, as 101 percentiles.
 *  - Normal scores: z = Φ⁻¹((rank − ½)/n) per variable, over the states that report it.
 *  - Nothing is imputed. Every statistic is available-case: a state that doesn't report a
 *    variable is left out of every calculation involving that variable (its percentiles,
 *    archetype means, covariances, correlations, and clustering distances).
 *  - Archetypes: k-means clusters in z-space (partial distances over reported values).
 *    Each has a weight and a mean vector; all share one within-cluster covariance, set so
 *    the mixture's total correlation equals the reporters-only correlation.
 *  - Generated nations always get every variable (the sampler fills the whole vector).
 *  - Sampling (engine): pick an archetype, draw z ~ N(mean, covariance), map each
 *    component through Φ and the variable's percentile table.
 * Only aggregate statistics are written; no per-country records.
 */

import {
  type Archetype,
  type GuidingVariable,
  type GuidingVariables,
  createStream,
  nearestPositiveDefinite,
  normalQuantile,
  zeros,
  type Matrix,
  type RandomStream,
  type Vector,
} from '@nationwright/engine';
import type { ProjectedCountry } from './project.ts';
import { quantile } from './stats.ts';

/** Bump when the model or its output format changes. */
export const GUIDING_MODEL_VERSION = 3;
export const ARCHETYPE_COUNT = 6;
const KMEANS_RESTARTS = 20;
const KMEANS_ITERATIONS = 200;
/** Earth's land fraction (not from the Factbook; used as the map generator default). */
export const EARTH_LAND_FRACTION = 0.292;

export interface ModelVariable {
  readonly id: string;
  readonly unit: string;
  readonly description: string;
  /** How a state's value is read; null means missing. */
  readonly read: (c: ProjectedCountry) => number | null;
}

const field =
  (id: string, missingAsZero = false) =>
  (c: ProjectedCountry): number | null =>
    c.fields[id]?.value ?? (missingAsZero ? 0 : null);

/** The variables in the copula. Geography that the map produces (coastline, borders) is excluded. */
export const MODEL_VARIABLES: readonly ModelVariable[] = [
  {
    id: 'population.total',
    unit: 'people',
    description: 'Population',
    read: field('population.total'),
  },
  {
    id: 'geography.area_km2',
    unit: 'km²',
    description: 'Area (target for the map)',
    read: field('geography.area_km2'),
  },
  {
    id: 'economy.gdp_per_capita_ppp',
    unit: 'USD (2021, PPP)',
    description: 'GDP per capita, PPP',
    read: field('economy.gdp_per_capita_ppp'),
  },
  {
    id: 'economy.price_level',
    unit: 'ratio',
    description: 'GDP at exchange rates ÷ GDP at PPP',
    read: (c) => {
      const nominal = c.fields['economy.gdp_nominal']?.value;
      const ppp = c.fields['economy.gdp_ppp_real']?.value;
      return nominal !== undefined && ppp !== undefined && ppp > 0 ? nominal / ppp : null;
    },
  },
  {
    id: 'economy.gdp_growth',
    unit: '%/yr',
    description: 'Real GDP growth',
    read: field('economy.gdp_growth'),
  },
  {
    id: 'economy.inflation',
    unit: '%/yr',
    description: 'Inflation',
    read: field('economy.inflation'),
  },
  {
    id: 'economy.unemployment',
    unit: '%',
    description: 'Unemployment',
    read: field('economy.unemployment'),
  },
  {
    id: 'economy.public_debt',
    unit: '% of GDP',
    description: 'Public debt',
    read: field('economy.public_debt'),
  },
  {
    id: 'economy.exports_share_gdp',
    unit: '% of GDP',
    description: 'Exports',
    read: field('economy.exports_share_gdp'),
  },
  {
    id: 'economy.imports_share_gdp',
    unit: '% of GDP',
    description: 'Imports',
    read: field('economy.imports_share_gdp'),
  },
  {
    id: 'economy.sector_agriculture',
    unit: '% of GDP',
    description: 'Agriculture share',
    read: field('economy.sector_agriculture'),
  },
  {
    id: 'economy.sector_industry',
    unit: '% of GDP',
    description: 'Industry share',
    read: field('economy.sector_industry'),
  },
  {
    id: 'economy.sector_services',
    unit: '% of GDP',
    description: 'Services share',
    read: field('economy.sector_services'),
  },
  {
    id: 'population.tfr',
    unit: 'children/woman',
    description: 'Total fertility rate',
    read: field('population.tfr'),
  },
  {
    id: 'population.life_expectancy',
    unit: 'years',
    description: 'Life expectancy',
    read: field('population.life_expectancy'),
  },
  {
    id: 'population.infant_mortality',
    unit: 'per 1,000 births',
    description: 'Infant mortality',
    read: field('population.infant_mortality'),
  },
  {
    id: 'population.median_age',
    unit: 'years',
    description: 'Median age',
    read: field('population.median_age'),
  },
  {
    id: 'population.urban_share',
    unit: '%',
    description: 'Urban share',
    read: field('population.urban_share'),
  },
  {
    id: 'population.age_0_14_share',
    unit: '%',
    description: 'Share aged 0–14',
    read: field('population.age_0_14_share'),
  },
  {
    id: 'population.age_65_plus_share',
    unit: '%',
    description: 'Share aged 65+',
    read: field('population.age_65_plus_share'),
  },
  {
    id: 'population.birth_rate',
    unit: 'per 1,000',
    description: 'Birth rate',
    read: field('population.birth_rate'),
  },
  {
    id: 'population.death_rate',
    unit: 'per 1,000',
    description: 'Death rate',
    read: field('population.death_rate'),
  },
  {
    id: 'population.net_migration_rate',
    unit: 'per 1,000',
    description: 'Net migration rate',
    read: field('population.net_migration_rate'),
  },
  {
    id: 'population.growth_rate',
    unit: '%/yr',
    description: 'Population growth',
    read: field('population.growth_rate'),
  },
  {
    id: 'energy.electricity_access',
    unit: '%',
    description: 'Electricity access',
    read: field('energy.electricity_access'),
  },
  {
    id: 'communications.internet_users',
    unit: '%',
    description: 'Internet users',
    read: field('communications.internet_users'),
  },
  {
    id: 'education.literacy',
    unit: '%',
    description: 'Literacy',
    read: field('education.literacy'),
  },
  {
    id: 'education.school_life_expectancy',
    unit: 'years',
    description: 'Expected years of schooling',
    read: field('education.school_life_expectancy'),
  },
  {
    id: 'economy.revenue_share_gdp',
    unit: '% of GDP',
    description: 'Central government revenues',
    read: field('economy.revenue_share_gdp'),
  },
  {
    id: 'economy.budget_balance_share',
    unit: '% of GDP',
    description: 'Central government budget balance',
    read: field('economy.budget_balance_share'),
  },
  {
    id: 'economy.investment_share',
    unit: '% of GDP',
    description: 'Investment in fixed capital',
    read: field('economy.investment_share'),
  },
  {
    id: 'economy.government_consumption_share',
    unit: '% of GDP',
    description: 'Government consumption',
    read: field('economy.government_consumption_share'),
  },
  {
    id: 'economy.gini',
    unit: 'index 0–100',
    description: 'Gini index of family income',
    read: field('economy.gini'),
  },
  {
    id: 'economy.labor_participation',
    unit: '% of people 15+',
    description: 'Labor force participation',
    read: field('economy.labor_participation'),
  },
  {
    id: 'economy.remittances_share',
    unit: '% of GDP',
    description: 'Remittances received',
    read: field('economy.remittances_share'),
  },
  {
    id: 'military.expenditure_share',
    unit: '% of GDP',
    description: 'Military spending',
    read: field('military.expenditure_share'),
  },
  {
    id: 'military.personnel_per_1000',
    unit: 'per 1,000 people',
    description: 'Active military personnel',
    read: field('military.personnel_per_1000'),
  },
  // The Factbook omits the railways field for states without railways.
  {
    id: 'transport.railway_density',
    unit: 'km per 1,000 km²',
    description: 'Railway density',
    read: field('transport.railway_density', true),
  },
  {
    id: 'society.ethnic_fractionalization',
    unit: 'index 0–1',
    description: 'Ethnic fractionalization',
    read: field('society.ethnic_fractionalization'),
  },
  {
    id: 'society.religious_fractionalization',
    unit: 'index 0–1',
    description: 'Religious fractionalization',
    read: field('society.religious_fractionalization'),
  },
];

export function fitGuidingVariables(
  countries: readonly ProjectedCountry[],
  header: { pipelineVersion: number; targetYear: number; sourceCommit: string },
): GuidingVariables {
  const states = countries.filter((c) => c.kind === 'state');
  const territories = countries.filter((c) => c.kind === 'territory');
  const p = MODEL_VARIABLES.length;
  const raw: (number | null)[][] = states.map((s) => MODEL_VARIABLES.map((v) => v.read(s)));

  const variables: GuidingVariable[] = MODEL_VARIABLES.map((v, j) => {
    const observed = raw
      .map((row) => row[j])
      .filter((x): x is number => x !== null && x !== undefined);
    return {
      id: v.id,
      unit: v.unit,
      description: v.description,
      n: observed.length,
      quantiles: Array.from({ length: 101 }, (_, q) => tidy(quantile(observed, q / 100))),
    };
  });

  const scores = normalScores(raw, p);
  const rng = createStream(0n, 'reference/archetypes');
  const assignment = bestKMeans(scores, ARCHETYPE_COUNT, rng);
  const ordered = orderClusters(
    assignment,
    scores,
    MODEL_VARIABLES.findIndex((v) => v.id === 'economy.gdp_per_capita_ppp'),
  );

  // Archetype means: per variable, over the members that report it. A cluster with no
  // reporting member sits at the variable's overall centre (0).
  const k = ARCHETYPE_COUNT;
  const counts = new Array<number>(k).fill(0);
  ordered.forEach((c) => (counts[c] = (counts[c] as number) + 1));
  const means: Vector[] = Array.from({ length: k }, (_, c) =>
    partialMean(scores.filter((_, i) => ordered[i] === c)),
  );

  // Pooled within-cluster covariance, pairwise: entry (a, b) uses only states reporting
  // both a and b, with their own degrees of freedom.
  const within = zeros(p, p);
  for (let a = 0; a < p; a++) {
    for (let b = 0; b <= a; b++) {
      let sum = 0;
      let n = 0;
      const clusters = new Set<number>();
      scores.forEach((row, i) => {
        const x = row[a];
        const y = row[b];
        if (x === null || x === undefined || y === null || y === undefined) return;
        const c = ordered[i] as number;
        const mu = means[c] as Vector;
        sum += (x - (mu[a] as number)) * (y - (mu[b] as number));
        n++;
        clusters.add(c);
      });
      const value = sum / Math.max(1, n - clusters.size);
      (within[a] as Vector)[b] = value;
      (within[b] as Vector)[a] = value;
    }
  }
  const correlation = pairwiseCorrelation(scores, p);

  // Nations are drawn with archetype weights from all states, but a sparsely reported
  // variable's reporters aren't spread across archetypes like all states are. Recentre and
  // rescale each variable's archetype means so the weighted mixture has the reporters'
  // mean (0) and variance (1): non-reporters can't pull the generated distribution.
  const weights = counts.map((c) => c / states.length);
  for (let j = 0; j < p; j++) {
    const centre = means.reduce((s, m, c) => s + (weights[c] as number) * (m[j] as number), 0);
    const between = means.reduce(
      (s, m, c) => s + (weights[c] as number) * ((m[j] as number) - centre) ** 2,
      0,
    );
    const target = Math.max(0, 1 - ((within[j] as Vector)[j] as number));
    const scale = between > 0 ? Math.sqrt(target / between) : 1;
    for (const m of means) m[j] = ((m[j] as number) - centre) * scale;
  }

  // The within-archetype covariance is whatever the reporters-only correlation leaves
  // after the between-archetype part, so the mixture's total correlation matches it.
  const total = zeros(p, p);
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < p; b++) {
      const between = means.reduce(
        (s, m, c) => s + (weights[c] as number) * (m[a] as number) * (m[b] as number),
        0,
      );
      (total[a] as Vector)[b] = ((correlation[a] as Vector)[b] as number) - between;
    }
  }
  const covariance = nearestPositiveDefinite(total, 1e-4);

  const archetypes: Archetype[] = means.map((mean, c) => {
    const members = states.filter((_, i) => ordered[i] === c);
    return {
      id: c,
      label: '',
      weight: tidy((counts[c] as number) / states.length),
      mean: mean.map(tidy),
      governmentCategories: shares(members.map((m) => m.governmentCategory ?? 'other')),
      landlockedShare: tidy(
        members.filter((m) => m.landlocked).length / Math.max(1, members.length),
      ),
      islandShare: tidy(
        members.filter((m) => m.borders.length === 0).length / Math.max(1, members.length),
      ),
      ethnicGroupCounts: shares(members.map((m) => String(groupCount(m.ethnicGroups, true)))),
      religionCounts: shares(members.map((m) => String(groupCount(m.religions, true)))),
      languageCounts: shares(members.map((m) => String(groupCount(m.languages, false)))),
    };
  });
  labelArchetypes(archetypes);

  // Spatial similarity across land borders between states.
  const index = new Map(states.map((s, i) => [s.code, i]));
  const pairs: [number, number][] = [];
  states.forEach((s, i) => {
    for (const b of s.borders) {
      const j = b.code === null ? undefined : index.get(b.code);
      if (j !== undefined && j !== i) pairs.push([i, j]);
    }
  });
  const neighborCorrelation = Object.fromEntries(
    MODEL_VARIABLES.map((v, j) => {
      const both = pairs.filter(
        ([a, b]) => (scores[a] as Score[])[j] != null && (scores[b] as Score[])[j] != null,
      );
      return [
        v.id,
        tidy(
          pearson(
            both.map(([a]) => (scores[a] as Score[])[j] as number),
            both.map(([, b]) => (scores[b] as Score[])[j] as number),
          ),
        ),
      ];
    }),
  );
  const agreement =
    pairs.filter(([a, b]) => ordered[a] === ordered[b]).length / Math.max(1, pairs.length);
  const chance = archetypes.reduce((s, a) => s + a.weight * a.weight, 0);

  return {
    modelVersion: GUIDING_MODEL_VERSION,
    ...header,
    variables,
    archetypes,
    covariance: covariance.map((row) => row.map(tidy)),
    correlation: correlation.map((row) => row.map(tidy)),
    spatial: {
      neighborCorrelation,
      archetypeAgreement: tidy(agreement),
      archetypeAgreementChance: tidy(chance),
    },
    structure: {
      stateCount: states.length,
      territoriesPerState: tidy(territories.length / states.length),
      landlockedShare: tidy(states.filter((s) => s.landlocked).length / states.length),
      islandShare: tidy(states.filter((s) => s.borders.length === 0).length / states.length),
      neighborCounts: shares(states.map((s) => String(s.borders.length))),
      landFraction: EARTH_LAND_FRACTION,
    },
  };
}

/** z = Φ⁻¹((rank − ½)/n) per column over observed values (ties get their average rank). */
function normalScores(raw: readonly (number | null)[][], p: number): (number | null)[][] {
  const out: (number | null)[][] = raw.map((row) => row.map(() => null));
  for (let j = 0; j < p; j++) {
    const observed = raw
      .map((row, i) => ({ i, x: row[j] }))
      .filter((e): e is { i: number; x: number } => e.x !== null && e.x !== undefined)
      .sort((a, b) => a.x - b.x || a.i - b.i);
    const n = observed.length;
    let start = 0;
    while (start < n) {
      let end = start;
      while (
        end + 1 < n &&
        (observed[end + 1] as { x: number }).x === (observed[start] as { x: number }).x
      )
        end++;
      const rank = (start + end) / 2 + 1;
      const z = normalQuantile((rank - 0.5) / n);
      for (let t = start; t <= end; t++)
        (out[(observed[t] as { i: number }).i] as (number | null)[])[j] = z;
      start = end + 1;
    }
  }
  return out;
}

type Score = number | null;

/** Per-column mean over the rows that report it (0 when none do). */
function partialMean(rows: readonly (readonly Score[])[]): Vector {
  const p = rows[0]?.length ?? 0;
  return Array.from({ length: p }, (_, j) => {
    let sum = 0;
    let n = 0;
    for (const row of rows) {
      const x = row[j];
      if (x === null || x === undefined) continue;
      sum += x;
      n++;
    }
    return n === 0 ? 0 : sum / n;
  });
}

/** Pearson correlation of every pair of columns over the rows reporting both. */
function pairwiseCorrelation(scores: readonly (readonly Score[])[], p: number): Matrix {
  const out = zeros(p, p);
  for (let a = 0; a < p; a++) {
    (out[a] as Vector)[a] = 1;
    for (let b = 0; b < a; b++) {
      const both = scores.filter((r) => r[a] != null && r[b] != null);
      const r = pearson(
        both.map((row) => row[a] as number),
        both.map((row) => row[b] as number),
      );
      (out[a] as Vector)[b] = r;
      (out[b] as Vector)[a] = r;
    }
  }
  return out;
}

/**
 * Squared distance over the columns the state reports, rescaled to all p columns so
 * states with gaps are comparable (partial distance strategy).
 */
function squaredDistance(x: readonly Score[], center: Vector): number {
  let s = 0;
  let n = 0;
  for (let j = 0; j < x.length; j++) {
    const v = x[j];
    if (v === null || v === undefined) continue;
    const d = v - (center[j] as number);
    s += d * d;
    n++;
  }
  return n === 0 ? 0 : (s * x.length) / n;
}

/** k-means++ with restarts; returns the lowest-inertia assignment. */
function bestKMeans(data: readonly (readonly Score[])[], k: number, rng: RandomStream): number[] {
  // A seed centre takes the state's reported values and 0 (the centre) for its gaps.
  const seed = (i: number): Vector => (data[i] as Score[]).map((x) => x ?? 0);
  let best: { inertia: number; assignment: number[] } | null = null;
  for (let r = 0; r < KMEANS_RESTARTS; r++) {
    const centers: Matrix = [seed(rng.nextIntBelow(data.length))];
    while (centers.length < k) {
      const d2 = data.map((x) => Math.min(...centers.map((c) => squaredDistance(x, c))));
      const total = d2.reduce((a, b) => a + b, 0);
      let target = rng.nextFloat64() * total;
      let pick = 0;
      for (; pick < d2.length - 1; pick++) {
        target -= d2[pick] as number;
        if (target < 0) break;
      }
      centers.push(seed(pick));
    }
    let assignment = new Array<number>(data.length).fill(0);
    for (let iter = 0; iter < KMEANS_ITERATIONS; iter++) {
      const next = data.map((x) => {
        let bestC = 0;
        let bestD = Infinity;
        centers.forEach((c, ci) => {
          const d = squaredDistance(x, c);
          if (d < bestD) {
            bestD = d;
            bestC = ci;
          }
        });
        return bestC;
      });
      const changed = next.some((c, i) => c !== assignment[i]);
      assignment = next;
      centers.forEach((c, ci) => {
        const members = data.filter((_, i) => assignment[i] === ci);
        if (members.length === 0) return;
        const m = partialMean(members);
        for (let j = 0; j < c.length; j++) c[j] = m[j] as number;
      });
      if (!changed && iter > 0) break;
    }
    const inertia = data.reduce(
      (s, x, i) => s + squaredDistance(x, centers[assignment[i] as number] as Vector),
      0,
    );
    if (best === null || inertia < best.inertia) best = { inertia, assignment };
  }
  return (best as { assignment: number[] }).assignment;
}

/** Renumbers clusters by descending mean of one variable (GDP per capita), for stable ids. */
function orderClusters(
  assignment: readonly number[],
  data: readonly (readonly Score[])[],
  byColumn: number,
): number[] {
  const k = Math.max(...assignment) + 1;
  const means = Array.from({ length: k }, (_, c) => ({
    c,
    m: partialMean(data.filter((_, i) => assignment[i] === c))[byColumn] as number,
  })).sort((a, b) => b.m - a.m || a.c - b.c);
  const rename = new Map(means.map((e, rank) => [e.c, rank]));
  return assignment.map((c) => rename.get(c) as number);
}

const TRAITS: readonly (readonly [string, number, string])[] = [
  ['economy.sector_agriculture', 1, 'agrarian'],
  ['economy.sector_industry', 1, 'industrial'],
  ['economy.sector_services', 1, 'service economy'],
  ['economy.exports_share_gdp', 1, 'trade-oriented'],
  ['population.tfr', 1, 'young and fast-growing'],
  ['population.median_age', 1, 'ageing'],
  ['military.personnel_per_1000', 1, 'militarized'],
  ['population.net_migration_rate', 1, 'immigration hub'],
  ['population.net_migration_rate', -1, 'emigration'],
  ['population.total', 1, 'populous'],
  ['population.total', -1, 'microstate'],
  ['economy.inflation', 1, 'high-inflation'],
];

function labelArchetypes(archetypes: Archetype[]): void {
  const col = (id: string) => MODEL_VARIABLES.findIndex((v) => v.id === id);
  const used = new Set<string>();
  for (const a of archetypes) {
    const income = a.mean[col('economy.gdp_per_capita_ppp')] as number;
    const tier =
      income > 0.8
        ? 'high-income'
        : income > 0
          ? 'upper-middle-income'
          : income > -0.8
            ? 'lower-middle-income'
            : 'low-income';
    const ranked = [...TRAITS]
      .map(([id, sign, name]) => ({ name, score: sign * (a.mean[col(id)] as number) }))
      .sort((x, y) => y.score - x.score);
    const trait = ranked.find((t) => !used.has(`${tier}, ${t.name}`)) ?? ranked[0];
    const label = `${tier}, ${trait?.name ?? 'mixed'}`;
    used.add(label);
    (a as { label: string }).label = label;
  }
}

function pearson(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - mx;
    const dy = (y[i] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

function shares(values: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Object.fromEntries(
    [...counts.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, c]) => [k, tidy(c / Math.max(1, values.length))]),
  );
}

const RESIDUAL_LABEL = /^(?:other|others|unspecified|unknown|mixed|none of the above)\b/i;

/** Number of named groups (at least 1% when shares are given; capped at 12). */
function groupCount(
  items: readonly { label: string; share: number | null }[],
  needShare: boolean,
): number {
  const named = items.filter(
    (i) => !RESIDUAL_LABEL.test(i.label) && (needShare ? (i.share ?? 0) >= 1 : true),
  );
  return Math.max(1, Math.min(12, named.length));
}

function tidy(value: number): number {
  return Number(value.toPrecision(8));
}
