// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Field extractors: one entry per indicator, naming where it lives in a Factbook profile
 * and how to parse it. Unparsed values are reported, never guessed.
 */

import { cleanText, parseEstYear, parseHeadcount, parseNumber, parsePercent } from './text.ts';

/** A Factbook profile with keys trimmed (some keys carry stray spaces, e.g. "total "). */
export type Profile = Record<string, Record<string, unknown>>;

export interface Observation {
  readonly value: number;
  /** Year the estimate refers to; null when the text gives none. */
  readonly estYear: number | null;
  /** Earlier years from the same field, oldest first, for growth estimates. */
  readonly history?: readonly { readonly year: number; readonly value: number }[];
}

export type ParseKind = 'number' | 'percent' | 'headcount';

/** How a value may be moved forward in time (DESIGN.md §10.1). */
export type ProjectionKind =
  | 'population' // compound by the country's population growth rate
  | 'real-output' // compound by real GDP growth
  | 'nominal-usd' // compound by real GDP growth plus world dollar inflation
  | 'per-capita-output' // compound by (1 + real GDP growth) / (1 + population growth)
  | 'converge' // damped convergence toward the tier median, capped per year
  | 'carry'; // structural or year-specific: carried unchanged

export interface FieldSpec {
  readonly id: string;
  readonly unit: string;
  readonly description: string;
  /** [section, field, sub-field?]; alternatives are tried in order. */
  readonly paths: readonly (readonly [string, string, string?])[];
  readonly parse: ParseKind;
  /** The field holds per-year keys ("<Field> 2024", "<Field> 2023", …). */
  readonly series?: boolean;
  readonly projection: ProjectionKind;
  /** For 'converge': maximum change per year. */
  readonly maxChangePerYear?: number;
  /** Values outside this range are rejected as parse errors. */
  readonly range: readonly [number, number];
}

const PS = 'People and Society';

