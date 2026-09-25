// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

export { SaveFile, type SaveInfo, type SaveOptions } from './save/save-file.ts';
export { MIGRATIONS, SCHEMA_VERSION, migrate, type Migration } from './save/schema.ts';
export { DEFAULT_RULESET, type Ruleset } from './ruleset.ts';
export { WorldSession, type CreateWorldOptions, type OpenWorldOptions } from './world-session.ts';
export { guidingFor, NAME_BLOCKLIST } from './reference.ts';
export { worldSystem, type CountryState, type WorldSlice } from './systems/world.ts';
export {
  demographySystem,
  DEMOGRAPHY_INDICATORS,
  regionSetup,
  type DemographyRegion,
  type DemographySlice,
  type YearCounters,
} from './systems/demography.ts';
export {
  citiesSystem,
  CITY_INDICATORS,
  type CitiesSlice,
  type CityState,
} from './systems/cities.ts';
