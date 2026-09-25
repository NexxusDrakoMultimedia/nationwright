// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The reference-data pipeline (DESIGN.md §10.1):
 *   read (pinned factbook.json) → parse → classify → project → bands → outputs.
 * Outputs are deterministic for a given source commit and target year.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeBands, MIN_BAND_SIZE, type Band } from './bands.ts';
import { parseProfile, resolveBorders, type CountryRecord, type EntityKind } from './country.ts';
import { FIELDS, type ExtractIssue } from './fields.ts';
import type { GuidingVariables } from '@nationwright/engine';
import { fitGuidingVariables } from './fit.ts';
import { projectAll, type ProjectedCountry, type ProjectionOptions } from './project.ts';
import { REGION_DIRECTORIES, SOURCE } from './source.ts';

/** Bump whenever parsing, projection, or band rules change the outputs. */
export const PIPELINE_VERSION = 1;

export interface PipelineResult {
  readonly manifest: Manifest;
  readonly snapshot: Snapshot;
  readonly bands: BandsFile;
  /** Null when there are too few states to fit a model (test fixtures). */
  readonly guiding: GuidingVariables | null;
  readonly issues: readonly ExtractIssue[];
  readonly warnings: readonly ConsistencyWarning[];
}

export interface ConsistencyWarning {
  readonly code: string;
  readonly name: string;
  readonly check: string;
  readonly detail: string;
}

/** Published figures that disagree with each other by more than this are listed. */
export const CONSISTENCY_TOLERANCE = 0.25;

/** Flags states whose published totals and per-head values disagree. */
export function consistencyWarnings(records: readonly CountryRecord[]): ConsistencyWarning[] {
  const warnings: ConsistencyWarning[] = [];
  for (const r of records) {
    if (r.kind !== 'state') continue;
    const gdp = r.fields['economy.gdp_ppp_real']?.value;
    const pop = r.fields['population.total']?.value;
    const perCapita = r.fields['economy.gdp_per_capita_ppp']?.value;
    if (gdp === undefined || pop === undefined || perCapita === undefined) continue;
    const implied = gdp / pop;
    if (Math.abs(implied / perCapita - 1) > CONSISTENCY_TOLERANCE) {
      warnings.push({
        code: r.code,
        name: r.name,
        check: 'GDP per capita vs GDP ÷ population',
        detail: `published ${Math.round(perCapita)}, implied ${Math.round(implied)}`,
      });
    }
  }
  return warnings;
}

export interface Manifest {
  readonly pipelineVersion: number;
  readonly targetYear: number;
  readonly source: typeof SOURCE;
  readonly entities: Readonly<Record<EntityKind, number>>;
  /** Share of states with a value, per field (0–1). */
  readonly stateCoverage: Readonly<Record<string, number>>;
  readonly parseIssues: number;
}

export interface Snapshot {
  readonly pipelineVersion: number;
  readonly targetYear: number;
  readonly sourceCommit: string;
  readonly countries: readonly ProjectedCountry[];
}

export interface BandsFile {
  readonly pipelineVersion: number;
  readonly targetYear: number;
  readonly sourceCommit: string;
  readonly population: 'states';
  readonly bands: readonly Band[];
}

/** Reads every country profile under `sourceDir`, sorted by region then code. */
export function readProfiles(
  sourceDir: string,
  options: { allowMissingRegions?: boolean } = {},
): { code: string; region: (typeof REGION_DIRECTORIES)[number]; raw: unknown }[] {
  const profiles = [];
  for (const region of REGION_DIRECTORIES) {
    if (options.allowMissingRegions === true && !existsSync(join(sourceDir, region))) continue;
    const files = readdirSync(join(sourceDir, region))
      .filter((f) => f.endsWith('.json'))
      .sort();
    for (const file of files) {
      const raw: unknown = JSON.parse(readFileSync(join(sourceDir, region, file), 'utf8'));
      profiles.push({ code: file.slice(0, -'.json'.length), region, raw });
    }
  }
  return profiles;
}

