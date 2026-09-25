// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * One month of the cohort-component projection (DESIGN.md §4.1): deaths, births (with
 * intermarriage), aging (1/60 of each band moves up), education progression in the young
 * bands, rural-to-urban migration, secularization, language shift, and net international
 * migration. Every flow goes through culture.ts, so cohort totals and the joint
 * ethnicity × religion × language counts stay in step.
 */

import { detExp } from '../random/detmath.ts';
import {
  addPeople,
  moveAmount,
  moveFraction,
  NO_RELIGION,
  resolveCombination,
  scaleCell,
  shiftCombination,
  type Combination,
  type CultureTable,
  type RegionGrid,
} from './culture.ts';
import { educationTarget } from './education.ts';
import { FIRST_FERTILE_BAND, LAST_FERTILE_BAND } from './fertility.ts';
import {
  AGE_BANDS,
  BAND_YEARS,
  cellIndex,
  CELLS_PER_REGION,
  EDUCATION_LEVELS,
  FEMALE,
  forEachCell,
  MALE,
  NONE,
  PRIMARY,
  RURAL,
  SECONDARY,
  SEXES,
  SETTLEMENTS,
  TERTIARY,
  URBAN,
  VOCATIONAL,
} from './grid.ts';
import { bandRates } from './life-table.ts';
import { fertilityMultiplier, mortalityMultiplier, type NationPopulation } from './population.ts';
import { DEMOGRAPHY_TUNING as T } from './tuning.ts';

/** This month's drivers, after modifiers. Multipliers are 1 at baseline. */
export interface MonthInputs {
  readonly fertility: number;
  readonly mortality: number;
  readonly schoolingYears: number;
  readonly urbanization: number;
  /** Net international migrants per 1,000 people per year. */
  readonly netMigrationRate: number;
  /** Multipliers on the tuning rates (default 1). */
  readonly secularization?: number;
  readonly languageShift?: number;
}

/** Flows per region this month (people). */
export interface MonthFlows {
  readonly births: number[];
  readonly deaths: number[];
  readonly netMigration: number[];
  readonly toUrban: number[];
  readonly secularized: number[];
  readonly languageShifted: number[];
}

const MONTHS = 12;
const AGING_SHARE = 1 / (BAND_YEARS * MONTHS);

/** Monthly probability of dying in each cell. */
export function monthlyDeathProbabilities(pop: NationPopulation, mortality: number): number[] {
  const rates = pop.model.mortality.map((p) => bandRates(p));
  const q = new Array<number>(CELLS_PER_REGION).fill(0);
  forEachCell((s, a, x, e, i) => {
    const m =
      ((rates[x] as number[])[a] as number) *
      (pop.model.mortalityNorm[a * 2 + x] as number) *
      mortalityMultiplier(s, a, e) *
      mortality;
    q[i] = 1 - detExp(-m / MONTHS);
  });
  return q;
}

function regionTotal(g: RegionGrid): number {
  let n = 0;
  for (const v of g.cohorts) n += v;
  return n;
}

/** The nation's most spoken language (ties: lowest id). */
export function dominantLanguage(table: CultureTable): number {
  const speakers = new Map<number, number>();
  table.combos.forEach((c, k) => {
    let n = 0;
    for (const g of table.regions) for (const v of g.culture[k] as number[]) n += v;
    speakers.set(c.language, (speakers.get(c.language) ?? 0) + n);
  });
  let best = table.combos[0]?.language ?? 0;
  let bestN = -1;
  for (const [language, n] of [...speakers.entries()].sort((a, b) => a[0] - b[0])) {
    if (n > bestN) {
      bestN = n;
      best = language;
    }
  }
  return best;
}

