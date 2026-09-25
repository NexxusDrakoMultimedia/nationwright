// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { describe, expect, it } from 'vitest';
import {
  Engine,
  RULESET_VERSION,
  SYSTEM_ORDER,
  defineSystem,
  replay,
  type SystemId,
} from '../../src/index.ts';
import { baseOptions, setTaxRate, toyDemography, toyEconomy } from './fixtures.ts';

function fingerprint(engine: Engine): string {
  return JSON.stringify({ world: engine.snapshot(), indicators: engine.indicators.dump() });
}

describe('Engine', () => {
  it('starts at tick 0 with each system slice initialized', () => {
    const engine = new Engine(baseOptions);
    expect(engine.nextTick).toBe(0);
    expect(engine.world.meta).toEqual({
      worldSeed: 'q3Zk1d0XbAc',
      startYear: 2026,
      rulesetVersion: RULESET_VERSION,
      nextTick: 0,
    });
    expect(engine.world.slices.toyEconomy).toEqual({ taxRate: 0.2, revenue: 0 });
    expect(engine.world.slices.toyPopulation?.people).toBeGreaterThanOrEqual(1000);
  });

  it('is deterministic: same seed, same history', () => {
    const a = new Engine(baseOptions);
    const b = new Engine(baseOptions);
    a.advance(120);
    b.advance(60);
    b.advance(60);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('diverges for a different seed', () => {
    const a = new Engine(baseOptions);
    const b = new Engine({ ...baseOptions, seed: 'AAAAAAAAAAE' });
    a.advance(12);
    b.advance(12);
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('accepts bigint and base64url seeds interchangeably', () => {
    const a = new Engine(baseOptions);
    const b = new Engine({ ...baseOptions, seed: a.seed });
    a.advance(24);
    b.advance(24);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(() => new Engine({ ...baseOptions, seed: 'not a seed!' })).toThrow(RangeError);
  });

  it('records indicators once per tick and writes the chronicle on annual ticks', () => {
    const engine = new Engine(baseOptions);
    engine.advance(24);
    const population = engine.indicators.series('population.total', 'nation');
    expect(population.ticks).toEqual([...Array(24).keys()]);
    expect(engine.world.chronicle.map((e) => e.tick)).toEqual([11, 23]);
  });

  it('runs systems in pipeline order regardless of registration order', () => {
    const seen: SystemId[] = [];
    const a = defineSystem({
      ...toyEconomy,
      step: (ctx, s) => {
        seen.push('economy');
        toyEconomy.step(ctx, s);
      },
    });
    const b = defineSystem({
      ...toyDemography,
      step: (ctx, s) => {
        seen.push('demography');
        toyDemography.step(ctx, s);
      },
    });
    const engine = new Engine({ ...baseOptions, systems: [a, b] });
    engine.advance(1);
    expect(seen).toEqual(['demography', 'economy']);
    expect(SYSTEM_ORDER.indexOf('demography')).toBeLessThan(SYSTEM_ORDER.indexOf('economy'));
  });

  it('rejects duplicate systems, slices, commands, and mis-owned indicators', () => {
    expect(() => new Engine({ ...baseOptions, systems: [toyDemography, toyDemography] })).toThrow();
    expect(
      () =>
        new Engine({
          ...baseOptions,
          systems: [toyEconomy, { ...toyDemography, slice: 'toyEconomy' } as never],
        }),
    ).toThrow();
    expect(() => new Engine({ ...baseOptions, commands: [setTaxRate, setTaxRate] })).toThrow();
    const bad = defineSystem({
      ...toyEconomy,
      indicators: [
        { id: 'economy.x', unit: '', description: '', aggregation: 'last', owner: 'demography' },
      ],
    });
    expect(() => new Engine({ ...baseOptions, systems: [bad] })).toThrow(/owned by/);
  });

  it('gives each system its own stream that changes every tick', () => {
    const draws: number[] = [];
    const probe = defineSystem({
      ...toyDemography,
      step: (ctx, s) => {
        draws.push(ctx.stream().nextUint32());
        toyDemography.step(ctx, s);
      },
    });
    new Engine({ ...baseOptions, systems: [probe] }).advance(3);
    expect(new Set(draws).size).toBe(3);
  });
});

describe('commands', () => {
  it('validates on submit and applies at the next policy step', () => {
    const engine = new Engine(baseOptions);
    expect(engine.submit('economy/set-tax-rate', { rate: 2 })).toEqual({
      ok: false,
      reason: 'rate must be a number in [0, 1]',
    });
    expect(engine.submit('no/such-command', {})).toMatchObject({ ok: false });
    expect(engine.submit('economy/set-tax-rate', { rate: 1n })).toMatchObject({ ok: false });
    expect(engine.submit('economy/set-tax-rate', { rate: 0.3 })).toEqual({ ok: true, seq: 1 });
    expect(engine.world.slices.toyEconomy?.taxRate).toBe(0.2);
    engine.advance(1);
    expect(engine.world.slices.toyEconomy?.taxRate).toBe(0.3);
    expect(engine.commandLog).toEqual([
      { seq: 1, tick: 0, type: 'economy/set-tax-rate', payload: { rate: 0.3 } },
    ]);
  });

  it('replays a world exactly from its seed and command log', () => {
    const original = new Engine(baseOptions);
    original.advance(5);
    original.submit('economy/set-tax-rate', { rate: 0.35 });
    original.advance(7);
    original.submit('economy/set-tax-rate', { rate: 0.1 });
    original.submit('economy/set-tax-rate', { rate: 0.15 });
    original.advance(30);

    const copy = replay(baseOptions, original.commandLog, original.nextTick);
    expect(fingerprint(copy)).toBe(fingerprint(original));
    expect(copy.commandLog).toEqual(original.commandLog);
  });
});