export function runPipeline(
  profiles: readonly { code: string; region: (typeof REGION_DIRECTORIES)[number]; raw: unknown }[],
  options: ProjectionOptions,
): PipelineResult {
  const issues: ExtractIssue[] = [];
  const records: CountryRecord[] = profiles
    .map((p) => parseProfile(p.code, p.region, p.raw, issues))
    .sort((a, b) => (a.code < b.code ? -1 : 1));
  for (const { from, name } of resolveBorders(records)) {
    issues.push({ field: `${from}:geography.borders`, text: name, reason: 'unknown neighbour' });
  }
  const projected = projectAll(records, options).filter((c) => c.kind !== 'excluded');

  const entities: Record<EntityKind, number> = { state: 0, territory: 0, excluded: 0 };
  for (const r of records) entities[r.kind] += 1;
  const states = records.filter((r) => r.kind === 'state');
  const stateCoverage = Object.fromEntries(
    FIELDS.map((f) => [
      f.id,
      Number(
        (states.filter((s) => s.fields[f.id] !== undefined).length / states.length).toFixed(3),
      ),
    ]),
  );

  const header = {
    pipelineVersion: PIPELINE_VERSION,
    targetYear: options.targetYear,
    sourceCommit: SOURCE.commit,
  };
  return {
    manifest: {
      pipelineVersion: PIPELINE_VERSION,
      targetYear: options.targetYear,
      source: SOURCE,
      entities,
      stateCoverage,
      parseIssues: issues.length,
    },
    snapshot: { ...header, countries: projected },
    bands: { ...header, population: 'states', bands: computeBands(projected) },
    guiding:
      projected.filter((c) => c.kind === 'state').length >= MIN_BAND_SIZE
        ? fitGuidingVariables(projected, header)
        : null,
    issues: issues.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0)),
    warnings: consistencyWarnings(records),
  };
}

/** A human-readable report for reviewing a pipeline run as a code change. */
export function renderReport(result: PipelineResult): string {
  const { manifest, bands, issues, warnings, guiding } = result;
  const lines = [
    `# Reference data report — target year ${manifest.targetYear}`,
    '',
    `Generated by \`packages/reference-data\` (pipeline v${manifest.pipelineVersion}) from`,
    `[factbook.json](${manifest.source.repository}) at commit \`${manifest.source.commit}\``,
    `(${manifest.source.license}; last data update ${manifest.source.lastDataUpdate}).`,
    '',
    '## Entities',
    '',
    `| Kind | Count |`,
    `|---|---|`,
    ...Object.entries(manifest.entities).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Validation bands (states)',
    '',
    '| Indicator | Unit | n | low-conf. | min | p10 | median | p90 | max |',
    '|---|---|---|---|---|---|---|---|---|',
    ...bands.bands.map(
      (b) =>
        `| \`${b.id}\` | ${b.unit} | ${b.n} | ${b.lowConfidence} | ${fmt(b.min)} | ${fmt(b.p10)} | ${fmt(b.p50)} | ${fmt(b.p90)} | ${fmt(b.max)} |`,
    ),
    '',
    ...(guiding === null ? [] : archetypeSection(guiding)),
    '## Field coverage (share of states with a value)',
    '',
    '| Field | Coverage |',
    '|---|---|',
    ...Object.entries(manifest.stateCoverage).map(
      ([k, v]) => `| \`${k}\` | ${(v * 100).toFixed(1)}% |`,
    ),
    '',
    `## Consistency warnings (${warnings.length})`,
    '',
    'Published figures that disagree with each other by more than',
    `${CONSISTENCY_TOLERANCE * 100}%. Values are kept as published; review before relying on them.`,
    '',
    ...(warnings.length === 0
      ? ['None.']
      : [
          '| Code | Country | Check | Detail |',
          '|---|---|---|---|',
          ...warnings.map((w) => `| ${w.code} | ${w.name} | ${w.check} | ${w.detail} |`),
        ]),
    '',
    `## Unparsed values (${issues.length})`,
    '',
    ...(issues.length === 0
      ? ['None.']
      : [
          '| Field | Reason | Text |',
          '|---|---|---|',
          ...issues.map(
            (i) =>
              `| \`${i.field}\` | ${i.reason} | ${i.text.replaceAll('|', '\\|').slice(0, 160)} |`,
          ),
        ]),
    '',
  ];
  return lines.join('\n');
}

function archetypeSection(guiding: GuidingVariables): string[] {
  return [
    `## Archetypes (${guiding.archetypes.length}; guiding-variables model v${guiding.modelVersion})`,
    '',
    '| # | Label | Share of states | Top government type | Landlocked | Island |',
    '|---|---|---|---|---|---|',
    ...guiding.archetypes.map((a) => {
      const top = Object.entries(a.governmentCategories).sort((x, y) => y[1] - x[1])[0];
      return `| ${a.id} | ${a.label} | ${(a.weight * 100).toFixed(1)}% | ${top?.[0] ?? '–'} | ${(a.landlockedShare * 100).toFixed(0)}% | ${(a.islandShare * 100).toFixed(0)}% |`;
    }),
    '',
    `Bordering states share an archetype ${(guiding.spatial.archetypeAgreement * 100).toFixed(1)}% of the time (chance: ${(guiding.spatial.archetypeAgreementChance * 100).toFixed(1)}%).`,
    '',
  ];
}

function fmt(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toPrecision(3)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toPrecision(3)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toPrecision(3)}M`;
  if (abs >= 1e4) return Math.round(value).toLocaleString('en-US');
  return String(Number(value.toPrecision(4)));
}
