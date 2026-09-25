// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Gradient noise that tiles east–west (DESIGN.md §4.12.2 step 2). Gradients come from
 * eight fixed directions, so no trigonometry is needed and results are deterministic.
 */

import type { RandomStream } from '../random/stream.ts';

const D = Math.SQRT1_2;
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [D, D],
  [-D, D],
  [D, -D],
  [-D, -D],
];

export class PeriodicNoise {
  readonly #cols: number;
  readonly #rows: number;
  readonly #gradients: Uint8Array;

  /** `cols` lattice cells around the world (the period), `rows` from pole to pole. */
  constructor(cols: number, rows: number, stream: RandomStream) {
    this.#cols = cols;
    this.#rows = rows;
    this.#gradients = new Uint8Array(cols * (rows + 1));
    for (let i = 0; i < this.#gradients.length; i++) this.#gradients[i] = stream.nextIntBelow(8);
  }

  /** Noise at (u, v) with u ∈ [0, 1) wrapping and v ∈ [0, 1]; roughly in [−1, 1]. */
  value(u: number, v: number): number {
    const gx = u * this.#cols;
    const gy = Math.max(0, Math.min(this.#rows - 1e-9, v * this.#rows));
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const dot = (cx: number, cy: number, ox: number, oy: number) => {
      const wrappedX = ((cx % this.#cols) + this.#cols) % this.#cols;
      const g = DIRECTIONS[this.#gradients[cy * this.#cols + wrappedX] as number] as readonly [
        number,
        number,
      ];
      return g[0] * ox + g[1] * oy;
    };
    const n00 = dot(x0, y0, fx, fy);
    const n10 = dot(x0 + 1, y0, fx - 1, fy);
    const n01 = dot(x0, y0 + 1, fx, fy - 1);
    const n11 = dot(x0 + 1, y0 + 1, fx - 1, fy - 1);
    const sx = fade(fx);
    const sy = fade(fy);
    const a = n00 + sx * (n10 - n00);
    const b = n01 + sx * (n11 - n01);
    return (a + sy * (b - a)) * 1.414;
  }
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Fractal (fBm) noise: octaves with doubling frequency and halving amplitude. */
export class FractalNoise {
  readonly #octaves: PeriodicNoise[];

  constructor(baseCols: number, baseRows: number, octaves: number, stream: RandomStream) {
    this.#octaves = Array.from({ length: octaves }, (_, k) => {
      let scale = 1;
      for (let i = 0; i < k; i++) scale *= 2;
      return new PeriodicNoise(baseCols * scale, baseRows * scale, stream);
    });
  }

  value(u: number, v: number): number {
    let sum = 0;
    let amplitude = 1;
    let norm = 0;
    for (const octave of this.#octaves) {
      sum += amplitude * octave.value(u, v);
      norm += amplitude;
      amplitude *= 0.5;
    }
    return sum / norm;
  }
}
