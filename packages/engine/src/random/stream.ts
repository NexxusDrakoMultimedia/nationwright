// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Domain-separated random streams (DESIGN.md §3.3).
 *
 * Every consumer of randomness asks for its own stream by domain name, e.g.
 * `worldgen/elevation` or `sim/demography@tick:123`. A stream is xoshiro256** seeded by
 * SplitMix64(worldSeed XOR fnv1a64(domain)). Streams never share state, so adding a draw
 * in one system can never shift the outcomes of another.
 */

import { fnv1a64 } from './fnv1a64.ts';
import type { WorldSeed } from './seed.ts';
import { SplitMix64 } from './splitmix64.ts';
import { Xoshiro256StarStar } from './xoshiro256.ts';

export type RandomStream = Xoshiro256StarStar;

const DOMAIN_PATTERN = /^[a-z0-9_-]+(?:\/[a-z0-9_:.-]+)*$/;

/**
 * Builds a canonical domain string: slash-separated lowercase path segments, with an
 * optional `@tick:N` suffix. Example: `streamDomain('sim/war/front:45', 123)` gives
 * `sim/war/front:45@tick:123`.
 */
export function streamDomain(path: string, tick?: number): string {
  if (!DOMAIN_PATTERN.test(path)) {
    throw new RangeError(`Invalid stream domain path "${path}".`);
  }
  if (tick === undefined) return path;
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError(`tick must be a non-negative safe integer; got ${tick}.`);
  }
  return `${path}@tick:${tick}`;
}

/** Creates the stream for one domain of one world. */
export function createStream(seed: WorldSeed, domain: string): RandomStream {
  const mixer = new SplitMix64(seed ^ fnv1a64(domain));
  return new Xoshiro256StarStar([mixer.next(), mixer.next(), mixer.next(), mixer.next()]);
}
