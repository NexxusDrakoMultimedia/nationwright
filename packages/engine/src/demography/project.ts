// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * One month of the cohort-component projection (DESIGN.md §4.1): deaths, births, aging
 * (1/60 of each band moves up), education progression in the young bands, rural-to-urban
 * migration, and net international migration.
 */

import { detExp } from '../random/detmath.ts';
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
}

/** Flows per region this month (people). */
export interface MonthFlows {
  readonly births: number[];
  readonly deaths: number[];
  readonly netMigration: number[];
  readonly toUrban: number[];
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

export function stepMonth(pop: NationPopulation, inputs: MonthInputs): MonthFlows {
  const q = monthlyDeathProbabilities(pop, inputs.mortality);
  const flows: MonthFlows = { births: [], deaths: [], netMigration: [], toUrban: [] };
  const targets = [1, 2, 3, 4, 5].map((a) => educationTarget(a, inputs.schoolingYears));

  for (const c of pop.regions) {
    // Deaths.
    let deaths = 0;
    for (let i = 0; i < CELLS_PER_REGION; i++) {
      const d = (c[i] as number) * (q[i] as number);
      c[i] = (c[i] as number) - d;
      deaths += d;
    }

    // Births, by the mother's settlement.
    const births = [0, 0];
    for (let s = 0; s < SETTLEMENTS.length; s++) {
      for (let a = FIRST_FERTILE_BAND; a <= LAST_FERTILE_BAND; a++) {
        for (let e = 0; e < EDUCATION_LEVELS.length; e++) {
          births[s] =
            (births[s] as number) +
            ((c[cellIndex(s, a, FEMALE, e)] as number) *
              (pop.model.fertility[a] as number) *
              (pop.model.fertilityNorm[a] as number) *
              fertilityMultiplier(s, e) *
              inputs.fertility) /
              MONTHS;
        }
      }
    }

    // Aging: from the top down so nobody moves twice.
    for (let s = 0; s < SETTLEMENTS.length; s++) {
      for (let a = AGE_BANDS - 2; a >= 0; a--) {
        for (let x = 0; x < SEXES.length; x++) {
          for (let e = 0; e < EDUCATION_LEVELS.length; e++) {
            const from = cellIndex(s, a, x, e);
            const to = cellIndex(s, a + 1, x, e);
            const move = (c[from] as number) * AGING_SHARE;
            c[from] = (c[from] as number) - move;
            c[to] = (c[to] as number) + move;
          }
        }
      }
    }

    const girlShare = 1 / (1 + T.sexRatioAtBirth);
    for (let s = 0; s < SETTLEMENTS.length; s++) {
      const b = births[s] as number;
      const girls = cellIndex(s, 0, FEMALE, NONE);
      const boys = cellIndex(s, 0, MALE, NONE);
      c[girls] = (c[girls] as number) + b * girlShare;
      c[boys] = (c[boys] as number) + b * (1 - girlShare);
    }

    progressEducation(c, targets);
    flows.toUrban.push(urbanize(c, inputs.urbanization));
    flows.births.push((births[0] as number) + (births[1] as number));
    flows.deaths.push(deaths);
  }

  const migration = migrate(pop.regions, inputs.netMigrationRate);
  flows.netMigration.push(...migration);
  return flows;
}

/** Moves children and young adults up toward this band's attainment target. */
function progressEducation(c: number[], targets: readonly (readonly number[])[]): void {
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
        const n = [NONE, PRIMARY, SECONDARY, VOCATIONAL, TERTIARY].map((e) => c[i(e)] as number);
        const total = n.reduce((sum, value) => sum + value, 0);
        if (total <= 0) continue;
        const [none, primary, secondary, vocational, higher] = n as [
          number,
          number,
          number,
          number,
          number,
        ];
        // none → primary
        const up1 = Math.min(none, rate * Math.max(0, atLeastPrimary * total - (total - none)));
        // primary → secondary / vocational
        const up2 = Math.min(
          primary + up1,
          rate * Math.max(0, atLeastSecondary * total - (secondary + vocational + higher)),
        );
        // secondary / vocational → tertiary
        const midLevel = secondary + vocational + up2;
        const up3 = Math.min(midLevel, rate * Math.max(0, tertiary * total - higher));
        const fromSecondary = midLevel > 0 ? (up3 * (secondary + up2 * (1 - v))) / midLevel : 0;
        c[i(NONE)] = none - up1;
        c[i(PRIMARY)] = primary + up1 - up2;
        c[i(SECONDARY)] = secondary + up2 * (1 - v) - fromSecondary;
        c[i(VOCATIONAL)] = vocational + up2 * v - (up3 - fromSecondary);
        c[i(TERTIARY)] = higher + up3;
      }
    }
  });
}

