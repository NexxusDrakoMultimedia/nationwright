// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createStream,
  defaultSettings,
  generateWorld,
  jointDistribution,
  nameHash,
  NameGuard,
  normalizeName,
  parseSeed,
  sharesFor,
  type GuidingVariables,
} from '../../src/index.ts';

const dataDir = new URL('../../../reference-data/data/', import.meta.url);
const guiding = JSON.parse(
  readFileSync(new URL('guiding-variables-2026.json', dataDir), 'utf8'),
) as GuidingVariables;
const blocklist = JSON.parse(
  readFileSync(new URL('name-blocklist.json', dataDir), 'utf8'),
) as string[];

describe('sharesFor', () => {
  it('sums to 1, floors at 1%, and hits the fractionalization target when feasible', () => {
    for (const [k, f] of [
      [1, 0.5],
      [2, 0.3],
      [4, 0.6],
      [8, 0.2],
      [3, 0],
    ] as const) {
      const s = sharesFor(k, f);
      expect(s).toHaveLength(k);
      expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      expect(Math.min(...s)).toBeGreaterThanOrEqual(k === 1 ? 1 : 0.0099);
      // With many groups the 1% floor can bind (8 groups can't reach 0.2 geometrically).
      if (k > 1 && k <= 4 && f > 0.1)
        expect(1 - s.reduce((a, x) => a + x * x, 0)).toBeCloseTo(f, 1);
    }
  });
});

describe('jointDistribution', () => {
  it('reproduces all three marginals', () => {
    const e = [0.7, 0.2, 0.1];
    const r = [0.5, 0.5];
    const l = [0.6, 0.3, 0.1];
    for (const a of [0, 0.5, 1]) {
      const t = jointDistribution(
        e,
        r,
        l,
        { ethnicReligion: a, ethnicLanguage: a, religionLanguage: a },
        createStream(1n, 'test/ipf'),
      );
      e.forEach((target, i) =>
        expect(t[i]!.flat().reduce((x, y) => x + y, 0)).toBeCloseTo(target, 6),
      );
      r.forEach((target, j) =>
        expect(t.reduce((x, plane) => x + plane[j]!.reduce((p, q) => p + q, 0), 0)).toBeCloseTo(
          target,
          6,
        ),
      );
      l.forEach((target, k) =>
        expect(t.reduce((x, plane) => x + plane.reduce((p, row) => p + row[k]!, 0), 0)).toBeCloseTo(
          target,
          6,
        ),
      );
    }
  });
});

describe('NameGuard', () => {
  it('blocks real country and capital names by hash', () => {
    const guard = new NameGuard(blocklist);
    for (const real of ['Austria', 'Nigeria', 'Vienna', "Côte d'Ivoire", 'Kyrgyzstan', 'Tokyo']) {
      expect(blocklist).toContain(nameHash(real));
      expect(guard.accept(real)).toBe(false);
    }
    expect(guard.accept('Thamora')).toBe(true);
    expect(guard.accept('Thamora')).toBe(false); // already used
  });

  it('blocks offensive substrings and very short names', () => {
    const guard = new NameGuard([]);
    expect(guard.accept('Nazikor')).toBe(false);
    expect(guard.accept('Ab')).toBe(false);
    expect(normalizeName('São Tomé-and Príncipe')).toBe('saotomeandprincipe');
  });
});

describe('world names and cultures', () => {
  const seed = (parseSeed('q3Zk1d0XbAc') as { seed: bigint }).seed;
  const world = generateWorld(seed, defaultSettings(), guiding, blocklist);

  it('gives every place a unique, fictional name', () => {
    const names = [
      ...world.countries.map((c) => c.name),
      ...world.countries.map((c) => c.demonym),
      ...world.cities.map((c) => c.name),
      ...world.provinceNames,
      ...world.cultures.faiths,
      ...world.cultures.languages,
    ];
    const blocked = new Set(blocklist);
    expect(names.filter((n) => blocked.has(nameHash(n)))).toEqual([]);
    const countryAndCity = [
      ...world.countries.map((c) => c.name),
      ...world.cities.map((c) => c.name),
    ].map(normalizeName);
    expect(new Set(countryAndCity).size).toBe(countryAndCity.length);
    for (const n of names) expect(n).toMatch(/^[A-Z][a-z]+(?: [a-z]+)*$|^Non-religious$/);
  });

  it('gives each country consistent culture tables', () => {
    for (const c of world.countries) {
      const { ethnic, religions, languages, joint } = c.culture;
      for (const groups of [ethnic, religions, languages]) {
        expect(groups.reduce((a, g) => a + g.share, 0)).toBeCloseTo(1, 9);
      }
      expect(joint.reduce((a, j) => a + j.share, 0)).toBeCloseTo(1, 9);
      expect(world.cultures.ethnicGroups[ethnic[0]!.id]).toBe(c.demonym);
      const e0 = joint.filter((j) => j.ethnic === ethnic[0]!.id).reduce((a, j) => a + j.share, 0);
      expect(e0).toBeCloseTo(ethnic[0]!.share, 1);
    }
    expect(world.cultures.families.length).toBeGreaterThanOrEqual(3);
  });
});
