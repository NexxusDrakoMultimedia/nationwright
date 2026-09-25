// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The reference data the game ships (DESIGN.md §10.1): the fitted guiding variables and
 * the hashed name blocklist. Aggregates only; no per-country records.
 */

import type { GuidingVariables } from '@nationwright/engine';
import { assertGuidingVariables } from '@nationwright/engine';
import guiding2026 from '@nationwright/reference-data/data/guiding-variables-2026.json' with { type: 'json' };
import blocklist from '@nationwright/reference-data/data/name-blocklist.json' with { type: 'json' };

const MODELS: readonly GuidingVariables[] = [guiding2026 as GuidingVariables];
for (const model of MODELS) assertGuidingVariables(model);

/**
 * The model for a start year: the newest fitted for that year or earlier. The data is
 * frozen, so later start years reuse the newest model (its values are projected to its
 * own target year; see DESIGN.md §10.1).
 */
export function guidingFor(startYear: number): GuidingVariables {
  const sorted = [...MODELS].sort((a, b) => a.targetYear - b.targetYear);
  return (
    [...sorted].reverse().find((m) => m.targetYear <= startYear) ?? (sorted[0] as GuidingVariables)
  );
}

export const NAME_BLOCKLIST: readonly string[] = blocklist as string[];
