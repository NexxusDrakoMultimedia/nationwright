// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The fixed tick pipeline (DESIGN.md §3.2). Systems always run in this order; a step with
 * no registered system is skipped. Changing the order changes every world, so treat it
 * like the generator: bump the ruleset version when it changes.
 */
export const SYSTEM_ORDER = [
  'calendar',
  'events-pre',
  'policy',
  'world',
  'diplomacy',
  'war',
  'demography',
  'education',
  'economy',
  'defense',
  'infrastructure',
  'cities',
  'politics',
  'elections',
  'sports',
  'events-post',
  'indicators',
  'validation',
  'chronicle',
] as const;

export type SystemId = (typeof SYSTEM_ORDER)[number];

export function isSystemId(value: string): value is SystemId {
  return (SYSTEM_ORDER as readonly string[]).includes(value);
}
