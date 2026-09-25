// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * FNV-1a 64-bit hash over the UTF-8 bytes of a string. Used to turn stream domain names
 * into 64-bit values (DESIGN.md §3.3). Pinned: changing it changes every world.
 */

const OFFSET_BASIS = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK_64 = (1n << 64n) - 1n;

const encoder = new TextEncoder();

export function fnv1a64(text: string): bigint {
  let hash = OFFSET_BASIS;
  for (const byte of encoder.encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * PRIME) & MASK_64;
  }
  return hash;
}
