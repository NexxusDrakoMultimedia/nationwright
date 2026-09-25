// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Fits the guiding variables (DESIGN.md §4.12.1) from the projected snapshot: the
 * statistical model every fictional nation is sampled from.
 *
 * Model: a Gaussian mixture copula.
 *  - Marginals: each variable's real distribution across states, as 101 percentiles.
 *  - Normal scores: z = Φ⁻¹((rank − ½)/n) per variable; missing values are imputed by
 *    conditional-Gaussian EM.
 *  - Archetypes: k-means clusters in z-space. Each has a weight and a mean vector; all
 *    share one pooled within-cluster covariance (stable with ~200 states).
 *  - Sampling (engine): pick an archetype, draw z ~ N(mean, covariance), map each
 *    component through Φ and the variable's percentile table.
 * Only aggregate statistics are written; no per-country records.
 */

import {
  type Archetype,
  type GuidingVariable,
  type GuidingVariables,
  cholesky,
  choleskySolve,
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
export const GUIDING_MODEL_VERSION = 1;
export const ARCHETYPE_COUNT = 6;
const EM_ITERATIONS = 40;
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
  const { completed } = emImpute(scores, p);
  const rng = createStream(0n, 'reference/archetypes');
  const assignment = bestKMeans(completed, ARCHETYPE_COUNT, rng);
  const ordered = orderClusters(
    assignment,
    completed,
    MODEL_VARIABLES.findIndex((v) => v.id === 'economy.gdp_per_capita_ppp'),
  );

  const k = ARCHETYPE_COUNT;
  const means: Vector[] = Array.from({ length: k }, () => new Array<number>(p).fill(0));
  const counts = new Array<number>(k).fill(0);
  completed.forEach((row, i) => {
    const c = ordered[i] as number;
    counts[c] = (counts[c] ?? 0) + 1;
    row.forEach((x, j) => ((means[c] as Vector)[j] = ((means[c] as Vector)[j] as number) + x));
  });
  means.forEach((m, c) =>
    m.forEach((_, j) => (m[j] = (m[j] as number) / Math.max(1, counts[c] as number))),
  );

  const within = zeros(p, p);
  completed.forEach((row, i) => {
    const mu = means[ordered[i] as number] as Vector;
    for (let a = 0; a < p; a++) {
      for (let b = 0; b <= a; b++) {
        (within[a] as Vector)[b] =
          ((within[a] as Vector)[b] as number) +
          ((row[a] as number) - (mu[a] as number)) * ((row[b] as number) - (mu[b] as number));
      }
    }
  });
  const dof = Math.max(1, states.length - k);
  for (let a = 0; a < p; a++) {
    for (let b = 0; b <= a; b++) {
      const value = ((within[a] as Vector)[b] as number) / dof;
      (within[a] as Vector)[b] = value;
      (within[b] as Vector)[a] = value;
    }
  }
  const covariance = nearestPositiveDefinite(within, 1e-4);
  const correlation = correlationOf(completed, p);

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
    MODEL_VARIABLES.map((v, j) => [
      v.id,
      tidy(
        pearson(
          pairs.map(([a]) => (completed[a] as Vector)[j] as number),
          pairs.map(([, b]) => (completed[b] as Vector)[j] as number),
        ),
      ),
    ]),
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

/** Conditional-Gaussian EM: fills missing normal scores with their conditional means. */
function emImpute(scores: readonly (number | null)[][], p: number): { completed: Matrix } {
  const n = scores.length;
  const completed: Matrix = scores.map((row) => row.map((x) => x ?? 0));
  let mean: Vector = new Array<number>(p).fill(0);
  let cov: Matrix = correlationOf(completed, p);
  for (let iter = 0; iter < EM_ITERATIONS; iter++) {
    cov = nearestPositiveDefinite(cov, 1e-4);
    const extra = zeros(p, p);
    scores.forEach((row, i) => {
      const missing = row.flatMap((x, j) => (x === null ? [j] : []));
      if (missing.length === 0) return;
      const obs = row.flatMap((x, j) => (x === null ? [] : [j]));
      const soo = obs.map((a) => obs.map((b) => (cov[a] as Vector)[b] as number));
      const l = cholesky(soo);
      const resid = obs.map((j) => ((completed[i] as Vector)[j] as number) - (mean[j] as number));
      const w = choleskySolve(l, resid);
      for (const m of missing) {
        let v = mean[m] as number;
        obs.forEach((o, t) => (v += ((cov[m] as Vector)[o] as number) * (w[t] as number)));
        (completed[i] as Vector)[m] = v;
      }
      // Conditional covariance of the missing block, added to the covariance estimate.
      for (const a of missing) {
        const sa = choleskySolve(
          l,
          obs.map((o) => (cov[a] as Vector)[o] as number),
        );
        for (const b of missing) {
          let c = (cov[a] as Vector)[b] as number;
          obs.forEach((o, t) => (c -= ((cov[b] as Vector)[o] as number) * (sa[t] as number)));
          (extra[a] as Vector)[b] = ((extra[a] as Vector)[b] as number) + c;
        }
      }
    });
    mean = new Array<number>(p)
      .fill(0)
      .map((_, j) => completed.reduce((s, row) => s + (row[j] as number), 0) / n);
    const next = zeros(p, p);
    for (const row of completed) {
      for (let a = 0; a < p; a++) {
        for (let b = 0; b < p; b++) {
          (next[a] as Vector)[b] =
            ((next[a] as Vector)[b] as number) +
            ((row[a] as number) - (mean[a] as number)) * ((row[b] as number) - (mean[b] as number));
        }
      }
    }
    cov = next.map((row, a) => row.map((x, b) => (x + ((extra[a] as Vector)[b] as number)) / n));
  }
  return { completed };
}

function correlationOf(data: Matrix, p: number): Matrix {
  const n = data.length;
  const mean = new Array<number>(p)
    .fill(0)
    .map((_, j) => data.reduce((s, r) => s + (r[j] as number), 0) / n);
  const cov = zeros(p, p);
  for (const row of data) {
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < p; b++) {
        (cov[a] as Vector)[b] =
          ((cov[a] as Vector)[b] as number) +
          ((row[a] as number) - (mean[a] as number)) * ((row[b] as number) - (mean[b] as number));
      }
    }
  }
  return cov.map((row, a) =>
    row.map(
      (x, b) =>
        x / Math.sqrt(((cov[a] as Vector)[a] as number) * ((cov[b] as Vector)[b] as number)),
    ),
  );
}

