// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/** World generator settings (DESIGN.md §4.12). Defaults describe an Earth-like world. */

/** Bump whenever generator output for a given seed and settings changes. */
export const GENERATOR_VERSION = 2;

/** Map size in kilometres (an equirectangular plane that wraps east–west). */
export const MAP_WIDTH_KM = 40_000;
export const MAP_HEIGHT_KM = 20_000;

export interface GeneratorSettings {
  /** Number of sovereign countries, the player's included. No hard limit (D17). */
  readonly countryCount: number;
  /** Fraction of the map that is land. */
  readonly landFraction: number;
  /** Map cells per country (resolution). */
  readonly cellsPerCountry: number;
  /** Shifts every temperature, in °C (negative = colder world). */
  readonly climateBias: number;
}

/** The recommended country range; outside it the wizard shows a realism note (D17). */
export const RECOMMENDED_COUNTRY_RANGE = [20, 250] as const;

export function defaultSettings(stateCount = 196, landFraction = 0.292): GeneratorSettings {
  return { countryCount: stateCount, landFraction, cellsPerCountry: 150, climateBias: 0 };
}

export function validateSettings(s: GeneratorSettings): void {
  if (!Number.isSafeInteger(s.countryCount) || s.countryCount < 2) {
    throw new RangeError('countryCount must be an integer of at least 2.');
  }
  if (!(s.landFraction >= 0.05 && s.landFraction <= 0.9)) {
    throw new RangeError('landFraction must be between 0.05 and 0.9.');
  }
  if (!Number.isSafeInteger(s.cellsPerCountry) || s.cellsPerCountry < 20) {
    throw new RangeError('cellsPerCountry must be an integer of at least 20.');
  }
  if (!(Math.abs(s.climateBias) <= 30)) throw new RangeError('climateBias must be within ±30 °C.');
}

export function cellCountFor(s: GeneratorSettings): number {
  return Math.max(2000, s.countryCount * s.cellsPerCountry);
}