/** Rural-to-urban migration; returns the number who moved. */
function urbanize(c: number[], rate: number): number {
  let urban = 0;
  let rural = 0;
  let weightedRural = 0;
  forEachCell((s, a, _x, _e, i) => {
    const n = c[i] as number;
    if (s === URBAN) urban += n;
    else {
      rural += n;
      weightedRural += n * (T.urbanMigrationByAge[a] as number);
    }
  });
  const total = urban + rural;
  if (total <= 0 || rural <= 0 || weightedRural <= 0 || rate <= 0) return 0;
  const movers = (rate * (urban / total) * rural) / MONTHS;
  const perWeight = movers / weightedRural;
  let moved = 0;
  forEachCell((s, a, x, e, i) => {
    if (s !== RURAL) return;
    const n = c[i] as number;
    const move = Math.min(n * 0.5, n * perWeight * (T.urbanMigrationByAge[a] as number));
    const to = cellIndex(URBAN, a, x, e);
    c[i] = n - move;
    c[to] = (c[to] as number) + move;
    moved += move;
  });
  return moved;
}

/**
 * Net international migration (interim until the bilateral model in M3): immigrants
 * join regions in proportion to population, preferring cities, with the education mix
 * of the cell they join; emigrants leave every cell of a band proportionally.
 */
function migrate(regions: number[][], ratePer1000: number): number[] {
  const populations = regions.map((c) => c.reduce((sum, n) => sum + n, 0));
  const total = populations.reduce((sum, n) => sum + n, 0);
  const net = (ratePer1000 / 1000 / MONTHS) * total;
  if (total <= 0 || net === 0) return regions.map(() => 0);
  return regions.map((c, r) => {
    const regional = (net * (populations[r] as number)) / total;
    let applied = 0;
    if (regional > 0) {
      let urban = 0;
      forEachCell((s, _a, _x, _e, i) => {
        if (s === URBAN) urban += c[i] as number;
      });
      const u = urban / (populations[r] as number);
      const pref = T.immigrantUrbanPreference;
      const urbanShare = (pref * u) / (pref * u + (1 - u));
      for (let a = 0; a < AGE_BANDS; a++) {
        for (let s = 0; s < SETTLEMENTS.length; s++) {
          for (let x = 0; x < SEXES.length; x++) {
            const arrivals =
              regional *
              (T.migrantAgeProfile[a] as number) *
              (s === URBAN ? urbanShare : 1 - urbanShare) *
              0.5;
            if (arrivals <= 0) continue;
            let present = 0;
            for (let e = 0; e < EDUCATION_LEVELS.length; e++)
              present += c[cellIndex(s, a, x, e)] as number;
            for (let e = 0; e < EDUCATION_LEVELS.length; e++) {
              const i = cellIndex(s, a, x, e);
              const share = present > 0 ? (c[i] as number) / present : e === NONE ? 1 : 0;
              c[i] = (c[i] as number) + arrivals * share;
            }
            applied += arrivals;
          }
        }
      }
    } else {
      for (let a = 0; a < AGE_BANDS; a++) {
        let band = 0;
        for (let s = 0; s < SETTLEMENTS.length; s++)
          for (let x = 0; x < SEXES.length; x++)
            for (let e = 0; e < EDUCATION_LEVELS.length; e++)
              band += c[cellIndex(s, a, x, e)] as number;
        if (band <= 0) continue;
        const leaving = Math.min(
          band * T.maxMonthlyEmigrationShare,
          -regional * (T.migrantAgeProfile[a] as number),
        );
        const share = leaving / band;
        for (let s = 0; s < SETTLEMENTS.length; s++)
          for (let x = 0; x < SEXES.length; x++)
            for (let e = 0; e < EDUCATION_LEVELS.length; e++) {
              const i = cellIndex(s, a, x, e);
              c[i] = (c[i] as number) * (1 - share);
            }
        applied -= leaving;
      }
    }
    return applied;
  });
}
