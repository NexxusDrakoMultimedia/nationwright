// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/** What the economy reads from the demography grid. */

import { summarize } from '../demography/measures.ts';
import type { LaborInputs } from './model.ts';

/** Years of schooling credited to each education level (none … tertiary). */
export const SCHOOLING_YEARS = [1, 6, 11, 11, 15] as const;

export function laborInputs(cohorts: readonly (readonly number[])[]): LaborInputs {
  const s = summarize(cohorts);
  let adults = 0;
  for (let a = 3; a < s.byAgeSex.length; a++)
    adults += (s.byAgeSex[a]?.[0] ?? 0) + (s.byAgeSex[a]?.[1] ?? 0);
  const educated = s.education25Plus.reduce((a, b) => a + b, 0);
  const years =
    educated > 0
      ? s.education25Plus.reduce((sum, n, e) => sum + n * (SCHOOLING_YEARS[e] as number), 0) /
        educated
      : 0;
  const nearlyAdult = (s.byAgeSex[2]?.[0] ?? 0) + (s.byAgeSex[2]?.[1] ?? 0);
  return { population: s.total, adults, schoolingYears: years, nearlyAdult };
}