export function stepMonth(pop: NationPopulation, inputs: MonthInputs): MonthFlows {
  const table: CultureTable = { combos: pop.combos, regions: pop.regions };
  const q = monthlyDeathProbabilities(pop, inputs.mortality);
  const flows: MonthFlows = {
    births: [],
    deaths: [],
    netMigration: [],
    toUrban: [],
    secularized: [],
    languageShifted: [],
  };
  const targets = [1, 2, 3, 4, 5].map((a) => educationTarget(a, inputs.schoolingYears));
  const nationTotal = pop.regions.reduce((s, g) => s + regionTotal(g), 0);
  const dominant = dominantLanguage(table);

  for (const g of pop.regions) {
    // Deaths.
    let deaths = 0;
    for (let i = 0; i < CELLS_PER_REGION; i++) {
      deaths += (g.cohorts[i] as number) * (q[i] as number);
      scaleCell(g, i, 1 - (q[i] as number));
    }

    const births = SETTLEMENTS.map((_, s) =>
      birthsBySettlement(pop, table, g, s, inputs, nationTotal),
    );

    // Aging: from the top down so nobody moves twice.
    for (let s = 0; s < SETTLEMENTS.length; s++)
      for (let a = AGE_BANDS - 2; a >= 0; a--)
        for (let x = 0; x < SEXES.length; x++)
          for (let e = 0; e < EDUCATION_LEVELS.length; e++)
            moveFraction(g, cellIndex(s, a, x, e), cellIndex(s, a + 1, x, e), AGING_SHARE);

    const girlShare = 1 / (1 + T.sexRatioAtBirth);
    let born = 0;
    births.forEach((byCombination, s) => {
      const scaled = (share: number) =>
        new Map([...byCombination.entries()].map(([k, n]) => [k, n * share]));
      born += addPeople(g, cellIndex(s, 0, FEMALE, NONE), scaled(girlShare));
      born += addPeople(g, cellIndex(s, 0, MALE, NONE), scaled(1 - girlShare));
    });

    progressEducation(g, targets);
    flows.toUrban.push(urbanize(g, inputs.urbanization));
    flows.secularized.push(
      secularize(table, g, (inputs.secularization ?? 1) * T.secularizationRate, nationTotal),
    );
    flows.languageShifted.push(
      shiftLanguage(
        table,
        g,
        dominant,
        (inputs.languageShift ?? 1) * T.languageShiftRate,
        nationTotal,
      ),
    );
    flows.births.push(born);
    flows.deaths.push(deaths);
  }

  flows.netMigration.push(...migrate(pop.regions, inputs.netMigrationRate));
  return flows;
}

/** This month's births to mothers in one settlement type, by the child's combination. */
function birthsBySettlement(
  pop: NationPopulation,
  table: CultureTable,
  g: RegionGrid,
  s: number,
  inputs: MonthInputs,
  nationTotal: number,
): Map<number, number> {
  const combos = table.combos.length;
  const mothers = new Array<number>(combos).fill(0);
  for (let a = FIRST_FERTILE_BAND; a <= LAST_FERTILE_BAND; a++) {
    for (let e = 0; e < EDUCATION_LEVELS.length; e++) {
      const i = cellIndex(s, a, FEMALE, e);
      const rate =
        ((pop.model.fertility[a] as number) *
          (pop.model.fertilityNorm[a] as number) *
          fertilityMultiplier(s, e) *
          inputs.fertility) /
        MONTHS;
      for (let k = 0; k < combos; k++)
        mothers[k] = (mothers[k] as number) + ((g.culture[k] as number[])[i] as number) * rate;
    }
  }
  // Fathers' ethnicity: local men aged 20–44.
  const fathers = new Map<number, number>();
  let fatherTotal = 0;
  for (let k = 0; k < combos; k++) {
    let n = 0;
    for (let a = 4; a <= 8; a++)
      for (let e = 0; e < EDUCATION_LEVELS.length; e++)
        n += (g.culture[k] as number[])[cellIndex(s, a, MALE, e)] as number;
    const ethnic = (table.combos[k] as Combination).ethnic;
    fathers.set(ethnic, (fathers.get(ethnic) ?? 0) + n);
    fatherTotal += n;
  }
  const mixed = fatherTotal > 0 ? (T.intermarriage[s] as number) : 0;
  const out = new Map<number, number>();
  const add = (k: number, n: number) => out.set(k, (out.get(k) ?? 0) + n);
  const threshold = T.newCombinationShare * nationTotal;
  for (let k = 0; k < combos; k++) {
    const m = mothers[k] as number;
    if (m <= 0) continue;
    add(k, m * (1 - mixed));
    if (mixed === 0) continue;
    const mother = table.combos[k] as Combination;
    for (const [ethnic, n] of [...fathers.entries()].sort((x, y) => x[0] - y[0])) {
      const amount = (m * mixed * n) / fatherTotal;
      if (amount <= 0) continue;
      if (ethnic === mother.ethnic) {
        add(k, amount);
        continue;
      }
      add(resolveCombination(table, { ...mother, ethnic }, amount >= threshold), amount);
    }
  }
  return out;
}

