// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Modifier registry (DESIGN.md §5). Every cross-system effect is a modifier with a source,
 * target, scope, operation, value, and lifetime, so the UI can always explain a number:
 * "Life expectancy −1.2 years: Epidemic (2041)".
 *
 * Resolution: value = (base + Σ add) × Π multiply, with contributions listed in id order.
 */

import type { DeepReadonly } from './readonly.ts';
import { assertScope, type Scope } from './scope.ts';

export interface ModifierSource {
  /** What created it, e.g. 'event', 'policy', 'project', 'war'. */
  readonly kind: string;
  /** Stable id of the creator within its kind. */
  readonly id: string;
  /** Short human-readable label for explanations. */
  readonly label: string;
}

export type ModifierOp = 'add' | 'multiply';

export interface Modifier {
  readonly id: number;
  readonly source: ModifierSource;
  /** Dotted target name, e.g. `demography.mortality_multiplier`. */
  readonly target: string;
  readonly scope: Scope;
  readonly op: ModifierOp;
  readonly value: number;
  /** First tick the modifier applies to. */
  readonly startTick: number;
  /** First tick it no longer applies to; null means permanent until removed. */
  readonly endTick: number | null;
}

export type ModifierSpec = Omit<Modifier, 'id'>;

export interface ModifierState {
  nextId: number;
  entries: Modifier[];
}

export interface Contribution {
  readonly modifierId: number;
  readonly source: ModifierSource;
  readonly op: ModifierOp;
  readonly value: number;
}

export interface Resolution {
  readonly base: number;
  readonly value: number;
  readonly contributions: readonly Contribution[];
}

const TARGET_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

export function createModifierState(): ModifierState {
  return { nextId: 1, entries: [] };
}

export function addModifier(state: ModifierState, spec: ModifierSpec): Modifier {
  if (!TARGET_PATTERN.test(spec.target)) {
    throw new RangeError(`Invalid modifier target "${spec.target}".`);
  }
  assertScope(spec.scope);
  if (!Number.isFinite(spec.value)) {
    throw new RangeError(`Modifier value must be finite; got ${spec.value}.`);
  }
  if (spec.endTick !== null && spec.endTick <= spec.startTick) {
    throw new RangeError('Modifier endTick must be after startTick.');
  }
  const modifier: Modifier = { ...spec, id: state.nextId };
  state.nextId += 1;
  state.entries.push(modifier);
  return modifier;
}

export function removeModifier(state: ModifierState, id: number): boolean {
  const index = state.entries.findIndex((m) => m.id === id);
  if (index < 0) return false;
  state.entries.splice(index, 1);
  return true;
}

/** Drops modifiers that can no longer apply at or after `tick`. */
export function pruneExpired(state: ModifierState, tick: number): number {
  const before = state.entries.length;
  state.entries = state.entries.filter((m) => m.endTick === null || m.endTick > tick);
  return before - state.entries.length;
}

export function isActive(modifier: DeepReadonly<Modifier>, tick: number): boolean {
  return modifier.startTick <= tick && (modifier.endTick === null || tick < modifier.endTick);
}

export function resolveModifiers(
  state: DeepReadonly<ModifierState>,
  tick: number,
  target: string,
  scope: Scope,
  base: number,
): Resolution {
  let added = 0;
  let factor = 1;
  const contributions: Contribution[] = [];
  // Entries are appended in id order and never reordered, so iteration is deterministic.
  for (const m of state.entries) {
    if (m.target !== target || m.scope !== scope || !isActive(m, tick)) continue;
    if (m.op === 'add') added += m.value;
    else factor *= m.value;
    contributions.push({ modifierId: m.id, source: m.source, op: m.op, value: m.value });
  }
  return { base, value: (base + added) * factor, contributions };
}
