// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * World seed codec (DESIGN.md §3.3, D13).
 *
 * A world seed is a 64-bit unsigned integer, written as its 8 big-endian bytes in
 * unpadded base64url (RFC 4648 §5): exactly 11 characters. The 11th character carries
 * only 4 seed bits, so its 2 low bits must be zero; any other spelling is rejected so
 * that every seed has exactly one canonical string.
 */

/** A 64-bit world seed, always in the range [0, 2^64). */
export type WorldSeed = bigint;

export const SEED_MAX: WorldSeed = (1n << 64n) - 1n;
export const SEED_STRING_LENGTH = 11;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const DECODE: ReadonlyMap<string, number> = new Map(
  Array.from(ALPHABET, (char, index) => [char, index] as const),
);

export type SeedParseError =
  | { readonly kind: 'wrong-length'; readonly length: number }
  | { readonly kind: 'invalid-character'; readonly character: string; readonly position: number }
  | { readonly kind: 'non-canonical'; readonly character: string };

export type SeedParseResult =
  | { readonly ok: true; readonly seed: WorldSeed; readonly canonical: string }
  | { readonly ok: false; readonly error: SeedParseError };

export function isWorldSeed(value: bigint): value is WorldSeed {
  return value >= 0n && value <= SEED_MAX;
}

/** Converts a seed to its 8 big-endian bytes. */
export function seedToBytes(seed: WorldSeed): Uint8Array {
  assertSeed(seed);
  const bytes = new Uint8Array(8);
  let rest = seed;
  for (let i = 7; i >= 0; i--) {
    bytes[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return bytes;
}

/** Builds a seed from exactly 8 big-endian bytes. */
export function seedFromBytes(bytes: Uint8Array): WorldSeed {
  if (bytes.length !== 8) {
    throw new RangeError(`A world seed needs exactly 8 bytes, got ${bytes.length}.`);
  }
  let seed = 0n;
  for (const byte of bytes) {
    seed = (seed << 8n) | BigInt(byte);
  }
  return seed;
}

/** Formats a seed as its canonical 11-character base64url string. */
export function formatSeed(seed: WorldSeed): string {
  const bytes = seedToBytes(seed);
  let out = '';
  // 6 full bytes -> 8 characters.
  for (let i = 0; i < 6; i += 3) {
    const n = (at(bytes, i) << 16) | (at(bytes, i + 1) << 8) | at(bytes, i + 2);
    out += char(n >>> 18) + char((n >>> 12) & 63) + char((n >>> 6) & 63) + char(n & 63);
  }
  // Last 2 bytes (16 bits) -> 3 characters (18 bits, low 2 bits zero).
  const n = (at(bytes, 6) << 16) | (at(bytes, 7) << 8);
  out += char(n >>> 18) + char((n >>> 12) & 63) + char((n >>> 6) & 63);
  return out;
}

/**
 * Parses a seed string. Surrounding whitespace is ignored, standard base64 characters
 * (`+`, `/`) are accepted as their base64url equivalents, and a single trailing `=`
 * pad is accepted. Everything else must be exact.
 */
export function parseSeed(input: string): SeedParseResult {
  let text = input.trim();
  if (text.length === SEED_STRING_LENGTH + 1 && text.endsWith('=')) {
    text = text.slice(0, -1);
  }
  text = text.replaceAll('+', '-').replaceAll('/', '_');

  if (text.length !== SEED_STRING_LENGTH) {
    return { ok: false, error: { kind: 'wrong-length', length: text.length } };
  }

  const values: number[] = [];
  for (let position = 0; position < text.length; position++) {
    const character = text.charAt(position);
    const value = DECODE.get(character);
    if (value === undefined) {
      return { ok: false, error: { kind: 'invalid-character', character, position } };
    }
    values.push(value);
  }

  const last = values[SEED_STRING_LENGTH - 1] ?? 0;
  if ((last & 3) !== 0) {
    return { ok: false, error: { kind: 'non-canonical', character: text.charAt(10) } };
  }

  let seed = 0n;
  for (const value of values) {
    seed = (seed << 6n) | BigInt(value);
  }
  seed >>= 2n; // 66 bits decoded; drop the 2 zero padding bits.
  return { ok: true, seed, canonical: text };
}

/** Human-readable description of a parse error, for UI and CLI messages. */
export function describeSeedError(error: SeedParseError): string {
  switch (error.kind) {
    case 'wrong-length':
      return `A world seed has ${SEED_STRING_LENGTH} characters; got ${error.length}.`;
    case 'invalid-character':
      return `"${error.character}" at position ${error.position + 1} is not a base64url character.`;
    case 'non-canonical':
      return `The last character "${error.character}" is not valid for a 64-bit seed; it must be one of AEIMQUYcgkosw048.`;
  }
}

/**
 * Creates a new seed from a source of random bytes. The engine never touches the
 * platform RNG itself; the application layer passes `crypto.getRandomValues`.
 */
export function generateSeed(fillRandom: (bytes: Uint8Array) => Uint8Array): WorldSeed {
  return seedFromBytes(fillRandom(new Uint8Array(8)));
}

function assertSeed(seed: bigint): void {
  if (!isWorldSeed(seed)) {
    throw new RangeError(`A world seed must be in [0, 2^64); got ${seed}.`);
  }
}

function at(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

function char(index: number): string {
  return ALPHABET.charAt(index);
}
