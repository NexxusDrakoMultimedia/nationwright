// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { describe, expect, it } from 'vitest';
import { createStream, parseSeed, streamDomain } from '../../src/index.ts';

const seedResult = parseSeed('q3Zk1d0XbAc');
if (!seedResult.ok) throw new Error('fixture seed must parse');
const SEED = seedResult.seed;

function draw(domain: string, count = 8): bigint[] {
  const stream = createStream(SEED, domain);
  return Array.from({ length: count }, () => stream.nextBigUint64());
}

describe('streamDomain', () => {
  it('builds canonical domain strings', () => {
    expect(streamDomain('worldgen/elevation')).toBe('worldgen/elevation');
    expect(streamDomain('sim/war/front:45', 123)).toBe('sim/war/front:45@tick:123');
    expect(streamDomain('sim/demography', 0)).toBe('sim/demography@tick:0');
  });

  it('rejects malformed paths and ticks', () => {
    expect(() => streamDomain('Sim/Demography')).toThrow(RangeError);
    expect(() => streamDomain('sim//x')).toThrow(RangeError);
    expect(() => streamDomain('sim/x@tick:1')).toThrow(RangeError);
    expect(() => streamDomain('sim/x', -1)).toThrow(RangeError);
    expect(() => streamDomain('sim/x', 1.5)).toThrow(RangeError);
  });
});

describe('createStream', () => {
  it('is deterministic for the same seed and domain', () => {
    expect(draw('worldgen/elevation')).toEqual(draw('worldgen/elevation'));
  });

  it('separates domains', () => {
    const a = draw('worldgen/elevation');
    const b = draw('worldgen/countries');
    const c = draw(streamDomain('sim/demography', 1));
    const d = draw(streamDomain('sim/demography', 2));
    expect(a).not.toEqual(b);
    expect(c).not.toEqual(d);
  });

  it('separates seeds', () => {
    const other = createStream(SEED ^ 1n, 'worldgen/elevation');
    expect(Array.from({ length: 8 }, () => other.nextBigUint64())).not.toEqual(
      draw('worldgen/elevation'),
    );
  });

  // Golden master: pins the whole derivation (FNV-1a, SplitMix64, xoshiro256**). If this
  // changes, every existing world changes: bump generator_version and update deliberately.
  it('matches the golden master for q3Zk1d0XbAc / worldgen/elevation', () => {
    expect(draw('worldgen/elevation', 4)).toMatchInlineSnapshot(`
      [
        13528423456273696784n,
        13127834521040933671n,
        11032858686440784656n,
        15330878218513221885n,
      ]
    `);
  });
});
