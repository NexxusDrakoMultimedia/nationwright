// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * SplitMix64 (Steele, Lea & Flood; reference C by Sebastiano Vigna). Only used to expand
 * a 64-bit seed into xoshiro256** state, so it works in `bigint` for clarity.
 */

const MASK_64 = (1n << 64n) - 1n;
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;

export class SplitMix64 {
  #state: bigint;

  constructor(seed: bigint) {
    this.#state = seed & MASK_64;
  }

  next(): bigint {
    this.#state = (this.#state + GOLDEN_GAMMA) & MASK_64;
    let z = this.#state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
    return z ^ (z >> 31n);
  }
}