/** Moves children and young adults up toward this band's attainment target. */
function progressEducation(g: RegionGrid, targets: readonly (readonly number[])[]): void {
  const rate = T.educationCatchUp;
  const v = T.vocationalShare;
  targets.forEach((t, k) => {
    const a = k + 1;
    const atLeastPrimary = 1 - (t[NONE] as number);
    const atLeastSecondary =
      (t[SECONDARY] as number) + (t[VOCATIONAL] as number) + (t[TERTIARY] as number);
    const tertiary = t[TERTIARY] as number;
    for (let s = 0; s < SETTLEMENTS.length; s++) {
      for (let x = 0; x < SEXES.length; x++) {
        const i = (e: number) => cellIndex(s, a, x, e);
        const n = (e: number) => g.cohorts[i(e)] as number;
        const total = n(NONE) + n(PRIMARY) + n(SECONDARY) + n(VOCATIONAL) + n(TERTIARY);
        if (total <= 0) continue;
        // none → primary
        moveAmount(
          g,
          i(NONE),
          i(PRIMARY),
          Math.min(n(NONE), rate * Math.max(0, atLeastPrimary * total - (total - n(NONE)))),
        );
        // primary → secondary / vocational
        const up2 = Math.min(
          n(PRIMARY),
          rate *
            Math.max(0, atLeastSecondary * total - (n(SECONDARY) + n(VOCATIONAL) + n(TERTIARY))),
        );
        moveAmount(g, i(PRIMARY), i(SECONDARY), up2 * (1 - v));
        moveAmount(g, i(PRIMARY), i(VOCATIONAL), up2 * v);
        // secondary / vocational → tertiary, proportionally
        const middle = n(SECONDARY) + n(VOCATIONAL);
        const up3 = Math.min(middle, rate * Math.max(0, tertiary * total - n(TERTIARY)));
        if (middle > 0 && up3 > 0) {
          const fromSecondary = (up3 * n(SECONDARY)) / middle;
          moveAmount(g, i(SECONDARY), i(TERTIARY), fromSecondary);
          moveAmount(g, i(VOCATIONAL), i(TERTIARY), up3 - fromSecondary);
        }
      }
    }
  });
}

/** Rural-to-urban migration; returns the number who moved. */
function urbanize(g: RegionGrid, rate: number): number {
  let urban = 0;
  let rural = 0;
  let weightedRural = 0;
  forEachCell((s, a, _x, _e, i) => {
    const n = g.cohorts[i] as number;
    if (s === URBAN) urban += n;
    else {
      rural += n;
      weightedRural += n * (T.urbanMigrationByAge[a] as number);
    }
  });
  const total = urban + rural;
  if (total <= 0 || rural <= 0 || weightedRural <= 0 || rate <= 0) return 0;
  const perWeight = (rate * (urban / total) * rural) / MONTHS / weightedRural;
  let moved = 0;
  forEachCell((s, a, x, e, i) => {
    if (s !== RURAL) return;
    const fraction = Math.min(0.5, perWeight * (T.urbanMigrationByAge[a] as number));
    moved += moveFraction(g, i, cellIndex(URBAN, a, x, e), fraction);
  });
  return moved;
}

/** Shifts people within cells from combination k to `target(k)` at a per-cell rate. */
function shiftWithin(
  table: CultureTable,
  g: RegionGrid,
  eligible: (c: Combination) => Combination | null,
  cellRate: (s: number, a: number, e: number, c: Combination) => number,
  nationTotal: number,
): number {
  const combos = table.combos.length;
  let shifted = 0;
  for (let k = 0; k < combos; k++) {
    const source = table.combos[k] as Combination;
    const destination = eligible(source);
    if (destination === null) continue;
    let flow = 0;
    const layer = g.culture[k] as number[];
    forEachCell((s, a, _x, e, i) => {
      flow += (layer[i] as number) * cellRate(s, a, e, source);
    });
    if (flow <= 0) continue;
    const target = resolveCombination(
      table,
      destination,
      flow >= T.newCombinationShare * nationTotal,
    );
    if (target === k) continue;
    forEachCell((s, a, _x, e, i) => {
      shifted += shiftCombination(g, i, k, target, cellRate(s, a, e, source));
    });
  }
  return shifted;
}

/** People 15+ leaving their religion for none, faster with education and in cities. */
function secularize(
  table: CultureTable,
  g: RegionGrid,
  yearly: number,
  nationTotal: number,
): number {
  if (yearly <= 0) return 0;
  return shiftWithin(
    table,
    g,
    (c) => (c.religion === NO_RELIGION ? null : { ...c, religion: NO_RELIGION }),
    (s, a, e) =>
      a < 3
        ? 0
        : (yearly *
            (T.secularizationByEducation[e] as number) *
            (T.secularizationBySettlement[s] as number)) /
          MONTHS,
    nationTotal,
  );
}

