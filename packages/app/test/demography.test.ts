// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { summarize } from '@nationwright/engine';
import { bandPosition, buildCensus, formatCensus, WorldSession } from '../src/index.ts';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'nationwright-demography-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const now = () => new Date('2026-09-25T12:00:00Z');
const settings = { countryCount: 40, cellsPerCountry: 60 };
const create = (name: string, seed = 'q3Zk1d0XbAc') =>
  WorldSession.create({ path: join(dir, name), seed, startYear: 2026, now, settings });

describe('demography system', () => {
  it('builds the player’s nation from its provinces and statistics', () => {
    const session = create('a.nwsave');
    const world = session.engine.world.slices.world!;
    const slice = session.engine.world.slices.demography!;
    const generated = session.engine.generated!;
    const country = generated.countries[slice.country]!;
    expect(slice.country).toBe(world.playerCountry);
    expect(slice.regions.map((r) => r.province)).toEqual(
      Array.from({ length: country.provinceCount }, (_, k) => country.firstProvince + k),
    );
    const stats = world.countries[slice.country]!.stats;
    const s = summarize(slice.regions.map((r) => r.cohorts));
    expect(s.total / stats['population.total']!).toBeCloseTo(1, 6);
    expect((100 * s.urban) / s.total).toBeCloseTo(stats['population.urban_share']!, 0);
    session.close();
  });

  it('records national and regional indicators', () => {
    const session = create('b.nwsave');
    session.advance(24);
    const indicators = session.engine.indicators;
    expect(indicators.series('population.total', 'nation').ticks).toHaveLength(24);
    expect(indicators.series('population.tfr', 'nation').ticks).toEqual([0, 11, 23]);
    expect(indicators.series('population.birth_rate', 'nation').ticks).toEqual([11, 23]);
    expect(indicators.series('population.total', 'region:0').ticks).toHaveLength(24);
    const births = indicators.series('population.births', 'nation').values;
    expect(births.every((b) => b > 0)).toBe(true);
    session.close();
  });

  it('tracks the player’s cities as shares of their regions’ urban population', () => {
    const session = create('e.nwsave');
    session.advance(12);
    const demography = session.engine.world.slices.demography!;
    const { cities } = session.engine.world.slices.cities!;
    const generated = session.engine.generated!;
    expect(cities.map((c) => c.id)).toEqual(
      generated.cities.filter((c) => c.country === demography.country).map((c) => c.id),
    );
    demography.regions.forEach((region, r) => {
      const urban = summarize([region.cohorts]).urban;
      const inCities = cities.filter((c) => c.region === r).reduce((s, c) => s + c.population, 0);
      expect(inCities).toBeLessThanOrEqual(urban + 1e-6);
    });
    const capital = cities.find((c) => c.capital)!;
    expect(session.engine.indicators.series('city.population', `city:${capital.id}`).ticks).toEqual(
      [0, 11],
    );
    session.close();
  });

  it('resumes from a save exactly as if it had never stopped', () => {
    const straight = create('c.nwsave');
    straight.advance(30);
    const expected = JSON.stringify(straight.engine.world.slices);
    straight.close();

    const first = create('d.nwsave');
    first.advance(13);
    first.close();
    const resumed = WorldSession.open(join(dir, 'd.nwsave'), { now });
    resumed.advance(17);
    expect(JSON.stringify(resumed.engine.world.slices)).toBe(expected);
    resumed.close();
  });
});

describe('census', () => {
  it('reports the nation consistently with its state', () => {
    const session = create('census.nwsave');
    session.advance(12);
    const census = buildCensus(session.engine);
    const demography = session.engine.world.slices.demography!;
    const total = summarize(demography.regions.map((r) => r.cohorts)).total;
    expect(census.pyramid.reduce((s, b) => s + b.female + b.male, 0)).toBeCloseTo(total, 3);
    expect(census.regions.reduce((s, r) => s + r.population, 0)).toBeCloseTo(total, 3);
    for (const groups of [census.ethnicGroups, census.religions, census.languages]) {
      expect(groups.reduce((s, g) => s + g.share, 0)).toBeCloseTo(1, 9);
      expect(new Set(groups.map((g) => g.name)).size).toBe(groups.length);
    }
    expect(census.religions.filter((g) => /religio/i.test(g.name)).length).toBeLessThanOrEqual(1);
    const population = census.stats.find((s) => s.id === 'population.total')!;
    expect(population.value).toBeCloseTo(total, 3);
    expect(population.band).not.toBeNull();
    expect(census.stats.find((s) => s.id === 'population.birth_rate')!.value).not.toBeNull();
    expect(census.date).toBe('end of December 2026');
    const text = formatCensus(census).join('\n');
    expect(text).toContain(`Census of ${census.country}`);
    expect(text).toContain('Population pyramid');
    session.close();
  });

  it('places values against the real-world band', () => {
    const band = { min: 1, p10: 2, p90: 8, max: 10 };
    expect(bandPosition(0.5, band)).toBe('below');
    expect(bandPosition(1.5, band)).toBe('low');
    expect(bandPosition(5, band)).toBe('typical');
    expect(bandPosition(9, band)).toBe('high');
    expect(bandPosition(11, band)).toBe('above');
  });
});
