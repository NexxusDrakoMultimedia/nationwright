// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Keeps generated names fictional and inoffensive (D12). Real country and capital names
 * are checked by hash (the blocklist ships as FNV-1a hashes, not as a list of names).
 */

import { fnv1a64 } from '../random/fnv1a64.ts';

/** Lowercase ASCII letters only, diacritics removed: "Côte d'Ivoire" → "cotedivoire". */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export function nameHash(name: string): string {
  return fnv1a64(normalizeName(name)).toString(16).padStart(16, '0');
}

/** Substrings that must never appear in a generated name (slurs and profanity). */
const OFFENSIVE = [
  'fuck',
  'shit',
  'cunt',
  'nigg',
  'nigr',
  'fag',
  'kike',
  'spic',
  'chink',
  'gook',
  'wetback',
  'rape',
  'nazi',
  'kkk',
  'slut',
  'whore',
  'dick',
  'cock',
  'piss',
  'twat',
  'wank',
  'retard',
  'coon',
  'dyke',
  'tranny',
  'hitler',
  'isis',
  'jihad',
];

export class NameGuard {
  readonly #blocked: ReadonlySet<string>;
  readonly #used = new Set<string>();

  constructor(blockedHashes: readonly string[]) {
    this.#blocked = new Set(blockedHashes);
  }

  /** True if the name is fictional, inoffensive, and not yet used in this world. */
  accept(name: string): boolean {
    const key = normalizeName(name);
    if (key.length < 3 || this.#used.has(key)) return false;
    if (OFFENSIVE.some((bad) => key.includes(bad))) return false;
    if (this.#blocked.has(nameHash(name))) return false;
    this.#used.add(key);
    return true;
  }
}
