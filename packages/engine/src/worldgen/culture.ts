// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Cultures (DESIGN.md §4.12.3 steps 5–7, D14): culture families spread over the map,
 * fictional faiths and languages, each country's ethnic, religious, and linguistic groups
 * with shares matching its sampled fractionalization, and their joint distribution with
 * randomized alignment, fitted by iterative proportional fitting (IPF).
 */

import type { RandomStream } from '../random/stream.ts';
import { cellDistance, type CellGrid } from './grid.ts';
import type { NameGuard } from './name-check.ts';
import { Names, randomPhonology, uniqueName, type Phonology } from './names.ts';

export interface CultureFamily {
  readonly id: number;
  readonly phonology: Phonology;
  /** The faith most common in this family's countries. */
  readonly faith: number;
  /** The family's languages (the first is the most widespread). */
  readonly languages: readonly number[];
}

export interface Group {
  /** Index into the world's ethnic groups, faiths, or languages. */
  readonly id: number;
  /** Share of the country's population, 0–1. */
  readonly share: number;
}

export interface JointShare {
  readonly ethnic: number;
  readonly religion: number;
  readonly language: number;
  readonly share: number;
}

export interface CountryCulture {
  readonly family: number;
  readonly ethnic: readonly Group[];
  readonly religions: readonly Group[];
  readonly languages: readonly Group[];
  /** Pairwise alignment drawn for this country: 0 = independent, 1 = coincide. */
  readonly alignment: {
    readonly ethnicReligion: number;
    readonly ethnicLanguage: number;
    readonly religionLanguage: number;
  };
  /** Joint distribution (combinations with at least 0.1% of the population). */
  readonly joint: readonly JointShare[];
}

export interface WorldCultures {
  readonly families: readonly CultureFamily[];
  /** Names of every ethnic group, faith, and language in the world. */
  readonly ethnicGroups: readonly string[];
  readonly faiths: readonly string[];
  readonly languages: readonly string[];
  readonly countries: readonly CountryCulture[];
}

/**
 * Shares for k groups with a target fractionalization 1 − Σs²: geometric shares s ∝ rⁱ,
 * with r found by bisection. Deterministic and always sums to 1.
 */
/** The world's faith id for "Non-religious" (always the last faith generated). */
export function nonReligiousFaith(cultures: Pick<WorldCultures, 'faiths'>): number {
  return cultures.faiths.length - 1;
}

export function sharesFor(k: number, fractionalization: number): number[] {
  if (k <= 1) return [1];
  const target = Math.max(1 / k, Math.min(1, 1 - fractionalization)); // Herfindahl index
  const shares = (r: number) => {
    const raw = Array.from({ length: k }, (_, i) => {
      let x = 1;
      for (let j = 0; j < i; j++) x *= r;
      return x;
    });
    const sum = raw.reduce((a, b) => a + b, 0);
    return raw.map((x) => x / sum);
  };
  const hhi = (r: number) => shares(r).reduce((a, s) => a + s * s, 0);
  let lo = 0;
  let hi = 1;
  for (let iter = 0; iter < 60; iter++) {
    const mid = (lo + hi) / 2;
    if (hhi(mid) > target) lo = mid;
    else hi = mid;
  }
  // Every listed group gets at least 1% (a group below that wouldn't be listed).
  // Groups below the floor are raised to it; the rest shrink proportionally to pay for it.
  const floor = 0.01;
  const out = shares((lo + hi) / 2);
  for (let pass = 0; pass < k; pass++) {
    const low = out.map((x) => x <= floor);
    const fixed = low.filter(Boolean).length * floor;
    const freeMass = out.reduce((a, x, i) => (low[i] ? a : a + x), 0);
    if (freeMass <= 0) break;
    let changed = false;
    for (let i = 0; i < k; i++) {
      const next = low[i] ? floor : ((out[i] as number) * (1 - fixed)) / freeMass;
      if (next !== out[i]) changed = true;
      out[i] = next;
    }
    if (!changed) break;
  }
  return out;
}

