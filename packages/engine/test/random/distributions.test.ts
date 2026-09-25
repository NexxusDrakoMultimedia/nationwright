// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { describe, expect, it } from 'vitest';
import {
  createStream,
  exponential,
  logNormal,
  normal,
  parseSeed,
  poisson,
  shuffle,
  uniformOpen,
  weightedIndex,
  type RandomStream,
} from '../../src/index.ts';

const seed = (() => {
  const r = parseSeed('q3Zk1d0XbAc');
  if (!r.ok) throw new Error('bad fixture seed');
  return r.seed;
})();

function stream(name: string): RandomStream {
  return createStream(seed, `test/${name}`);
}

function moments(xs: readonly number[]): { mean: number; variance: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return { mean, variance };
}

const N = 50_000;

describe('distributions', () => {
  it('uniformOpen never returns 0', () => {
    const s = stream('uniform');
    for (let i = 0; i < 10_000; i++) expect(uniformOpen(s)).toBeGreaterThan(0);
  });

  it('normal has the requested mean and variance', () => {
    const s = stream('normal');
    const { mean, variance } = moments(Array.from({ length: N }, () => normal(s, 10, 2)));
    expect(mean).toBeCloseTo(10, 1);
    expect(variance).toBeGreaterThan(3.8);
    expect(variance).toBeLessThan(4.2);
    expect(normal(s, 5, 0)).toBe(5);
    expect(() => normal(s, 0, -1)).toThrow(RangeError);
  });

  it('logNormal is positive with the right median', () => {
    const s = stream('lognormal');
    const xs = Array.from({ length: N }, () => logNormal(s, 0, 0.5)).sort((a, b) => a - b);
    expect(xs[0]).toBeGreaterThan(0);
    expect(xs[N / 2]).toBeCloseTo(1, 1);
  });

  it('exponential has mean 1/rate', () => {
    const s = stream('exponential');
    const { mean } = moments(Array.from({ length: N }, () => exponential(s, 4)));
    expect(mean).toBeCloseTo(0.25, 2);
    expect(() => exponential(s, 0)).toThrow(RangeError);
  });

  it.each([0.5, 7, 29.9, 30, 250])('poisson(%s) has mean ≈ variance ≈ λ', (lambda) => {
    const s = stream(`poisson-${lambda}`);
    const xs = Array.from({ length: N }, () => poisson(s, lambda));
    const { mean, variance } = moments(xs);
    expect(xs.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
    expect(Math.abs(mean - lambda)).toBeLessThan(4 * Math.sqrt(lambda / N) + 0.01);
    expect(variance / lambda).toBeGreaterThan(0.95);
    expect(variance / lambda).toBeLessThan(1.05);
  });

  it('poisson edge cases', () => {
    const s = stream('poisson-edge');
    expect(poisson(s, 0)).toBe(0);
    expect(() => poisson(s, -1)).toThrow(RangeError);
    expect(() => poisson(s, Infinity)).toThrow(RangeError);
  });

  it('weightedIndex follows the weights and skips zeros', () => {
    const s = stream('weighted');
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      const k = weightedIndex(s, [1, 0, 3, 0]);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts[1]).toBe(0);
    expect(counts[3]).toBe(0);
    expect((counts[2] ?? 0) / N).toBeCloseTo(0.75, 1);
    expect(() => weightedIndex(s, [0, 0])).toThrow(RangeError);
    expect(() => weightedIndex(s, [1, -1])).toThrow(RangeError);
  });

  it('shuffle is a permutation and deterministic', () => {
    const a = shuffle(stream('shuffle'), [...Array(20).keys()]);
    const b = shuffle(stream('shuffle'), [...Array(20).keys()]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([...Array(20).keys()]);
    expect(a).not.toEqual([...Array(20).keys()]);
  });

  it('pins sampler output for the fixture seed', () => {
    const s = stream('golden');
    expect([normal(s), exponential(s), poisson(s, 3), poisson(s, 100)]).toMatchInlineSnapshot(`
      [
        0.8913209741926764,
        0.6531557033866504,
        4,
        87,
      ]
    `);
  });
});
