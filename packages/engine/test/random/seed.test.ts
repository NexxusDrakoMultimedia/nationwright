// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SEED_MAX,
  describeSeedError,
  formatSeed,
  generateSeed,
  parseSeed,
  seedFromBytes,
  seedToBytes,
} from '../../src/index.ts';

const arbSeed = fc.bigInt({ min: 0n, max: SEED_MAX });

function parsedSeed(text: string): bigint {
  const result = parseSeed(text);
  if (!result.ok) throw new Error(describeSeedError(result.error));
  return result.seed;
}

describe('formatSeed', () => {
  it('formats the edge seeds', () => {
    expect(formatSeed(0n)).toBe('AAAAAAAAAAA');
    expect(formatSeed(SEED_MAX)).toBe('__________8');
    expect(formatSeed(1n)).toBe('AAAAAAAAAAE');
  });

  it('matches Node base64url for the same bytes', () => {
    fc.assert(
      fc.property(arbSeed, (seed) => {
        const expected = Buffer.from(seedToBytes(seed)).toString('base64url');
        expect(formatSeed(seed)).toBe(expected);
      }),
    );
  });

  it('always produces 11 characters with a canonical last character', () => {
    fc.assert(
      fc.property(arbSeed, (seed) => {
        const text = formatSeed(seed);
        expect(text).toMatch(/^[A-Za-z0-9_-]{10}[AEIMQUYcgkosw048]$/);
      }),
    );
  });

  it('rejects values outside [0, 2^64)', () => {
    expect(() => formatSeed(-1n)).toThrow(RangeError);
    expect(() => formatSeed(SEED_MAX + 1n)).toThrow(RangeError);
  });
});

describe('parseSeed', () => {
  it('round-trips every seed', () => {
    fc.assert(
      fc.property(arbSeed, (seed) => {
        const text = formatSeed(seed);
        const result = parseSeed(text);
        expect(result).toEqual({ ok: true, seed, canonical: text });
      }),
    );
  });

  it('decodes the design-doc example', () => {
    const seed = parsedSeed('q3Zk1d0XbAc');
    expect(formatSeed(seed)).toBe('q3Zk1d0XbAc');
    expect(Buffer.from('q3Zk1d0XbAc', 'base64url').equals(Buffer.from(seedToBytes(seed)))).toBe(
      true,
    );
  });

  it('accepts standard base64, one pad character, and surrounding whitespace', () => {
    const seed = SEED_MAX; // "__________8" in base64url, "//////////8=" in base64
    expect(parsedSeed('//////////8=')).toBe(seed);
    expect(parsedSeed('  __________8\n')).toBe(seed);
    const result = parseSeed('//////////8=');
    expect(result.ok && result.canonical).toBe('__________8');
  });

  it('rejects wrong lengths', () => {
    expect(parseSeed('')).toEqual({ ok: false, error: { kind: 'wrong-length', length: 0 } });
    expect(parseSeed('AAAAAAAAAA')).toMatchObject({ ok: false, error: { kind: 'wrong-length' } });
    expect(parseSeed('AAAAAAAAAAAA')).toMatchObject({
      ok: false,
      error: { kind: 'wrong-length' },
    });
    expect(parseSeed('AAAAAAAAAAA==')).toMatchObject({
      ok: false,
      error: { kind: 'wrong-length' },
    });
  });

  it('rejects characters outside the alphabet', () => {
    expect(parseSeed('AAAA AAAAAA')).toEqual({
      ok: false,
      error: { kind: 'invalid-character', character: ' ', position: 4 },
    });
    expect(parseSeed('AAAAAAAAAA=')).toMatchObject({
      ok: false,
      error: { kind: 'invalid-character', character: '=' },
    });
    expect(parseSeed('ÄAAAAAAAAAA')).toMatchObject({
      ok: false,
      error: { kind: 'invalid-character', position: 0 },
    });
  });

  it('rejects a last character with non-zero padding bits', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const canonical = [...alphabet].filter((_, index) => index % 4 === 0).join('');
    expect(canonical).toBe('AEIMQUYcgkosw048');
    for (const last of alphabet) {
      const result = parseSeed(`AAAAAAAAAA${last}`);
      if (canonical.includes(last)) {
        expect(result.ok).toBe(true);
      } else {
        expect(result).toEqual({ ok: false, error: { kind: 'non-canonical', character: last } });
      }
    }
  });

  it('describes every error kind', () => {
    for (const text of ['A', 'AAAAAAAAAA!', 'AAAAAAAAAAB']) {
      const result = parseSeed(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(describeSeedError(result.error).length).toBeGreaterThan(10);
    }
  });
});

describe('bytes and generation', () => {
  it('round-trips bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 8, maxLength: 8 }), (bytes) => {
        expect(seedToBytes(seedFromBytes(bytes))).toEqual(bytes);
      }),
    );
  });

  it('rejects byte arrays of the wrong size', () => {
    expect(() => seedFromBytes(new Uint8Array(7))).toThrow(RangeError);
  });

  it('builds a seed from the supplied random source', () => {
    const seed = generateSeed((bytes) => bytes.fill(0xab));
    expect(seed).toBe(0xababababababababn);
    const real = generateSeed((bytes) => crypto.getRandomValues(bytes));
    expect(real >= 0n && real <= SEED_MAX).toBe(true);
  });
});
