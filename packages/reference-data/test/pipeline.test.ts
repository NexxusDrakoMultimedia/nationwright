// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FIELDS,
  GUIDING_MODEL_VERSION,
  PIPELINE_VERSION,
  SOURCE,
  parseProfile,
  projectAll,
  readProfiles,
  resolveBorders,
  runPipeline,
  type CountryRecord,
  type ExtractIssue,
} from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const dataDir = join(here, '..', 'data');

function fixture(region: string, code: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, region, `${code}.json`), 'utf8'));
}

function parse(region: 'europe' | 'africa' | 'antarctica', code: string): CountryRecord {
  const issues: ExtractIssue[] = [];
  const record = parseProfile(code, region, fixture(region, code), issues);
  expect(issues).toEqual([]);
  return record;
}

describe('parseProfile', () => {
  it('parses Austria', () => {
    const au = parse('europe', 'au');
    expect(au).toMatchObject({ code: 'au', name: 'Austria', kind: 'state', landlocked: true });
    expect(au.governmentCategory).toBe('parliamentary republic');
    expect(au.fields['population.total']).toEqual({ value: 9174390, estYear: 2025 });
    expect(au.fields['geography.area_km2']).toEqual({ value: 83871, estYear: null });
    expect(au.fields['population.tfr']).toEqual({ value: 1.35, estYear: 2025 });
    expect(au.fields['economy.gdp_growth']).toEqual({
      value: -1.2,
      estYear: 2024,
      history: [
        { year: 2022, value: 5.3 },
        { year: 2023, value: -1 },
      ],
    });
    expect(au.fields['economy.gdp_nominal']?.value).toBe(521642000000);
    expect(au.borders).toHaveLength(8);
    expect(au.borders[0]).toEqual({ name: 'Czech Republic', code: null, km: 402 });
    expect(au.religions[0]).toEqual({ label: 'Roman Catholic', share: 55.2 });
  });

  it('parses Nigeria, which has languages without shares', () => {
    const ni = parse('africa', 'ni');
    expect(ni.landlocked).toBe(false);
    expect(ni.governmentCategory).toBe('presidential republic');
    expect(ni.fields['education.literacy']).toEqual({ value: 63.2, estYear: 2021 });
    expect(ni.languages[0]).toEqual({ label: 'English', share: null });
  });

  it('classifies dependencies, uninhabited places, and the EU', () => {
    expect(parse('europe', 'gi').kind).toBe('territory');
    expect(parse('antarctica', 'bv').kind).toBe('excluded');
    expect(parseProfile('ee', 'europe', fixture('europe', 'ee'), []).kind).toBe('excluded');
  });
});

describe('resolveBorders', () => {
  it('matches names, aliases, and names with a parenthetical', () => {
    const au = parse('europe', 'au');
    const records: CountryRecord[] = [
      {
        ...au,
        borders: [
          { name: 'Nigeria', code: null, km: 1 },
          { name: 'Monaco (east)', code: null, km: 2 },
          { name: 'Holy See', code: null, km: 3 },
          { name: 'Atlantis', code: null, km: 4 },
        ],
      },
      parse('africa', 'ni'),
      parse('europe', 'mn'),
    ];
    expect(resolveBorders(records).filter((u) => u.from === 'au')).toEqual([
      { from: 'au', name: 'Atlantis' },
    ]);
    expect(records[0]?.borders.map((b) => b.code)).toEqual(['ni', 'mn', 'vt', null]);
  });
});

