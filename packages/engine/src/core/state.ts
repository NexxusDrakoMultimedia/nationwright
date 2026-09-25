// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * World state (DESIGN.md §6.1). All of it is plain, JSON-serializable data so it can be
 * snapshotted to SQLite and compared byte for byte. Each system owns exactly one slice.
 */

import type { ChronicleEntry } from './chronicle.ts';
import type { ModifierState } from './modifiers.ts';

/**
 * One entry per system slice. Systems add their slice type by module augmentation:
 *
 *   declare module '@nationwright/engine' {
 *     interface SystemSlices { demography: DemographyState }
 *   }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SystemSlices {}

export type SliceKey = keyof SystemSlices;

export interface WorldMeta {
  /** Canonical base64url world seed (bigint is not JSON-serializable). */
  readonly worldSeed: string;
  readonly startYear: number;
  /** Version of the simulation rules; changes whenever outcomes for a seed change. */
  readonly rulesetVersion: number;
  /** The next tick to run; equals the number of completed ticks. */
  nextTick: number;
}

export interface WorldState {
  meta: WorldMeta;
  modifiers: ModifierState;
  chronicle: ChronicleEntry[];
  slices: Partial<SystemSlices>;
}
