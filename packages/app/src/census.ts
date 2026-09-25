// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The census report (DESIGN.md §4.1 outputs, TODO M2): the player's nation at the current
 * date, with each headline figure placed against the real-world range of states from the
 * validation bands (§10.1). Built from state and indicators only; shared by the desktop
 * app and the CLI.
 */

import {
  AGE_BANDS,
  bandLabel,
  cohortsOf,
  composition,
  dateOfTick,
  EDUCATION_LEVELS,
  formatDate,
  fractionalization,
  medianAge,
  NO_RELIGION,
  schoolingShare,
  summarize,
  type DeepReadonly,
  type Engine,
} from '@nationwright/engine';
import { VALIDATION_BANDS, type ValidationBand } from './reference.ts';
import type { CitiesSlice } from './systems/cities.ts';
import type { DemographySlice } from './systems/demography.ts';
import type { WorldSlice } from './systems/world.ts';

export type BandPosition = 'below' | 'low' | 'typical' | 'high' | 'above';

export interface CensusStat {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  /** null until the indicator has a value (yearly rates appear after the first December). */
  readonly value: number | null;
  /** The real-world spread across states (validation band), if there is one. */
  readonly band: Pick<ValidationBand, 'min' | 'p10' | 'p50' | 'p90' | 'max'> | null;
  /** below min, below p10, p10–p90, above p90, above max. */
  readonly position: BandPosition | null;
}

export interface CensusGroup {
  readonly name: string;
  readonly people: number;
  readonly share: number;
}

export interface Census {
  readonly country: string;
  readonly date: string;
  readonly stats: readonly CensusStat[];
  /** People by age band, youngest first. */
  readonly pyramid: readonly {
    readonly band: string;
    readonly female: number;
    readonly male: number;
  }[];
  /** Shares (0–1) of people 15+ and 25+ by education level. */
  readonly education: readonly {
    readonly level: string;
    readonly age15: number;
    readonly age25: number;
  }[];
  readonly ethnicGroups: readonly CensusGroup[];
  readonly religions: readonly CensusGroup[];
  readonly languages: readonly CensusGroup[];
  readonly regions: readonly {
    readonly name: string;
    readonly population: number;
    readonly urbanShare: number;
    readonly medianAge: number;
    readonly schooling: number;
    /** Net arrivals from other regions over the last 12 months. */
    readonly netInternalMigration: number;
  }[];
  readonly cities: readonly {
    readonly name: string;
    readonly region: string;
    readonly population: number;
    readonly capital: boolean;
  }[];
}

/** Headline figures: indicator id, band id, label. */
const HEADLINES: readonly (readonly [string, string, string])[] = [
  ['population.total', 'population.total', 'Population'],
  ['population.growth_rate', 'population.growth_rate', 'Population growth'],
  ['population.birth_rate', 'population.birth_rate', 'Birth rate'],
  ['population.death_rate', 'population.death_rate', 'Death rate'],
  ['population.net_migration_rate', 'population.net_migration_rate', 'Net migration rate'],
  ['population.tfr', 'population.tfr', 'Fertility rate'],
  ['population.life_expectancy', 'population.life_expectancy', 'Life expectancy'],
  ['population.infant_mortality', 'population.infant_mortality', 'Infant mortality'],
  ['population.median_age', 'population.median_age', 'Median age'],
  ['population.age_0_14_share', 'population.age_0_14_share', 'Aged 0–14'],
  ['population.age_65_plus_share', 'population.age_65_plus_share', 'Aged 65+'],
  ['population.urban_share', 'population.urban_share', 'Urban population'],
  ['education.any_schooling_share', 'education.literacy', 'Adults with schooling'],
  ['society.ethnic_fractionalization', 'society.ethnic_fractionalization', 'Ethnic diversity'],
  [
    'society.religious_fractionalization',
    'society.religious_fractionalization',
    'Religious diversity',
  ],
];

