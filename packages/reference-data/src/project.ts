// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Forward projection to the target year (DESIGN.md §10.1, D11). The Factbook is frozen,
 * so every value is older than any start year from now on.
 *
 * Until M1 fits proper archetypes, "tier" means the country's GDP-per-capita quartile
 * among states; convergence targets are tier medians of observed values.
 */

import type { CountryRecord } from './country.ts';
import { FIELDS, type FieldSpec, type ProjectionKind } from './fields.ts';
import { fractionalization, median, quantile } from './stats.ts';

export interface ProjectionOptions {
  readonly targetYear: number;
  /** Annual US-dollar inflation applied to nominal USD values, in % (default 2.5). */
  readonly dollarInflation?: number;
  /** Fraction of the gap to the tier median closed per year (default 0.05). */
  readonly convergenceRate?: number;
  /** Real GDP growth used for projection is clamped to ± this, in % (default 10). */
  readonly maxGrowth?: number;
  /** Projections longer than this many years are flagged low-confidence (default 5). */
  readonly lowConfidenceYears?: number;
}

export type Method = 'observed' | ProjectionKind | 'derived';

export interface ProjectedValue {
  readonly value: number;
  /** The value as published, before projection (null for derived values). */
  readonly observed: number | null;
  readonly estYear: number | null;
  readonly method: Method;
  readonly projectionYears: number;
  readonly lowConfidence: boolean;
}

export interface ProjectedCountry extends Omit<CountryRecord, 'fields'> {
  readonly tier: number | null;
  readonly fields: Readonly<Record<string, ProjectedValue>>;
}

/** Indicators computed from projected fields (not read from the Factbook directly). */
export const DERIVED_INDICATORS = [
  { id: 'economy.exports_share_gdp', unit: '% of GDP', description: 'Exports as a share of GDP' },
  { id: 'economy.imports_share_gdp', unit: '% of GDP', description: 'Imports as a share of GDP' },
  {
    id: 'transport.railway_density',
    unit: 'km per 1,000 km²',
    description: 'Railway length per area',
  },
  {
    id: 'society.ethnic_fractionalization',
    unit: 'index 0–1',
    description: 'Chance two random people are from different listed ethnic groups',
  },
  {
    id: 'society.religious_fractionalization',
    unit: 'index 0–1',
    description: 'Chance two random people have different listed religions',
  },
  { id: 'geography.border_count', unit: 'countries', description: 'Number of land neighbours' },
  {
    id: 'economy.revenue_share_gdp',
    unit: '% of GDP',
    description: 'Central government revenues as a share of GDP',
  },
  {
    id: 'economy.expenditure_share_gdp',
    unit: '% of GDP',
    description: 'Central government expenditures as a share of GDP',
  },
  {
    id: 'economy.budget_balance_share',
    unit: '% of GDP',
    description: 'Central government budget balance (revenues − expenditures)',
  },
  {
    id: 'economy.labor_participation',
    unit: '% of people 15+',
    description: 'Labor force as a share of people aged 15 and over',
  },
  {
    id: 'economy.current_account_share',
    unit: '% of GDP',
    description: 'Current account balance as a share of GDP',
  },
  {
    id: 'military.personnel_per_1000',
    unit: 'per 1,000 people',
    description: 'Active armed forces per 1,000 people',
  },
] as const;

export function projectAll(
  records: readonly CountryRecord[],
  options: ProjectionOptions,
): ProjectedCountry[] {
  const opts = {
    dollarInflation: 2.5,
    convergenceRate: 0.05,
    maxGrowth: 10,
    lowConfidenceYears: 5,
    ...options,
  };
  const states = records.filter((r) => r.kind === 'state');

  // Tiers: GDP-per-capita quartiles among states with data.
  const incomes = states
    .map((r) => r.fields['economy.gdp_per_capita_ppp']?.value)
    .filter((v): v is number => v !== undefined);
  const cuts = [0.25, 0.5, 0.75].map((q) => quantile(incomes, q));
  const tierOf = (r: CountryRecord): number | null => {
    const income = r.fields['economy.gdp_per_capita_ppp']?.value;
    return income === undefined ? null : cuts.filter((c) => income > c).length;
  };

  // Tier medians of observed values, per field (tier null -> all states).
  const medians = new Map<string, number>();
  const targetFor = (field: string, tier: number | null): number | undefined => {
    const key = `${field}|${tier ?? 'all'}`;
    if (!medians.has(key)) {
      const values = states
        .filter((s) => tier === null || tierOf(s) === tier)
        .map((s) => s.fields[field]?.value)
        .filter((v): v is number => v !== undefined);
      if (values.length > 0) medians.set(key, median(values));
    }
    return medians.get(key);
  };

  return records.map((record) => {
    const tier = tierOf(record);
    const fields: Record<string, ProjectedValue> = {};
    const growth = realGrowth(record, opts.maxGrowth);
    const popGrowth =
      record.fields['population.growth_rate']?.value ??
      targetFor('population.growth_rate', tier) ??
      0;

    for (const spec of FIELDS) {
      const obs = record.fields[spec.id];
      if (obs === undefined) continue;
      const years = obs.estYear === null ? 0 : Math.max(0, opts.targetYear - obs.estYear);
      const value = projectValue(spec, obs.value, years, {
        growth,
        popGrowth,
        dollarInflation: opts.dollarInflation,
        convergenceRate: opts.convergenceRate,
        target: spec.projection === 'converge' ? targetFor(spec.id, tier) : undefined,
      });
      fields[spec.id] = {
        value: tidy(value),
        observed: obs.value,
        estYear: obs.estYear,
        method: years === 0 ? 'observed' : spec.projection,
        projectionYears: years,
        lowConfidence: years > opts.lowConfidenceYears,
      };
    }

    renormalizeSectors(record, fields);
    addDerived(record, fields);
    return { ...record, tier, fields };
  });
}

