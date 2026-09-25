// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The guiding-variables model (DESIGN.md §4.12.1). Produced offline by
 * packages/reference-data from factbook.json; consumed here to generate fictional nations.
 * Only aggregate statistics: no real country appears anywhere in it.
 */

export interface GuidingVariable {
  readonly id: string;
  readonly unit: string;
  readonly description: string;
  /** Number of real states observed. */
  readonly n: number;
  /** Values at percentiles 0, 1, …, 100. */
  readonly quantiles: readonly number[];
}

export interface Archetype {
  readonly id: number;
  readonly label: string;
  /** Share of states in this archetype. */
  readonly weight: number;
  /** Mean normal score per variable (same order as `variables`). */
  readonly mean: readonly number[];
  readonly governmentCategories: Readonly<Record<string, number>>;
  readonly landlockedShare: number;
  readonly islandShare: number;
  readonly ethnicGroupCounts: Readonly<Record<string, number>>;
  readonly religionCounts: Readonly<Record<string, number>>;
  readonly languageCounts: Readonly<Record<string, number>>;
}

export interface GuidingVariables {
  readonly modelVersion: number;
  readonly pipelineVersion: number;
  readonly targetYear: number;
  readonly sourceCommit: string;
  readonly variables: readonly GuidingVariable[];
  readonly archetypes: readonly Archetype[];
  /** Pooled within-archetype covariance of normal scores (positive definite). */
  readonly covariance: readonly (readonly number[])[];
  /** Overall correlation of normal scores (for validating generated worlds). */
  readonly correlation: readonly (readonly number[])[];
  readonly spatial: {
    /** Correlation of each variable's normal score across land borders. */
    readonly neighborCorrelation: Readonly<Record<string, number>>;
    /** Share of bordering state pairs in the same archetype, and the chance level. */
    readonly archetypeAgreement: number;
    readonly archetypeAgreementChance: number;
  };
  readonly structure: {
    readonly stateCount: number;
    /** Territories (dependencies etc.) per state. */
    readonly territoriesPerState: number;
    readonly landlockedShare: number;
    readonly islandShare: number;
    /** Share of states with each number of land neighbours. */
    readonly neighborCounts: Readonly<Record<string, number>>;
    readonly landFraction: number;
  };
}

/** Structural checks for a loaded model (it arrives as JSON). Throws with the first problem. */
export function assertGuidingVariables(model: GuidingVariables): void {
  const p = model.variables.length;
  if (p === 0) throw new Error('Guiding variables: no variables.');
  for (const v of model.variables) {
    if (v.quantiles.length !== 101)
      throw new Error(`Guiding variable ${v.id}: need 101 quantiles.`);
    for (let i = 1; i < 101; i++) {
      if ((v.quantiles[i] as number) < (v.quantiles[i - 1] as number)) {
        throw new Error(`Guiding variable ${v.id}: quantiles must not decrease.`);
      }
    }
  }
  if (model.covariance.length !== p || model.covariance.some((row) => row.length !== p)) {
    throw new Error('Guiding variables: covariance must be p × p.');
  }
  const total = model.archetypes.reduce((s, a) => s + a.weight, 0);
  if (Math.abs(total - 1) > 1e-3)
    throw new Error(`Guiding variables: archetype weights sum to ${total}.`);
  for (const a of model.archetypes) {
    if (a.mean.length !== p) throw new Error(`Archetype ${a.id}: mean must have ${p} entries.`);
  }
}
