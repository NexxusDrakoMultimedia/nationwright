// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Small dense linear algebra for statistical models: symmetric matrices as row arrays.
 * Only basic arithmetic and Math.sqrt, in a fixed order, so results are identical on
 * every engine.
 */

export type Matrix = number[][];
export type Vector = number[];

export function zeros(rows: number, cols: number): Matrix {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
}

export function identity(n: number): Matrix {
  const m = zeros(n, n);
  for (let i = 0; i < n; i++) (m[i] as Vector)[i] = 1;
  return m;
}

function at(m: Matrix, i: number, j: number): number {
  return (m[i] as Vector)[j] as number;
}

function set(m: Matrix, i: number, j: number, value: number): void {
  (m[i] as Vector)[j] = value;
}

/** Lower-triangular L with A = L·Lᵀ. Throws if A is not positive definite. */
export function cholesky(a: Matrix): Matrix {
  const n = a.length;
  const l = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = at(a, i, j);
      for (let k = 0; k < j; k++) sum -= at(l, i, k) * at(l, j, k);
      if (i === j) {
        if (!(sum > 0)) throw new RangeError(`Matrix is not positive definite (pivot ${i}).`);
        set(l, i, i, Math.sqrt(sum));
      } else {
        set(l, i, j, sum / at(l, j, j));
      }
    }
  }
  return l;
}

/** Solves A·x = b given the Cholesky factor L of A. */
export function choleskySolve(l: Matrix, b: Vector): Vector {
  const n = l.length;
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = b[i] as number;
    for (let k = 0; k < i; k++) sum -= at(l, i, k) * (y[k] as number);
    y[i] = sum / at(l, i, i);
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i] as number;
    for (let k = i + 1; k < n; k++) sum -= at(l, k, i) * (x[k] as number);
    x[i] = sum / at(l, i, i);
  }
  return x;
}

/** L·v for lower-triangular L. */
export function lowerTimes(l: Matrix, v: Vector): Vector {
  return l.map((row, i) => {
    let sum = 0;
    for (let k = 0; k <= i; k++) sum += (row[k] as number) * (v[k] as number);
    return sum;
  });
}

/**
 * Eigen-decomposition of a symmetric matrix by cyclic Jacobi rotations.
 * Returns eigenvalues and eigenvectors (as columns of `vectors`).
 */
export function symmetricEigen(a: Matrix, maxSweeps = 100): { values: Vector; vectors: Matrix } {
  const n = a.length;
  const m = a.map((row) => [...row]);
  const v = identity(n);
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        const x = at(m, p, q);
        off += x * x;
      }
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = at(m, p, q);
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (at(m, q, q) - at(m, p, p)) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const mkp = at(m, k, p);
          const mkq = at(m, k, q);
          set(m, k, p, c * mkp - s * mkq);
          set(m, k, q, s * mkp + c * mkq);
        }
        for (let k = 0; k < n; k++) {
          const mpk = at(m, p, k);
          const mqk = at(m, q, k);
          set(m, p, k, c * mpk - s * mqk);
          set(m, q, k, s * mpk + c * mqk);
        }
        for (let k = 0; k < n; k++) {
          const vkp = at(v, k, p);
          const vkq = at(v, k, q);
          set(v, k, p, c * vkp - s * vkq);
          set(v, k, q, s * vkp + c * vkq);
        }
      }
    }
  }
  return { values: m.map((row, i) => row[i] as number), vectors: v };
}

/**
 * The nearest (in the eigenvalue-clipping sense) positive-definite matrix: eigenvalues
 * below `floor` are raised to it. Use for covariance estimates from incomplete data.
 */
export function nearestPositiveDefinite(a: Matrix, floor = 1e-6): Matrix {
  const n = a.length;
  const { values, vectors } = symmetricEigen(a);
  const clipped = values.map((x) => Math.max(x, floor));
  const out = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++)
        sum += at(vectors, i, k) * (clipped[k] as number) * at(vectors, j, k);
      set(out, i, j, sum);
      set(out, j, i, sum);
    }
  }
  return out;
}