interface Rates {
  readonly growth: number;
  readonly popGrowth: number;
  readonly dollarInflation: number;
  readonly convergenceRate: number;
  readonly target: number | undefined;
}

function projectValue(spec: FieldSpec, value: number, years: number, rates: Rates): number {
  if (years === 0) return value;
  switch (spec.projection) {
    case 'population':
      return value * (1 + rates.popGrowth / 100) ** years;
    case 'real-output':
      return value * (1 + rates.growth / 100) ** years;
    case 'nominal-usd':
      return value * ((1 + rates.growth / 100) * (1 + rates.dollarInflation / 100)) ** years;
    case 'per-capita-output':
      return value * ((1 + rates.growth / 100) / (1 + rates.popGrowth / 100)) ** years;
    case 'converge': {
      if (rates.target === undefined) return value;
      const cap = spec.maxChangePerYear ?? Infinity;
      let v = value;
      for (let y = 0; y < years; y++) {
        const step = rates.convergenceRate * (rates.target - v);
        v += Math.max(-cap, Math.min(cap, step));
      }
      return Math.max(spec.range[0], Math.min(spec.range[1], v));
    }
    case 'carry':
      return value;
  }
}

/**
 * Trend real GDP growth: the median of the latest three yearly values, skipping 2020–2021
 * (the pandemic shock and rebound would dominate otherwise), clamped to ±maxGrowth.
 */
function realGrowth(record: CountryRecord, maxGrowth: number): number {
  const obs = record.fields['economy.gdp_growth'];
  if (obs === undefined) return 0;
  const yearly = [...(obs.history ?? []), { year: obs.estYear, value: obs.value }];
  const usable = yearly.filter((y) => y.year === null || y.year < 2020 || y.year > 2021);
  const values = (usable.length > 0 ? usable : yearly).slice(-3).map((y) => y.value);
  return Math.max(-maxGrowth, Math.min(maxGrowth, median(values)));
}

/** Keeps the three sector shares summing to what they summed to as published. */
function renormalizeSectors(record: CountryRecord, fields: Record<string, ProjectedValue>): void {
  const ids = ['economy.sector_agriculture', 'economy.sector_industry', 'economy.sector_services'];
  const projected = ids.map((id) => fields[id]);
  const observed = ids.map((id) => record.fields[id]?.value);
  if (projected.some((p) => p === undefined) || observed.some((o) => o === undefined)) return;
  const targetSum = (observed as number[]).reduce((a, b) => a + b, 0);
  const sum = (projected as ProjectedValue[]).reduce((a, p) => a + p.value, 0);
  if (sum <= 0) return;
  ids.forEach((id, i) => {
    const p = projected[i] as ProjectedValue;
    fields[id] = { ...p, value: tidy((p.value * targetSum) / sum) };
  });
}

function addDerived(record: CountryRecord, fields: Record<string, ProjectedValue>): void {
  const derived = (
    id: string,
    value: number | null,
    from: readonly (ProjectedValue | undefined)[],
  ) => {
    if (value === null || !Number.isFinite(value)) return;
    const years = Math.max(0, ...from.map((f) => f?.projectionYears ?? 0));
    fields[id] = {
      value: tidy(value),
      observed: null,
      estYear: null,
      method: 'derived',
      projectionYears: years,
      lowConfidence: from.some((f) => f?.lowConfidence === true),
    };
  };
  const share = (a?: ProjectedValue, b?: ProjectedValue) =>
    a === undefined || b === undefined ? null : (100 * a.value) / b.value;

  const nominal = fields['economy.gdp_nominal'];
  derived('economy.exports_share_gdp', share(fields['economy.exports'], nominal), [
    fields['economy.exports'],
    nominal,
  ]);
  derived('economy.imports_share_gdp', share(fields['economy.imports'], nominal), [
    fields['economy.imports'],
    nominal,
  ]);
  const rail = fields['transport.railways_km'];
  const area = fields['geography.area_km2'];
  derived('transport.railway_density', rail && area ? (1000 * rail.value) / area.value : null, [
    rail,
    area,
  ]);
  derived('society.ethnic_fractionalization', fractionalization(record.ethnicGroups), []);
  derived('society.religious_fractionalization', fractionalization(record.religions), []);
  derived('geography.border_count', record.borders.length, []);
  const revenues = fields['economy.budget_revenues'];
  const expenditures = fields['economy.budget_expenditures'];
  derived('economy.revenue_share_gdp', share(revenues, nominal), [revenues, nominal]);
  derived('economy.expenditure_share_gdp', share(expenditures, nominal), [expenditures, nominal]);
  derived(
    'economy.budget_balance_share',
    revenues && expenditures && nominal
      ? (100 * (revenues.value - expenditures.value)) / nominal.value
      : null,
    [revenues, expenditures, nominal],
  );
  const labor = fields['economy.labor_force'];
  const population = fields['population.total'];
  const young = fields['population.age_0_14_share'];
  derived(
    'economy.labor_participation',
    labor && population && young
      ? (100 * labor.value) / (population.value * (1 - young.value / 100))
      : null,
    [labor, population, young],
  );
  const account = fields['economy.current_account'];
  derived('economy.current_account_share', share(account, nominal), [account, nominal]);
  const troops = fields['military.active_personnel'];
  const people = fields['population.total'];
  derived(
    'military.personnel_per_1000',
    troops && people ? (1000 * troops.value) / people.value : null,
    [troops, people],
  );
}

/** Rounds away floating-point noise so outputs diff cleanly. */
function tidy(value: number): number {
  return Number(value.toPrecision(10));
}