export function bandPosition(
  value: number,
  band: Pick<ValidationBand, 'min' | 'p10' | 'p90' | 'max'>,
): BandPosition {
  if (value < band.min) return 'below';
  if (value < band.p10) return 'low';
  if (value > band.max) return 'above';
  if (value > band.p90) return 'high';
  return 'typical';
}

function groups(
  counts: ReadonlyMap<number, number>,
  total: number,
  name: (id: number) => string,
): CensusGroup[] {
  return [...counts.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([id, n]) => ({ name: name(id), people: n, share: total > 0 ? n / total : 0 }));
}

export function buildCensus(engine: Engine): Census {
  const world = engine.world;
  // Typed through the systems' slice declarations (also visible to the renderer's check).
  const demography: DeepReadonly<DemographySlice> | undefined = world.slices.demography;
  const worldSlice: DeepReadonly<WorldSlice> | undefined = world.slices.world;
  const citiesSlice: DeepReadonly<CitiesSlice> | undefined = world.slices.cities;
  if (demography === undefined || worldSlice === undefined) {
    throw new Error('This world has no demography yet.');
  }
  const generated = engine.generated;
  const cultures = generated?.cultures;
  const indicators = engine.indicators;
  const bands = new Map(VALIDATION_BANDS.map((b) => [b.id, b]));
  // The latest value recorded at or before the current state.
  const latest = (id: string, scope: 'nation' | `region:${number}` = 'nation') =>
    indicators.latest(id, scope) ?? null;

  const stats: CensusStat[] = HEADLINES.map(([id, bandId, label]) => {
    const band = bands.get(bandId) ?? null;
    const value = latest(id);
    return {
      id,
      label,
      unit: indicators.definition(id)?.unit ?? '',
      value,
      band:
        band === null
          ? null
          : { min: band.min, p10: band.p10, p50: band.p50, p90: band.p90, max: band.max },
      position: band === null || value === null ? null : bandPosition(value, band),
    };
  });

  const nation = summarize(cohortsOf(demography.regions));
  const mix = composition(demography.combos, demography.regions);
  const all15 = nation.education15Plus.reduce((s, n) => s + n, 0);
  const all25 = nation.education25Plus.reduce((s, n) => s + n, 0);

  const internal = (r: number) => {
    const series = indicators.series('population.net_internal_migration', `region:${r}`);
    const from = world.meta.nextTick - 12;
    return series.values.reduce((s, v, i) => ((series.ticks[i] as number) >= from ? s + v : s), 0);
  };

  const cities = citiesSlice?.cities ?? [];
  return {
    country: worldSlice.countries[demography.country]?.name ?? 'Your nation',
    date: `end of ${formatDate(dateOfTick(world.meta.startYear, Math.max(0, world.meta.nextTick - 1)))}`,
    stats,
    pyramid: Array.from({ length: AGE_BANDS }, (_, a) => ({
      band: bandLabel(a),
      female: nation.byAgeSex[a]?.[0] ?? 0,
      male: nation.byAgeSex[a]?.[1] ?? 0,
    })),
    education: EDUCATION_LEVELS.map((level, e) => ({
      level,
      age15: all15 > 0 ? (nation.education15Plus[e] as number) / all15 : 0,
      age25: all25 > 0 ? (nation.education25Plus[e] as number) / all25 : 0,
    })),
    ethnicGroups: groups(
      mix.ethnic,
      mix.total,
      (id) => cultures?.ethnicGroups[id] ?? `Group ${id}`,
    ),
    religions: groups(mix.religion, mix.total, (id) =>
      id === NO_RELIGION ? 'No religion' : (cultures?.faiths[id] ?? `Faith ${id}`),
    ),
    languages: groups(mix.language, mix.total, (id) => cultures?.languages[id] ?? `Language ${id}`),
    regions: demography.regions.map((region, r) => {
      const s = summarize([region.cohorts]);
      return {
        name: region.name,
        population: s.total,
        urbanShare: s.total > 0 ? s.urban / s.total : 0,
        medianAge: medianAge(s),
        schooling: schoolingShare(s) / 100,
        netInternalMigration: internal(r),
      };
    }),
    cities: [...cities]
      .sort((a, b) => b.population - a.population || a.id - b.id)
      .map((c) => ({
        name: c.name,
        region: demography.regions[c.region]?.name ?? '',
        population: c.population,
        capital: c.capital,
      })),
  };
}

