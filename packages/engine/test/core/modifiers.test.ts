// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { describe, expect, it } from 'vitest';
import {
  addModifier,
  createModifierState,
  pruneExpired,
  removeModifier,
  resolveModifiers,
  type ModifierSpec,
} from '../../src/index.ts';

const epidemic: ModifierSpec = {
  source: { kind: 'event', id: 'epidemic_major', label: 'Epidemic (2041)' },
  target: 'demography.mortality_multiplier',
  scope: 'nation',
  op: 'multiply',
  value: 1.15,
  startTick: 10,
  endTick: 20,
};

describe('modifier registry', () => {
  it('resolves (base + adds) × multiplies and lists contributions', () => {
    const state = createModifierState();
    addModifier(state, epidemic);
    addModifier(state, {
      ...epidemic,
      source: { kind: 'project', id: 'h1', label: 'Hospitals' },
      op: 'add',
      value: -0.1,
      endTick: null,
    });
    const r = resolveModifiers(state, 12, 'demography.mortality_multiplier', 'nation', 1);
    expect(r.value).toBeCloseTo((1 - 0.1) * 1.15);
    expect(r.contributions.map((c) => c.modifierId)).toEqual([1, 2]);
  });

  it('honours lifetimes, scopes, and targets', () => {
    const state = createModifierState();
    addModifier(state, epidemic);
    const at = (tick: number) =>
      resolveModifiers(state, tick, 'demography.mortality_multiplier', 'nation', 1).value;
    expect(at(9)).toBe(1);
    expect(at(10)).toBeCloseTo(1.15);
    expect(at(19)).toBeCloseTo(1.15);
    expect(at(20)).toBe(1);
    expect(
      resolveModifiers(state, 12, 'demography.mortality_multiplier', 'region:1', 1).value,
    ).toBe(1);
    expect(resolveModifiers(state, 12, 'economy.tfp', 'nation', 1).value).toBe(1);
  });

  it('prunes expired modifiers and removes by id', () => {
    const state = createModifierState();
    const a = addModifier(state, epidemic);
    addModifier(state, { ...epidemic, endTick: null });
    expect(pruneExpired(state, 20)).toBe(1);
    expect(removeModifier(state, a.id)).toBe(false);
    expect(removeModifier(state, 2)).toBe(true);
    expect(state.entries).toEqual([]);
  });

  it('validates specs', () => {
    const state = createModifierState();
    expect(() => addModifier(state, { ...epidemic, target: 'Bad Target' })).toThrow(RangeError);
    expect(() => addModifier(state, { ...epidemic, scope: 'planet:1' as 'nation' })).toThrow(
      RangeError,
    );
    expect(() => addModifier(state, { ...epidemic, value: Number.NaN })).toThrow(RangeError);
    expect(() => addModifier(state, { ...epidemic, endTick: 10 })).toThrow(RangeError);
  });
});