export const FIELDS: readonly FieldSpec[] = [
  // Geography
  {
    id: 'geography.area_km2',
    unit: 'km²',
    description: 'Total area',
    paths: [['Geography', 'Area', 'total']],
    parse: 'number',
    projection: 'carry',
    range: [0.1, 2e7],
  },
  {
    id: 'geography.coastline_km',
    unit: 'km',
    description: 'Coastline length',
    paths: [
      ['Geography', 'Coastline', 'total'],
      ['Geography', 'Coastline'],
    ],
    parse: 'number',
    projection: 'carry',
    range: [0, 3e5],
  },
  {
    id: 'geography.land_boundaries_km',
    unit: 'km',
    description: 'Total land boundary length',
    paths: [['Geography', 'Land boundaries', 'total']],
    parse: 'number',
    projection: 'carry',
    range: [0, 3e4],
  },

  // Population
  {
    id: 'population.total',
    unit: 'people',
    description: 'Total population',
    paths: [
      [PS, 'Population', 'total'],
      [PS, 'Population'],
    ],
    parse: 'number',
    projection: 'population',
    range: [1, 2e9],
  },
  {
    id: 'population.growth_rate',
    unit: '%/yr',
    description: 'Population growth rate',
    paths: [[PS, 'Population growth rate']],
    parse: 'percent',
    projection: 'converge',
    maxChangePerYear: 0.1,
    range: [-10, 15],
  },
  {
    id: 'population.birth_rate',
    unit: 'per 1,000',
    description: 'Births per 1,000 people per year',
    paths: [[PS, 'Birth rate']],
    parse: 'number',
    projection: 'converge',
    maxChangePerYear: 0.5,
    range: [1, 70],
  },
  {
    id: 'population.death_rate',
    unit: 'per 1,000',
    description: 'Deaths per 1,000 people per year',
    paths: [[PS, 'Death rate']],
    parse: 'number',
    projection: 'converge',
    maxChangePerYear: 0.3,
    range: [0.5, 40],
  },
  {
    id: 'population.net_migration_rate',
    unit: 'per 1,000',
    description: 'Net migrants per 1,000 people per year',
    paths: [[PS, 'Net migration rate']],
    parse: 'number',
    projection: 'carry',
    range: [-100, 100],
  },
  {
    id: 'population.tfr',
    unit: 'children/woman',
    description: 'Total fertility rate',
    paths: [[PS, 'Total fertility rate']],
    parse: 'number',
    projection: 'converge',
    maxChangePerYear: 0.05,
    range: [0.5, 9],
  },
  {
    id: 'population.life_expectancy',
    unit: 'years',
    description: 'Life expectancy at birth',
    paths: [[PS, 'Life expectancy at birth', 'total population']],
    parse: 'number',
    projection: 'converge',
    maxChangePerYear: 0.3,
    range: [30, 95],
  },
  {
    id: 'population.infant_mortality',
    unit: 'per 1,000 births',
    description: 'Infant mortality rate',
    paths: [[PS, 'Infant mortality rate', 'total']],
    parse: 'number',
    projection: 'converge',
    maxChangePerYear: 1,
    range: [0.5, 200],
  },
  {
    id: 'population.median_age',
    unit: 'years',
    description: 'Median age',
    paths: [[PS, 'Median age', 'total']],
    parse: 'number',
    projection: 'converge',
    maxChangePerYear: 0.3,
    range: [10, 65],
  },
  {
    id: 'population.urban_share',
    unit: '%',
    description: 'Urban share of population',
    paths: [[PS, 'Urbanization', 'urban population']],
    parse: 'percent',
    projection: 'converge',
    maxChangePerYear: 0.5,
    range: [0, 100],
  },
  {
    id: 'population.urbanization_rate',
    unit: '%/yr',
    description: 'Annual change in urban population',
    paths: [[PS, 'Urbanization', 'rate of urbanization']],
    parse: 'percent',
    projection: 'carry',
    range: [-10, 15],
  },
  {
    id: 'population.age_0_14_share',
    unit: '%',
    description: 'Share aged 0–14',
    paths: [[PS, 'Age structure', '0-14 years']],
    parse: 'percent',
    projection: 'carry',
    range: [5, 60],
  },
  {
    id: 'population.age_15_64_share',
    unit: '%',
    description: 'Share aged 15–64',
    paths: [[PS, 'Age structure', '15-64 years']],
    parse: 'percent',
    projection: 'carry',
    range: [35, 90],
  },
  {
    id: 'population.age_65_plus_share',
    unit: '%',
    description: 'Share aged 65 and over',
    paths: [[PS, 'Age structure', '65 years and over']],
    parse: 'percent',
    projection: 'carry',
    range: [0, 45],
  },

  // Education
  {
    id: 'education.literacy',
    unit: '%',
    description: 'Adult literacy, total population',
    paths: [[PS, 'Literacy', 'total population']],
    parse: 'percent',
    projection: 'converge',
    maxChangePerYear: 0.5,
    range: [5, 100],
  },
  {
    id: 'education.school_life_expectancy',
    unit: 'years',
    description: 'Expected years of schooling',
    paths: [[PS, 'School life expectancy (primary to tertiary education)', 'total']],
    parse: 'number',
    projection: 'converge',
    maxChangePerYear: 0.1,
    range: [1, 25],
  },

  // Economy
  {
    id: 'economy.gdp_ppp_real',
    unit: 'USD (2021, PPP)',
    description: 'Real GDP, purchasing power parity',
    paths: [['Economy', 'Real GDP (purchasing power parity)']],
    parse: 'number',
    series: true,
    projection: 'real-output',
    range: [1e6, 1e14],
  },
  {
    id: 'economy.gdp_growth',
    unit: '%/yr',
    description: 'Real GDP growth rate',
    paths: [['Economy', 'Real GDP growth rate']],
    parse: 'percent',
    series: true,
    projection: 'carry',
    range: [-60, 100],
  },
  {
    id: 'economy.gdp_per_capita_ppp',
    unit: 'USD (2021, PPP)',
    description: 'Real GDP per capita, PPP',
    paths: [['Economy', 'Real GDP per capita']],
    parse: 'number',
    series: true,
    projection: 'per-capita-output',
    range: [100, 3e5],
  },
  {
    id: 'economy.gdp_nominal',
    unit: 'USD',
    description: 'GDP at official exchange rate',
    paths: [['Economy', 'GDP (official exchange rate)']],
    parse: 'number',
    projection: 'nominal-usd',
    range: [1e6, 1e14],
  },
  {
    id: 'economy.inflation',
    unit: '%/yr',
    description: 'Consumer price inflation',
    paths: [['Economy', 'Inflation rate (consumer prices)']],
    parse: 'percent',
    series: true,
    projection: 'carry',
    range: [-30, 1e5],
  },
  {
    id: 'economy.unemployment',
    unit: '%',
    description: 'Unemployment rate',
    paths: [['Economy', 'Unemployment rate']],
    parse: 'percent',
    series: true,
    projection: 'carry',
    range: [0, 90],
  },
  {
    id: 'economy.public_debt',
    unit: '% of GDP',
    description: 'Public debt',
    paths: [['Economy', 'Public debt']],
    parse: 'percent',
    series: true,
    projection: 'carry',
    range: [0, 400],
  },
  {
    id: 'economy.exports',
    unit: 'USD',
    description: 'Exports of goods and services',
    paths: [['Economy', 'Exports']],
    parse: 'number',
    series: true,
    projection: 'nominal-usd',
    range: [1e4, 1e14],
  },
  {
    id: 'economy.imports',
    unit: 'USD',
    description: 'Imports of goods and services',
    paths: [['Economy', 'Imports']],
    parse: 'number',
    series: true,
    projection: 'nominal-usd',
    range: [1e4, 1e14],
  },
  {
    id: 'economy.sector_agriculture',
    unit: '% of GDP',
    description: 'Agriculture share of GDP',
    paths: [['Economy', 'GDP - composition, by sector of origin', 'agriculture']],
    parse: 'percent',
    projection: 'converge',
    maxChangePerYear: 0.5,
    range: [0, 100],
  },
  {
    id: 'economy.sector_industry',
    unit: '% of GDP',
    description: 'Industry share of GDP',
    paths: [['Economy', 'GDP - composition, by sector of origin', 'industry']],
    parse: 'percent',
    projection: 'converge',
    maxChangePerYear: 0.5,
    range: [0, 100],
  },
  {
    id: 'economy.sector_services',
    unit: '% of GDP',
    description: 'Services share of GDP',
    paths: [['Economy', 'GDP - composition, by sector of origin', 'services']],
    parse: 'percent',
    projection: 'converge',
    maxChangePerYear: 0.5,
    range: [0, 100],
  },

  // Military (conventional only, D15)
  {
    id: 'military.expenditure_share',
    unit: '% of GDP',
    description: 'Military expenditure',
    paths: [['Military and Security', 'Military expenditures']],
    parse: 'percent',
    series: true,
    projection: 'carry',
    range: [0, 50],
  },

  {
    id: 'military.active_personnel',
    unit: 'people',
    description: 'Active armed forces (first force listed)',
    paths: [['Military and Security', 'Military and security service personnel strengths']],
    parse: 'headcount',
    projection: 'carry',
    range: [10, 5e6],
  },

  // Infrastructure
  {
    id: 'energy.electricity_access',
    unit: '%',
    description: 'Population with electricity',
    paths: [['Energy', 'Electricity access', 'electrification - total population']],
    parse: 'percent',
    projection: 'converge',
    maxChangePerYear: 1,
    range: [0, 100],
  },
  {
    id: 'communications.internet_users',
    unit: '%',
    description: 'Internet users, share of population',
    paths: [['Communications', 'Internet users', 'percent of population']],
    parse: 'percent',
    projection: 'converge',
    maxChangePerYear: 2,
    range: [0, 100],
  },
  {
    id: 'transport.railways_km',
    unit: 'km',
    description: 'Railway network length',
    paths: [['Transportation', 'Railways', 'total']],
    parse: 'number',
    projection: 'carry',
    range: [1, 3e5],
  },
];

