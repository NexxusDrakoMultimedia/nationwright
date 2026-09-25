// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Fictional naming languages (DESIGN.md §4.12.3 step 6). Each culture family gets its own
 * phoneme inventory, syllable shapes, and characteristic endings, drawn per world, so
 * names within a family sound related and families sound distinct.
 */

import type { RandomStream } from '../random/stream.ts';
import type { NameGuard } from './name-check.ts';

const CONSONANTS = [
  'p',
  'b',
  't',
  'd',
  'k',
  'g',
  'm',
  'n',
  's',
  'z',
  'l',
  'r',
  'v',
  'f',
  'h',
  'sh',
  'kh',
  'th',
  'ch',
  'j',
  'y',
  'w',
  'ng',
  'q',
  'ts',
  'x',
];
const SIMPLE_VOWELS = ['a', 'e', 'i', 'o', 'u'];
const DIGRAPH_VOWELS = ['ae', 'ai', 'ei', 'ou', 'ia', 'aa', 'oo', 'ue'];
const ONSET_CLUSTERS = [
  'tr',
  'dr',
  'br',
  'kr',
  'gr',
  'pr',
  'st',
  'sk',
  'sl',
  'bl',
  'kl',
  'fr',
  'vr',
  'zh',
  'sv',
];
const SHAPES = ['CV', 'CV', 'CVC', 'V', 'VC', 'CCV', 'CVV'];
const PLACE_ENDINGS = [
  'ia',
  'a',
  'an',
  'or',
  'en',
  'ar',
  'ora',
  'esh',
  'ul',
  'eth',
  'ovia',
  'ir',
  'os',
  'et',
  'und',
  'ava',
  'ene',
  'ist',
  'ai',
  'ou',
];
const DEMONYM_ENDINGS = ['i', 'ian', 'ese', 'an', 'ic', 'ite', 'ar', 'en'];
const LANGUAGE_ENDINGS = ['ic', 'ish', 'an', 'ese', 'i', 'ol'];
const CITY_ENDINGS = [
  '',
  '',
  '',
  'grad',
  'vik',
  'ton',
  'pur',
  'abad',
  'ora',
  'heim',
  'polis',
  'mar',
  'ez',
  'ak',
];

function pick<T>(stream: RandomStream, items: readonly T[]): T {
  return items[stream.nextIntBelow(items.length)] as T;
}

function sample<T>(stream: RandomStream, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0)
    out.push(pool.splice(stream.nextIntBelow(pool.length), 1)[0] as T);
  return out;
}

export interface Phonology {
  readonly consonants: readonly string[];
  readonly vowels: readonly string[];
  readonly clusters: readonly string[];
  readonly shapes: readonly string[];
  readonly placeEndings: readonly string[];
  readonly demonymEnding: string;
  readonly languageEnding: string;
  readonly cityEndings: readonly string[];
}

export function randomPhonology(stream: RandomStream): Phonology {
  return {
    consonants: sample(stream, CONSONANTS, 9 + stream.nextIntBelow(7)),
    // Mostly simple vowels; at most one digraph keeps names pronounceable.
    vowels: [
      ...sample(stream, SIMPLE_VOWELS, 3 + stream.nextIntBelow(3)),
      ...(stream.nextFloat64() < 0.6 ? [pick(stream, DIGRAPH_VOWELS)] : []),
    ],
    clusters: sample(stream, ONSET_CLUSTERS, stream.nextIntBelow(4)),
    shapes: sample(stream, SHAPES, 3 + stream.nextIntBelow(3)),
    placeEndings: sample(stream, PLACE_ENDINGS, 2 + stream.nextIntBelow(3)),
    demonymEnding: pick(stream, DEMONYM_ENDINGS),
    languageEnding: pick(stream, LANGUAGE_ENDINGS),
    cityEndings: sample(stream, CITY_ENDINGS, 4),
  };
}

function syllable(p: Phonology, stream: RandomStream): string {
  const shape = pick(stream, p.shapes);
  let out = '';
  let start = 0;
  if (shape.startsWith('CC')) {
    out += p.clusters.length > 0 ? pick(stream, p.clusters) : pick(stream, p.consonants);
    start = 2;
  }
  for (let k = start; k < shape.length; k++) {
    out += shape[k] === 'C' ? pick(stream, p.consonants) : pick(stream, p.vowels);
  }
  return out;
}

/** A root word of 1–3 syllables, at least three letters, without doubled vowels at joins. */
export function root(p: Phonology, stream: RandomStream, syllables = 2): string {
  let word = '';
  while (word.length < 3) {
    word = '';
    for (let s = 0; s < syllables; s++) word += syllable(p, stream);
    word = tidyWord(word);
  }
  return word;
}

/** No triple letters, no runs of three or more vowels. */
export function tidyWord(word: string): string {
  return word.replace(/(.)\1\1+/g, '$1$1').replace(/([aeiou]{2})[aeiou]+/g, '$1');
}

export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Joins a root and an ending, avoiding vowel pile-ups ("Kara" + "ia" → "Karia"). */
export function join(rootWord: string, ending: string): string {
  if (ending === '') return rootWord;
  let base = rootWord;
  if (/[aeiou]$/.test(base) && /^[aeiou]/.test(ending)) {
    const stripped = base.replace(/[aeiou]+$/, '');
    // Never strip a root down to nothing ("ai" + "ism" stays "aism", not "ism").
    base = stripped.length >= 2 ? stripped : base;
  }
  return tidyWord(base + ending);
}

/** Draws names until the guard accepts one. */
export function uniqueName(guard: NameGuard, make: (attempt: number) => string): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    const name = capitalize(make(attempt));
    if (guard.accept(name)) return name;
  }
  throw new Error('Could not generate a unique name.');
}

export const Names = {
  countryRoot: (p: Phonology, s: RandomStream) => root(p, s, 1 + s.nextIntBelow(2)),
  country: (p: Phonology, s: RandomStream, countryRoot: string) =>
    join(countryRoot, pick(s, p.placeEndings)),
  demonym: (p: Phonology, countryRoot: string) => join(countryRoot, p.demonymEnding),
  language: (p: Phonology, s: RandomStream) =>
    join(root(p, s, 1 + s.nextIntBelow(2)), p.languageEnding),
  city: (p: Phonology, s: RandomStream) =>
    join(root(p, s, 1 + s.nextIntBelow(2)), pick(s, p.cityEndings)),
  province: (p: Phonology, s: RandomStream) => join(root(p, s, 2), pick(s, p.placeEndings)),
  faith: (p: Phonology, s: RandomStream) =>
    join(root(p, s, 2), pick(s, ['ism', 'ism', 'ian faith', 'ite faith'])),
} as const;