/** Diversity indices of the census groups (for reports that want them directly). */
export function diversity(census: Census): {
  ethnic: number;
  religious: number;
  linguistic: number;
} {
  const index = (gs: readonly CensusGroup[]) =>
    fractionalization(
      new Map(gs.map((g, i) => [i, g.people])),
      gs.reduce((s, g) => s + g.people, 0),
    );
  return {
    ethnic: index(census.ethnicGroups),
    religious: index(census.religions),
    linguistic: index(census.languages),
  };
}

const number = (n: number, digits = 1) =>
  n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const people = (n: number) => Math.round(n).toLocaleString('en-US');
const percent = (share: number) => `${number(100 * share)}%`;

const POSITION_TEXT: Readonly<Record<BandPosition, string>> = {
  below: 'below every real state',
  low: 'low (below the 10th percentile)',
  typical: 'typical',
  high: 'high (above the 90th percentile)',
  above: 'above every real state',
};

/** The census as plain-text lines (for the CLI). */
export function formatCensus(census: Census): string[] {
  const lines: string[] = [];
  const table = (rows: string[][]) => {
    const widths = (rows[0] ?? []).map((_, c) => Math.max(...rows.map((r) => (r[c] ?? '').length)));
    for (const row of rows) {
      lines.push(
        row
          .map((cell, c) => (c === 0 ? cell.padEnd(widths[c] ?? 0) : cell.padStart(widths[c] ?? 0)))
          .join('  ')
          .trimEnd(),
      );
    }
    lines.push('');
  };

  lines.push(`Census of ${census.country}, ${census.date}`, '');
  table([
    ['Indicator', 'Value', 'Real states (10th–90th pct)', 'Position'],
    ...census.stats.map((s) => {
      const format = (n: number) => (s.id === 'population.total' ? people(n) : number(n, 2));
      return [
        `${s.label} (${s.unit})`,
        s.value === null ? '—' : format(s.value),
        s.band === null ? '' : `${format(s.band.p10)} – ${format(s.band.p90)}`,
        s.position === null ? '' : POSITION_TEXT[s.position],
      ];
    }),
  ]);

  lines.push('Population pyramid');
  const widest = Math.max(1, ...census.pyramid.map((b) => Math.max(b.female, b.male)));
  const bar = (n: number) => '█'.repeat(Math.round((20 * n) / widest));
  for (const b of [...census.pyramid].reverse()) {
    lines.push(`${bar(b.female).padStart(20)} ${b.band.padStart(6)} ${bar(b.male)}`);
  }
  lines.push(`${'women'.padStart(20)} ${''.padStart(6)} men`, '');

  table([
    ['Education', 'Aged 15+', 'Aged 25+'],
    ...census.education.map((e) => [e.level, percent(e.age15), percent(e.age25)]),
  ]);

  for (const [title, gs] of [
    ['Ethnic groups', census.ethnicGroups],
    ['Religions', census.religions],
    ['Languages', census.languages],
  ] as const) {
    table([
      [title, 'People', 'Share'],
      ...gs.slice(0, 8).map((g) => [g.name, people(g.people), percent(g.share)]),
    ]);
  }

  table([
    ['Region', 'People', 'Urban', 'Median age', 'Schooled 15+', 'Net moves (12 mo)'],
    ...census.regions.map((r) => [
      r.name,
      people(r.population),
      percent(r.urbanShare),
      number(r.medianAge),
      percent(r.schooling),
      people(r.netInternalMigration),
    ]),
  ]);

  table([
    ['City', 'Region', 'People'],
    ...census.cities
      .slice(0, 15)
      .map((c) => [c.capital ? `${c.name} (capital)` : c.name, c.region, people(c.population)]),
  ]);
  return lines;
}
