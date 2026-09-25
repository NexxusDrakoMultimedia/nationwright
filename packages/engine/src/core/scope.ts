// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Where a value applies: the player's nation, one of its regions or cities, or another
 * country (DESIGN.md §6.3). Scopes are plain strings so they serialize trivially.
 */
export type Scope = 'nation' | `region:${number}` | `city:${number}` | `country:${number}`;

const SCOPE_PATTERN = /^(?:nation|(?:region|city|country):(?:0|[1-9]\d*))$/;

export function isScope(value: string): value is Scope {
  return SCOPE_PATTERN.test(value);
}

export function assertScope(value: string): asserts value is Scope {
  if (!isScope(value)) throw new RangeError(`Invalid scope "${value}".`);
}
