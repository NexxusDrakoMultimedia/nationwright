// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { describe, expect, it } from 'vitest';
import {
  cholesky,
  choleskySolve,
  lowerTimes,
  nearestPositiveDefinite,
  normalCdf,
  normalQuantile,
  symmetricEigen,
  type Matrix,
} from '../../src/index.ts';

describe('normal distribution', () => {
  it('matches standard table values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959963985)).toBeCloseTo(0.975, 7);
    expect(normalCdf(-1)).toBeCloseTo(0.158655254, 7);
    expect(normalCdf(3)).toBeCloseTo(0.998650102, 7);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963985, 8);
    expect(normalQuantile(0.5)).toBe(0);
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232306, 8);
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1.5)).toBeNaN();
  });

  it('round-trips quantile and cdf', () => {
    for (let p = 0.0005; p < 1; p += 0.0137) {
      expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 6);
    }
  });
});

const spd: Matrix = [
  [4, 2, 0.6],
  [2, 3, 0.4],
  [0.6, 0.4, 2],
];

describe('linear algebra', () => {
  it('factors and solves with Cholesky', () => {
    const l = cholesky(spd);
    const product = spd.map((_, i) =>
      spd.map((__, j) => l[i]!.reduce((s, x, k) => s + x * (l[j]![k] ?? 0), 0)),
    );
    product.forEach((row, i) => row.forEach((x, j) => expect(x).toBeCloseTo(spd[i]![j]!, 12)));
    const x = choleskySolve(l, [1, 2, 3]);
    const back = spd.map((row) => row.reduce((s, a, k) => s + a * x[k]!, 0));
    back.forEach((v, i) => expect(v).toBeCloseTo([1, 2, 3][i]!, 12));
    expect(lowerTimes(l, [1, 0, 0])).toEqual(l.map((row) => row[0]));
    expect(() =>
      cholesky([
        [1, 2],
        [2, 1],
      ]),
    ).toThrow(RangeError);
  });

  it('finds eigenpairs of a symmetric matrix', () => {
    const { values, vectors } = symmetricEigen(spd);
    for (let k = 0; k < 3; k++) {
      const v = vectors.map((row) => row[k]!);
      const av = spd.map((row) => row.reduce((s, a, j) => s + a * v[j]!, 0));
      av.forEach((x, i) => expect(x).toBeCloseTo(values[k]! * v[i]!, 10));
    }
    expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(9, 10); // trace
  });

  it('repairs an indefinite correlation matrix', () => {
    const bad: Matrix = [
      [1, 0.9, -0.9],
      [0.9, 1, 0.9],
      [-0.9, 0.9, 1],
    ];
    expect(() => cholesky(bad)).toThrow();
    expect(() => cholesky(nearestPositiveDefinite(bad))).not.toThrow();
  });
});
