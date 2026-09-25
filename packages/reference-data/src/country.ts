// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/** Turns one Factbook profile into a parsed country record. */

import {
  extractField,
  FIELDS,
  normalizeKeys,
  textAt,
  type ExtractIssue,
  type Observation,
  type Profile,
} from './fields.ts';
import type { RegionDirectory } from './source.ts';
import { parseNumber, parseShareList, type ShareItem } from './text.ts';

/**
 * - state: a sovereign or de facto independent state; used for validation bands.
 * - territory: a populated dependency or disputed territory; parsed, but not in bands.
 * - excluded: uninhabited, supranational, or not a country at all.
 */
export type EntityKind = 'state' | 'territory' | 'excluded';

/** Non-dependency entries that are not states (by Factbook code). */
export const NON_STATE_CODES: Readonly<Record<string, Exclude<EntityKind, 'state'>>> = {
  ee: 'excluded', // European Union
  ay: 'excluded', // Antarctica
  pf: 'excluded', // Paracel Islands
  pg: 'excluded', // Spratly Islands
  wi: 'territory', // Western Sahara
  gz: 'territory', // Gaza Strip
  we: 'territory', // West Bank
};

/** Coarse government categories for guiding variables (keyword rules, first match wins). */
const GOVERNMENT_RULES: readonly (readonly [RegExp, string])[] = [
  [/communist/, 'communist state'],
  [/theocra/, 'theocracy'],
  [/military/, 'military regime'],
  [/absolute monarchy/, 'absolute monarchy'],
  [/semi-presidential/, 'semi-presidential republic'],
  [/presidential/, 'presidential republic'],
  [/parliamentary (?:constitutional )?monarchy|constitutional monarchy/, 'constitutional monarchy'],
  [/monarchy|emirate|sultanate|kingdom/, 'monarchy (other)'],
  [/parliamentary/, 'parliamentary republic'],
  [/republic/, 'republic (other)'],
];

export interface Border {
  readonly name: string;
  readonly km: number | null;
}

export interface CountryRecord {
  readonly code: string;
  readonly region: RegionDirectory;
  readonly name: string;
  readonly kind: EntityKind;
  readonly fields: Readonly<Record<string, Observation>>;
  readonly borders: readonly Border[];
  readonly landlocked: boolean;
  readonly governmentType: string | null;
  readonly governmentCategory: string | null;
  readonly ethnicGroups: readonly ShareItem[];
  readonly religions: readonly ShareItem[];
  readonly languages: readonly ShareItem[];
}

export function parseProfile(
  code: string,
  region: RegionDirectory,
  raw: unknown,
  issues: ExtractIssue[],
): CountryRecord {
  const profile = normalizeKeys(raw) as Profile;
  const government = profile['Government'] ?? {};
  const people = profile['People and Society'] ?? {};

  const fields: Record<string, Observation> = {};
  const localIssues: ExtractIssue[] = [];
  for (const spec of FIELDS) {
    const observation = extractField(profile, spec, localIssues);
    if (observation !== null) fields[spec.id] = observation;
  }

  const populationText =
    textAt((people['Population'] as Record<string, unknown> | undefined)?.['total']) ??
    textAt(people['Population']) ??
    '';
  const uninhabited =
    !/\d/.test(populationText) ||
    /uninhabited|no (?:permanent|indigenous) inhabitants/i.test(populationText);
  const kind: EntityKind = uninhabited
    ? 'excluded'
    : (NON_STATE_CODES[code] ??
      (government['Dependency status'] !== undefined ? 'territory' : 'state'));

  if (kind !== 'excluded') {
    issues.push(...localIssues.map((i) => ({ ...i, field: `${code}:${i.field}` })));
  }

  const governmentType = textAt(government['Government type']) ?? null;
  const lower = governmentType?.toLowerCase() ?? '';
  const governmentCategory =
    governmentType === null
      ? null
      : (GOVERNMENT_RULES.find(([re]) => re.test(lower))?.[1] ?? 'other');

  const coastline =
    textAt(profile['Geography']?.['Coastline']) ??
    textAt(
      (profile['Geography']?.['Coastline'] as Record<string, unknown> | undefined)?.['total'],
    ) ??
    '';

  return {
    code,
    region,
    name: countryName(government),
    kind,
    fields,
    borders: parseBorders(profile['Geography']?.['Land boundaries']),
    landlocked: /^0 km\b/.test(coastline) || /landlocked/i.test(coastline),
    governmentType,
    governmentCategory,
    ethnicGroups: shareList(people['Ethnic groups']),
    religions: shareList(people['Religions']),
    languages: shareList(people['Languages']),
  };
}

function countryName(government: Record<string, unknown>): string {
  const names = government['Country name'] as Record<string, unknown> | undefined;
  for (const key of ['conventional short form', 'conventional long form', 'local short form']) {
    const text = textAt(names?.[key]);
    if (text !== undefined && text.toLowerCase() !== 'none') return text;
  }
  return '?';
}

function parseBorders(node: unknown): Border[] {
  if (node === null || typeof node !== 'object') return [];
  const entry = Object.entries(node as Record<string, unknown>).find(([key]) =>
    key.startsWith('border countries'),
  );
  const text = entry === undefined ? undefined : textAt(entry[1]);
  if (text === undefined) return [];
  return text
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const match = /^(.*?)\s+([\d,.]+)\s*km\b/.exec(part);
      return match === null
        ? { name: part, km: null }
        : { name: (match[1] ?? '').trim(), km: parseNumber(match[2] ?? '') };
    });
}

function shareList(node: unknown): ShareItem[] {
  let text = textAt(node);
  if (text === undefined && node !== null && typeof node === 'object') {
    // Some profiles nest the list one level down, e.g. Languages -> { Languages: {text} }.
    for (const value of Object.values(node as Record<string, unknown>)) {
      text = textAt(value);
      if (text !== undefined) break;
    }
  }
  return text === undefined ? [] : parseShareList(text);
}