function squaredDistance(a: Vector, b: Vector): number {
  let s = 0;
  for (let j = 0; j < a.length; j++) {
    const d = (a[j] as number) - (b[j] as number);
    s += d * d;
  }
  return s;
}

/** k-means++ with restarts; returns the lowest-inertia assignment. */
function bestKMeans(data: Matrix, k: number, rng: RandomStream): number[] {
  let best: { inertia: number; assignment: number[] } | null = null;
  for (let r = 0; r < KMEANS_RESTARTS; r++) {
    const centers: Matrix = [[...(data[rng.nextIntBelow(data.length)] as Vector)]];
    while (centers.length < k) {
      const d2 = data.map((x) => Math.min(...centers.map((c) => squaredDistance(x, c))));
      const total = d2.reduce((a, b) => a + b, 0);
      let target = rng.nextFloat64() * total;
      let pick = 0;
      for (; pick < d2.length - 1; pick++) {
        target -= d2[pick] as number;
        if (target < 0) break;
      }
      centers.push([...(data[pick] as Vector)]);
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
        for (let j = 0; j < c.length; j++)
          c[j] = members.reduce((s, m) => s + (m[j] as number), 0) / members.length;
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
function orderClusters(assignment: readonly number[], data: Matrix, byColumn: number): number[] {
  const k = Math.max(...assignment) + 1;
  const means = Array.from({ length: k }, (_, c) => {
    const members = data.filter((_, i) => assignment[i] === c);
    return {
      c,
      m: members.reduce((s, r) => s + (r[byColumn] as number), 0) / Math.max(1, members.length),
    };
  }).sort((a, b) => b.m - a.m);
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