/** Speakers of other languages switching to the dominant one. */
function shiftLanguage(
  table: CultureTable,
  g: RegionGrid,
  dominant: number,
  yearly: number,
  nationTotal: number,
): number {
  if (yearly <= 0) return 0;
  const total = regionTotal(g);
  if (total <= 0) return 0;
  const regionalShare = new Map<number, number>();
  table.combos.forEach((c, k) => {
    let n = 0;
    for (const v of g.culture[k] as number[]) n += v;
    regionalShare.set(c.language, (regionalShare.get(c.language) ?? 0) + n / total);
  });
  return shiftWithin(
    table,
    g,
    (c) => (c.language === dominant ? null : { ...c, language: dominant }),
    (s, a, e, c) =>
      (yearly *
        (T.languageShiftByEducation[e] as number) *
        (T.languageShiftBySettlement[s] as number) *
        (T.languageShiftByAge[a] as number) *
        (1 - (regionalShare.get(c.language) ?? 0))) /
      MONTHS,
    nationTotal,
  );
}

/**
 * Net international migration (interim until the bilateral model in M3): immigrants
 * join regions in proportion to population, preferring cities, with the education and
 * culture mix of the cell they join; emigrants leave every cell of a band proportionally.
 */
function migrate(regions: RegionGrid[], ratePer1000: number): number[] {
  const populations = regions.map(regionTotal);
  const total = populations.reduce((sum, n) => sum + n, 0);
  const net = (ratePer1000 / 1000 / MONTHS) * total;
  if (total <= 0 || net === 0) return regions.map(() => 0);
  return regions.map((g, r) => {
    const regional = (net * (populations[r] as number)) / total;
    if (regional > 0) return immigrate(g, regional, populations[r] as number);
    let applied = 0;
    for (let a = 0; a < AGE_BANDS; a++) {
      let band = 0;
      forEachCell((_s, age, _x, _e, i) => {
        if (age === a) band += g.cohorts[i] as number;
      });
      if (band <= 0) continue;
      const leaving = Math.min(
        band * T.maxMonthlyEmigrationShare,
        -regional * (T.migrantAgeProfile[a] as number),
      );
      forEachCell((_s, age, _x, _e, i) => {
        if (age === a) scaleCell(g, i, 1 - leaving / band);
      });
      applied -= leaving;
    }
    return applied;
  });
}

function immigrate(g: RegionGrid, arrivals: number, population: number): number {
  let urban = 0;
  forEachCell((s, _a, _x, _e, i) => {
    if (s === URBAN) urban += g.cohorts[i] as number;
  });
  const u = urban / population;
  const pref = T.immigrantUrbanPreference;
  const urbanShare = (pref * u) / (pref * u + (1 - u));
  // The region's overall culture mix, for cells nobody lives in yet.
  const regionMix = g.culture.map((layer) => layer.reduce((s, n) => s + n, 0));
  let applied = 0;
  for (let a = 0; a < AGE_BANDS; a++) {
    for (let s = 0; s < SETTLEMENTS.length; s++) {
      for (let x = 0; x < SEXES.length; x++) {
        const n =
          arrivals *
          (T.migrantAgeProfile[a] as number) *
          (s === URBAN ? urbanShare : 1 - urbanShare) *
          0.5;
        if (n <= 0) continue;
        let present = 0;
        for (let e = 0; e < EDUCATION_LEVELS.length; e++)
          present += g.cohorts[cellIndex(s, a, x, e)] as number;
        for (let e = 0; e < EDUCATION_LEVELS.length; e++) {
          const i = cellIndex(s, a, x, e);
          const cellShare = present > 0 ? (g.cohorts[i] as number) / present : e === NONE ? 1 : 0;
          if (cellShare <= 0) continue;
          const here = g.cohorts[i] as number;
          const mix = new Map<number, number>();
          const weights = here > 0 ? g.culture.map((layer) => layer[i] as number) : regionMix;
          const weightTotal = weights.reduce((sum, w) => sum + w, 0);
          weights.forEach((w, k) => {
            if (w > 0 && weightTotal > 0) mix.set(k, (n * cellShare * w) / weightTotal);
          });
          applied += addPeople(g, i, mix);
        }
      }
    }
  }
  return applied;
}