/**
 * Joint E × R × L table from three marginals and pairwise alignments: a seed table that
 * blends independence with a random one-to-one pairing, then IPF to the marginals.
 */
export function jointDistribution(
  ethnic: readonly number[],
  religion: readonly number[],
  language: readonly number[],
  alignment: CountryCulture['alignment'],
  stream: RandomStream,
): number[][][] {
  const pairing = (from: number, to: number) =>
    Array.from({ length: from }, () => stream.nextIntBelow(to));
  const er = pairing(ethnic.length, religion.length);
  const el = pairing(ethnic.length, language.length);
  const rl = pairing(religion.length, language.length);
  const affinity = (a: number, paired: boolean, size: number) => 1 - a + (paired ? a * size : 0);
  const t = ethnic.map((_, e) =>
    religion.map((__, r) =>
      language.map(
        (___, l) =>
          affinity(alignment.ethnicReligion, er[e] === r, religion.length) *
            affinity(alignment.ethnicLanguage, el[e] === l, language.length) *
            affinity(alignment.religionLanguage, rl[r] === l, language.length) +
          1e-9,
      ),
    ),
  );
  for (let iter = 0; iter < 60; iter++) {
    ethnic.forEach((target, e) => {
      let sum = 0;
      for (const row of t[e] as number[][]) for (const x of row) sum += x;
      for (const row of t[e] as number[][])
        for (let l = 0; l < row.length; l++) row[l] = ((row[l] as number) * target) / sum;
    });
    religion.forEach((target, r) => {
      let sum = 0;
      for (const plane of t) for (const x of plane[r] as number[]) sum += x;
      for (const plane of t) {
        const row = plane[r] as number[];
        for (let l = 0; l < row.length; l++) row[l] = ((row[l] as number) * target) / sum;
      }
    });
    language.forEach((target, l) => {
      let sum = 0;
      for (const plane of t) for (const row of plane) sum += row[l] as number;
      for (const plane of t) for (const row of plane) row[l] = ((row[l] as number) * target) / sum;
    });
  }
  return t;
}

export interface CultureInput {
  readonly capitals: readonly number[];
  readonly neighbors: readonly (readonly number[])[];
  readonly ethnicGroupCounts: readonly number[];
  readonly religionCounts: readonly number[];
  readonly languageCounts: readonly number[];
  readonly ethnicFractionalization: readonly number[];
  readonly religiousFractionalization: readonly number[];
}

