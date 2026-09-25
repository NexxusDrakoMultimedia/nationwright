// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BIOME,
  defaultSettings,
  fnv1a64,
  generateWorld,
  GENERATOR_VERSION,
  parseSeed,
  validateSettings,
  type GeneratedWorld,
  type GuidingVariables,
} from '../../src/index.ts';

const guiding = JSON.parse(
  readFileSync(
    new URL('../../../reference-data/data/guiding-variables-2026.json', import.meta.url),
    'utf8',
  ),
) as GuidingVariables;
const blocklist = JSON.parse(
  readFileSync(
    new URL('../../../reference-data/data/name-blocklist.json', import.meta.url),
    'utf8',
  ),
) as string[];

function seed(text: string): bigint {
  const r = parseSeed(text);
  if (!r.ok) throw new Error(text);
  return r.seed;
}

/** A stable fingerprint of everything the generator decides. */
function fingerprint(world: GeneratedWorld): string {
  const { map } = world;
  const parts = [
    Buffer.from(map.grid.x.buffer).toString('base64'),
    Buffer.from(map.terrain.elevation.buffer).toString('base64'),
    Buffer.from(map.terrain.biome.buffer).toString('base64'),
    Buffer.from(map.hydrology.river.buffer).toString('base64'),
    Buffer.from(map.owner.buffer).toString('base64'),
    Buffer.from(map.province.buffer).toString('base64'),
    JSON.stringify(world.countries),
    JSON.stringify(world.cities),
  ];
  return fnv1a64(parts.join('|')).toString(16);
}

const SEEDS = ['q3Zk1d0XbAc', 'AAAAAAAAAAE', 'Zm9vYmFyMDA', 'n4tionwr1gE', 'W0rldSeed0A'];
const worlds = SEEDS.map((s) => generateWorld(seed(s), defaultSettings(), guiding, blocklist));

describe('generateWorld', () => {
  it('is deterministic', () => {
    const again = generateWorld(seed(SEEDS[0]!), defaultSettings(), guiding, blocklist);
    expect(fingerprint(again)).toBe(fingerprint(worlds[0]!));
    expect(fingerprint(worlds[1]!)).not.toBe(fingerprint(worlds[0]!));
  });

  // Golden master: pins generator v4. If this changes, bump GENERATOR_VERSION and update.
  it('matches the golden master for generator v4', () => {
    expect(GENERATOR_VERSION).toBe(4);
    expect(fingerprint(worlds[0]!)).toMatchInlineSnapshot(`"854dabccd510948d"`);
  });

  it.each(SEEDS.map((s, i) => [s, i] as const))('builds a consistent world for %s', (_, i) => {
    const world = worlds[i]!;
    const { grid, terrain, owner, province, population } = world.map;
    const n = world.countries.length;
    expect(n).toBe(196);

    let land = 0;
    for (let c = 0; c < grid.count; c++) {
      if (terrain.land[c] === 1) {
        land++;
        expect(owner[c]).toBeGreaterThanOrEqual(0);
        expect(province[c]).toBeGreaterThanOrEqual(0);
      } else {
        expect(owner[c]).toBe(-1);
        expect(terrain.biome[c]).toBe(BIOME.ocean);
      }
    }
    expect(Math.abs(land / grid.count - 0.292)).toBeLessThan(0.002);

    const people = new Float64Array(n);
    for (let c = 0; c < grid.count; c++) if (owner[c]! >= 0) people[owner[c]!]! += population[c]!;
    for (const country of world.countries) {
      expect(owner[country.capitalCell]).toBe(country.id);
      expect(country.cellCount).toBeGreaterThan(0);
      expect(people[country.id]! / country.nation.stats['population.total']!).toBeCloseTo(1, 6);
      for (const j of country.neighbors)
        expect(world.countries[j]!.neighbors).toContain(country.id);
      expect(country.island).toBe(country.neighbors.length === 0);
    }
    const capitals = world.cities.filter((c) => c.capital);
    expect(capitals).toHaveLength(n);
    for (const city of world.cities) expect(owner[city.cell]).toBe(city.country);
  });

  it('reproduces real-world political geography on average', () => {
    const avg = (f: (w: GeneratedWorld) => number) =>
      worlds.reduce((s, w) => s + f(w), 0) / worlds.length;
    const share = (w: GeneratedWorld, pred: (c: GeneratedWorld['countries'][number]) => boolean) =>
      w.countries.filter(pred).length / w.countries.length;
    const island = avg((w) => share(w, (c) => c.island));
    const landlocked = avg((w) => share(w, (c) => c.landlocked));
    const oneNeighbour = avg((w) => share(w, (c) => c.neighbors.length === 1));
    expect(Math.abs(island - guiding.structure.islandShare)).toBeLessThan(0.06);
    expect(Math.abs(landlocked - guiding.structure.landlockedShare)).toBeLessThan(0.1);
    expect(Math.abs(oneNeighbour - (guiding.structure.neighborCounts['1'] ?? 0))).toBeLessThan(
      0.08,
    );
    expect(avg((w) => w.continentCount)).toBeGreaterThanOrEqual(3);
  });

  it('validates settings', () => {
    expect(() => validateSettings({ ...defaultSettings(), countryCount: 1 })).toThrow(RangeError);
    expect(() => validateSettings({ ...defaultSettings(), landFraction: 0.01 })).toThrow(
      RangeError,
    );
    expect(() => validateSettings({ ...defaultSettings(), cellsPerCountry: 5 })).toThrow(
      RangeError,
    );
    expect(() => validateSettings({ ...defaultSettings(), climateBias: 50 })).toThrow(RangeError);
  });

  it('handles small and large worlds', () => {
    const small = generateWorld(
      seed(SEEDS[0]!),
      { ...defaultSettings(), countryCount: 20 },
      guiding,
    );
    expect(small.countries).toHaveLength(20);
    const large = generateWorld(
      seed(SEEDS[0]!),
      { ...defaultSettings(), countryCount: 400, cellsPerCountry: 60 },
      guiding,
    );
    expect(large.countries).toHaveLength(400);
  });
});