describe('projectAll', () => {
  const records = [parse('europe', 'au'), parse('africa', 'ni'), parse('europe', 'mn')];
  const [au, ni] = projectAll(records, { targetYear: 2026 });

  it('compounds population by the growth rate', () => {
    const pop = au?.fields['population.total'];
    expect(pop).toMatchObject({
      observed: 9174390,
      estYear: 2025,
      method: 'population',
      projectionYears: 1,
    });
    expect(pop?.value).toBeCloseTo(9174390 * 1.0028, 0);
  });

  it('grows nominal dollars by real growth plus dollar inflation only', () => {
    // Nigeria's ~33% local inflation must not inflate its dollar GDP.
    const gdp = ni?.fields['economy.gdp_nominal'];
    expect(gdp?.method).toBe('nominal-usd');
    expect(gdp?.value).toBeCloseTo(187.76e9 * (1.033 * 1.025) ** 2, -7);
  });

  it('caps convergence per year and keeps sector shares summing as published', () => {
    const tfr = ni?.fields['population.tfr'];
    expect(tfr?.method).toBe('converge');
    expect(Math.abs((tfr?.value ?? 0) - 4.59)).toBeLessThanOrEqual(0.05 + 1e-9);
    const sum = ['agriculture', 'industry', 'services']
      .map((s) => au?.fields[`economy.sector_${s}`]?.value ?? 0)
      .reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.2 + 23.1 + 65.3, 6);
  });

  it('flags long projections as low-confidence and adds derived indicators', () => {
    expect(ni?.fields['population.total']?.lowConfidence).toBe(false);
    expect(au?.fields['geography.border_count']?.value).toBe(8);
    expect(au?.fields['economy.exports_share_gdp']?.method).toBe('derived');
  });
});

describe('runPipeline', () => {
  const profiles = readProfiles(fixtures, { allowMissingRegions: true });

  it('is deterministic', () => {
    const a = runPipeline(profiles, { targetYear: 2026 });
    const b = runPipeline(readProfiles(fixtures, { allowMissingRegions: true }), {
      targetYear: 2026,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('drops excluded entities from the snapshot and counts them', () => {
    const result = runPipeline(profiles, { targetYear: 2026 });
    expect(result.snapshot.countries.map((c) => c.code)).toEqual(['au', 'gi', 'mn', 'ni']);
    expect(result.manifest.entities).toEqual({ state: 3, territory: 1, excluded: 2 });
    expect(result.bands.bands).toEqual([]); // three states are too few for bands
  });
});

describe('committed data', () => {
  const manifest = JSON.parse(readFileSync(join(dataDir, 'manifest.json'), 'utf8')) as {
    pipelineVersion: number;
    source: { commit: string };
    targetYear: number;
  };

  it('was built from the pinned source with the current pipeline', () => {
    expect(manifest.source.commit).toBe(SOURCE.commit);
    expect(manifest.pipelineVersion).toBe(PIPELINE_VERSION);
  });

  it('has a guiding-variables model from the current fitter', () => {
    const guiding = JSON.parse(
      readFileSync(join(dataDir, `guiding-variables-${manifest.targetYear}.json`), 'utf8'),
    ) as { modelVersion: number; pipelineVersion: number; archetypes: unknown[] };
    expect(guiding.modelVersion).toBe(GUIDING_MODEL_VERSION);
    expect(guiding.pipelineVersion).toBe(PIPELINE_VERSION);
    expect(guiding.archetypes.length).toBeGreaterThanOrEqual(4);
  });

  it('has bands for the core indicators', () => {
    const file = JSON.parse(
      readFileSync(join(dataDir, `validation-bands-${manifest.targetYear}.json`), 'utf8'),
    ) as { bands: { id: string; n: number; min: number; p10: number; p90: number; max: number }[] };
    const ids = file.bands.map((b) => b.id);
    for (const id of [
      'population.total',
      'population.tfr',
      'population.life_expectancy',
      'economy.gdp_per_capita_ppp',
    ]) {
      expect(ids).toContain(id);
    }
    for (const band of file.bands) {
      expect(band.n).toBeGreaterThanOrEqual(20);
      expect(band.min <= band.p10 && band.p10 <= band.p90 && band.p90 <= band.max).toBe(true);
    }
    expect(FIELDS.length).toBeGreaterThan(30);
  });
});