export function generateCultures(
  grid: CellGrid,
  input: CultureInput,
  guard: NameGuard,
  stream: RandomStream,
): WorldCultures & { countryRoots: string[] } {
  const n = input.capitals.length;
  const familyCount = Math.max(3, Math.round(n / 12));

  // Family seeds spread over the map (farthest-point); each country joins the nearest.
  const seeds = [stream.nextIntBelow(n)];
  while (seeds.length < familyCount) {
    let far = 0;
    let farD = -1;
    for (let k = 0; k < n; k++) {
      const d = Math.min(
        ...seeds.map((s) =>
          cellDistance(grid, input.capitals[s] as number, input.capitals[k] as number),
        ),
      );
      if (d > farD) {
        farD = d;
        far = k;
      }
    }
    seeds.push(far);
  }
  const familyOf = input.capitals.map((c) => {
    let best = 0;
    let bestD = Infinity;
    seeds.forEach((s, f) => {
      // Jitter distances by up to 30% so family borders don't follow straight lines.
      const d =
        cellDistance(grid, input.capitals[s] as number, c) * (0.85 + 0.3 * stream.nextFloat64());
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    });
    return best;
  });

  const phonologies = seeds.map(() => randomPhonology(stream));
  const faiths: string[] = [];
  const faithCount = Math.max(4, Math.round(n / 15));
  for (let f = 0; f < faithCount; f++) {
    const p = phonologies[f % phonologies.length] as Phonology;
    faiths.push(uniqueName(guard, () => Names.faith(p, stream)));
  }
  faiths.push('Non-religious');
  const languages: string[] = [];
  const families: CultureFamily[] = phonologies.map((phonology, id) => {
    const count = 2 + stream.nextIntBelow(3);
    const langIds = Array.from({ length: count }, () => {
      languages.push(uniqueName(guard, () => Names.language(phonology, stream)));
      return languages.length - 1;
    });
    return { id, phonology, faith: stream.nextIntBelow(faithCount), languages: langIds };
  });

  const ethnicGroups: string[] = [];
  const countryRoots: string[] = [];
  const countries: CountryCulture[] = [];
  for (let k = 0; k < n; k++) {
    const family = families[familyOf[k] as number] as CultureFamily;
    const p = family.phonology;
    // The country's own people: the demonym of its name root.
    let countryRoot = '';
    const demonym = uniqueName(guard, () => {
      countryRoot = Names.countryRoot(p, stream);
      return Names.demonym(p, countryRoot);
    });
    countryRoots.push(countryRoot);
    ethnicGroups.push(demonym);
    const ethnicIds = [ethnicGroups.length - 1];
    const neighborFamilies = (input.neighbors[k] ?? []).map((j) => familyOf[j] as number);
    for (let g = 1; g < (input.ethnicGroupCounts[k] ?? 1); g++) {
      // Minorities: often a neighbour family's people (cross-border groups), else new.
      const source =
        neighborFamilies.length > 0 && stream.nextFloat64() < 0.5
          ? (families[
              neighborFamilies[stream.nextIntBelow(neighborFamilies.length)] as number
            ] as CultureFamily)
          : family;
      ethnicGroups.push(
        uniqueName(guard, () =>
          Names.demonym(source.phonology, Names.countryRoot(source.phonology, stream)),
        ),
      );
      ethnicIds.push(ethnicGroups.length - 1);
    }

    const religionIds = [family.faith];
    while (religionIds.length < (input.religionCounts[k] ?? 1)) {
      const r = stream.nextFloat64() < 0.25 ? faiths.length - 1 : stream.nextIntBelow(faithCount);
      if (!religionIds.includes(r)) religionIds.push(r);
      else if (religionIds.length >= faiths.length) break;
    }
    const languageIds = [family.languages[0] as number];
    const pool = [
      ...family.languages.slice(1),
      ...neighborFamilies.flatMap((f) => (families[f] as CultureFamily).languages),
    ];
    while (languageIds.length < (input.languageCounts[k] ?? 1) && pool.length > 0) {
      const l = pool.splice(stream.nextIntBelow(pool.length), 1)[0] as number;
      if (!languageIds.includes(l)) languageIds.push(l);
    }

    const ethnicShares = sharesFor(ethnicIds.length, input.ethnicFractionalization[k] ?? 0.3);
    const religionShares = sharesFor(
      religionIds.length,
      input.religiousFractionalization[k] ?? 0.3,
    );
    const languageShares = sharesFor(
      languageIds.length,
      (input.ethnicFractionalization[k] ?? 0.3) * 0.8,
    );
    const alignment = {
      ethnicReligion: stream.nextFloat64(),
      ethnicLanguage: stream.nextFloat64(),
      religionLanguage: stream.nextFloat64(),
    };
    const table = jointDistribution(
      ethnicShares,
      religionShares,
      languageShares,
      alignment,
      stream,
    );
    const joint: JointShare[] = [];
    table.forEach((plane, e) =>
      plane.forEach((row, r) =>
        row.forEach((share, l) => {
          if (share >= 0.001) {
            joint.push({
              ethnic: ethnicIds[e] as number,
              religion: religionIds[r] as number,
              language: languageIds[l] as number,
              share,
            });
          }
        }),
      ),
    );
    const total = joint.reduce((a, j) => a + j.share, 0);
    countries.push({
      family: familyOf[k] as number,
      ethnic: ethnicIds.map((id, i) => ({ id, share: ethnicShares[i] as number })),
      religions: religionIds.map((id, i) => ({ id, share: religionShares[i] as number })),
      languages: languageIds.map((id, i) => ({ id, share: languageShares[i] as number })),
      alignment,
      joint: joint.map((j) => ({ ...j, share: j.share / total })),
    });
  }
  return { families, ethnicGroups, faiths, languages, countries, countryRoots };
}
