// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/** The contract every simulation system implements (DESIGN.md §3.2, §5). */

import type { RandomStream } from '../random/stream.ts';
import type { Cadences, SimDate } from './calendar.ts';
import type { ChronicleEntry } from './chronicle.ts';
import type { IndicatorDefinition } from './indicators.ts';
import type { Modifier, ModifierSpec, Resolution } from './modifiers.ts';
import type { SystemId } from './pipeline.ts';
import type { DeepReadonly } from './readonly.ts';
import type { Scope } from './scope.ts';
import type { SliceKey, SystemSlices, WorldState } from './state.ts';

export interface InitContext {
  readonly startYear: number;
  /** Stream `init/<system>[/<name>]`. */
  stream(name?: string): RandomStream;
}

export interface TickContext {
  readonly tick: number;
  readonly date: SimDate;
  readonly cadences: Cadences;
  /** Read-only view of the whole world as it stands at this point in the pipeline. */
  readonly world: DeepReadonly<WorldState>;
  /** Stream `sim/<system>[/<name>]@tick:<tick>`: fresh and independent every tick. */
  stream(name?: string): RandomStream;
  /** Records this tick's value of an indicator this system owns. */
  record(indicatorId: string, scope: Scope, value: number): void;
  addModifier(spec: Omit<ModifierSpec, 'startTick'> & { startTick?: number }): Modifier;
  resolve(target: string, scope: Scope, base: number): Resolution;
  chronicle(entry: Omit<ChronicleEntry, 'tick'>): void;
}

export interface SystemDefinition<K extends SliceKey = SliceKey> {
  readonly id: SystemId;
  /** The one slice of world state this system may write. */
  readonly slice: K;
  readonly indicators?: readonly IndicatorDefinition[];
  init(ctx: InitContext): SystemSlices[K];
  step(ctx: TickContext, slice: SystemSlices[K]): void;
}

/** Helper that keeps the slice type tied to the key when declaring a system. */
export function defineSystem<K extends SliceKey>(system: SystemDefinition<K>): SystemDefinition<K> {
  return system;
}