export interface ExtractIssue {
  readonly field: string;
  readonly text: string;
  readonly reason: string;
}

/** Recursively trims object keys. */
export function normalizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.trim(), normalizeKeys(v)]));
  }
  return value;
}

function child(node: unknown, key: string): unknown {
  return node !== null && typeof node === 'object'
    ? (node as Record<string, unknown>)[key]
    : undefined;
}

/** The `text` of a node, cleaned, or undefined. */
export function textAt(node: unknown): string | undefined {
  const text = child(node, 'text');
  return typeof text === 'string' ? cleanText(text) : undefined;
}

function locate(profile: Profile, spec: FieldSpec): unknown {
  for (const [section, field, sub] of spec.paths) {
    let node: unknown = profile[section]?.[field];
    if (node !== undefined && sub !== undefined) node = child(node, sub);
    if (node !== undefined) return node;
  }
  return undefined;
}

function parseValue(text: string, kind: ParseKind): number | null {
  if (kind === 'headcount') return parseHeadcount(text);
  return kind === 'percent' ? parsePercent(text) : parseNumber(text);
}

/**
 * Extracts one field. Returns the observation, or null when the field is absent.
 * Present-but-unparseable values are pushed to `issues`.
 */
export function extractField(
  profile: Profile,
  spec: FieldSpec,
  issues: ExtractIssue[],
): Observation | null {
  const node = locate(profile, spec);
  if (node === undefined) return null;

  const candidates: { year: number | null; text: string }[] = [];
  if (spec.series && textAt(node) === undefined && node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const keyYear = /\b((?:19|20)\d{2})$/.exec(key);
      const text = textAt(value);
      if (keyYear !== null && text !== undefined) {
        candidates.push({ year: Number(keyYear[1]), text });
      }
    }
  } else {
    const text = textAt(node);
    if (text !== undefined) candidates.push({ year: null, text });
  }
  if (candidates.length === 0) return null;

  const parsed: { year: number | null; value: number }[] = [];
  for (const { year, text } of candidates) {
    if (/^(?:NA|not available)\b/i.test(text)) continue;
    const value = parseValue(text, spec.parse);
    if (value === null) {
      issues.push({ field: spec.id, text, reason: 'no number found' });
      continue;
    }
    if (value < spec.range[0] || value > spec.range[1]) {
      issues.push({ field: spec.id, text, reason: `out of range [${spec.range.join(', ')}]` });
      continue;
    }
    parsed.push({ year: year ?? parseEstYear(text), value });
  }
  if (parsed.length === 0) return null;

  parsed.sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
  const latest = parsed.at(-1) as { year: number | null; value: number };
  const history = parsed
    .slice(0, -1)
    .filter((p): p is { year: number; value: number } => p.year !== null);
  return history.length > 0
    ? { value: latest.value, estYear: latest.year, history }
    : { value: latest.value, estYear: latest.year };
}
