// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The world generator (DESIGN.md §4.12): world seed + settings + guiding variables →
 * a fictional world. Every stage has its own random stream (`worldgen/<stage>`), so
 * changing one stage never shifts another.
 */

import type { WorldSeed } from '../random/seed.ts';
import { createStream } from '../random/stream.ts';
import {
  computeHabitability,
  findLandmasses,
  growTerritories,
  landNeighbors,
  nearestCapital,
  placeCapitals,
  sampleNations,
} from './countries.ts';
import {
  generateCultures,
  type CountryCulture,
  type CultureFamily,
  type WorldCultures,
} from './culture.ts';
import { cellDistance, generateGrid, type CellGrid } from './grid.ts';
import { NameGuard } from './name-check.ts';
import { Names, uniqueName } from './names.ts';
import type { GuidingVariables } from './guiding.ts';
import { generateHydrology, type Hydrology } from './hydrology.ts';
import { prepareModel, type NationSample } from './nation-stats.ts';
import {
  assignProvinces,
  cellsByCountry,
  distributePopulation,
  placeCities,
  type City,
} from './places.ts';
import {
  cellCountFor,
  GENERATOR_VERSION,
  MAP_HEIGHT_KM,
  MAP_WIDTH_KM,
  validateSettings,
  type GeneratorSettings,
} from './settings.ts';
import { generateResources, type Resources } from './resources.ts';
import { generateClimate, generateElevation, type Terrain } from './terrain.ts';

export interface GeneratedCountry {
  readonly id: number;
  readonly name: string;
  /** Adjective and people, e.g. "Talvari". */
  readonly demonym: string;
  readonly culture: CountryCulture;
  readonly capitalCell: number;
  readonly nation: NationSample;
  readonly cellCount: number;
  /** Map-derived area, km² (the nation's sampled area is the growth target). */
  readonly mapAreaKm2: number;
  readonly neighbors: readonly number[];
  readonly landlocked: boolean;
  readonly island: boolean;
  readonly continent: number;
  readonly subregion: number;
  readonly firstProvince: number;
  readonly provinceCount: number;
}

export interface WorldMapLayers {
  readonly grid: CellGrid;
  readonly terrain: Terrain;
  readonly hydrology: Hydrology;
  readonly habitability: Float32Array;
  readonly landmass: Int32Array;
  readonly owner: Int32Array;
  readonly province: Int32Array;
  readonly population: Float64Array;
  readonly resources: Resources;
}

export interface GeneratedWorld {
  readonly generatorVersion: number;
  readonly guidingModelVersion: number;
  readonly settings: GeneratorSettings;
  readonly map: WorldMapLayers;
  readonly countries: readonly GeneratedCountry[];
  readonly cities: readonly NamedCity[];
  readonly provinceNames: readonly string[];
  readonly cultures: Omit<WorldCultures, 'countries'>;
  /** Landmasses with at least two countries or 2% of all land, largest first. */
  readonly continentCount: number;
  readonly subregionCount: number;
}

export interface NamedCity extends City {
  readonly name: string;
}

/**
 * @param nameBlocklist hashes of real country and capital names (`nameHash`), from
 *   packages/reference-data/data/name-blocklist.json; generated names never match them.
 */
export function generateWorld(
  seed: WorldSeed,
  settings: GeneratorSettings,
  guiding: GuidingVariables,
  nameBlocklist: readonly string[] = [],
): GeneratedWorld {
  validateSettings(settings);
  const stream = (stage: string) => createStream(seed, `worldgen/${stage}`);
  const prepared = prepareModel(guiding);

  const grid = generateGrid(cellCountFor(settings), MAP_WIDTH_KM, MAP_HEIGHT_KM, stream('grid'));
  const islandNations = Math.round(settings.countryCount * guiding.structure.islandShare);
  const { elevation, land } = generateElevation(
    grid,
    settings.landFraction,
    Math.round(islandNations * 2.5),
    stream('elevation'),
  );
  const terrain = generateClimate(grid, elevation, land, settings, stream('climate'));
  const hydrology = generateHydrology(grid, terrain);
  const resources = generateResources(grid, terrain, stream('resources'));
  const habitability = computeHabitability(grid, terrain, hydrology);
  const { id: landmass, sizes: landmassSizes } = findLandmasses(grid, land);

  const placed = placeCapitals(
    grid,
    land,
    terrain.coastal,
    habitability,
    landmass,
    landmassSizes,
    settings.countryCount,
    islandNations,
    stream('capitals'),
  );
  const capitals = placed.cells;
  const provisional = nearestCapital(grid, land, capitals);
  const provisionalNeighbors = landNeighbors(grid, provisional, capitals.length);
  const room = capitals.map(() => 0);
  provisional.forEach((k) => {
    if (k >= 0) room[k] = (room[k] as number) + 1;
  });
  const nations = sampleNations(
    prepared,
    provisionalNeighbors,
    placed.island,
    room,
    stream('nations'),
  );

  // Growth targets: land cells shared in proportion to the nations' sampled areas.
  let landCells = 0;
  for (let i = 0; i < grid.count; i++) landCells += land[i] as number;
  const areas = nations.map((n) => n.stats['geography.area_km2'] ?? 1);
  const totalArea = areas.reduce((a, b) => a + b, 0);
  const targets = areas.map((a) => Math.max(1, Math.round((a / totalArea) * landCells)));
  const owner = growTerritories(grid, terrain, hydrology, capitals, targets);

  const cells = cellsByCountry(owner, capitals.length);
  const neighbors = landNeighbors(grid, owner, capitals.length);
  const { province, provinceCounts } = assignProvinces(grid, owner, cells, capitals);
  const populations = nations.map((n) => n.stats['population.total'] ?? 0);
  const population = distributePopulation(owner, cells, habitability, populations);
  const urban = nations.map(
    (n, k) => ((populations[k] as number) * (n.stats['population.urban_share'] ?? 50)) / 100,
  );
  const cities = placeCities(grid, terrain, hydrology, cells, capitals, population, urban);

  // Continents: landmasses with at least two countries or 2% of all land, largest first.
  // Island nations and other small landmasses belong to the nearest continent.
  const capitalsOn = new Map<number, number>();
  for (const c of capitals) {
    const lm = landmass[c] as number;
    capitalsOn.set(lm, (capitalsOn.get(lm) ?? 0) + 1);
  }
  const continentLandmasses = [...capitalsOn.keys()]
    .filter(
      (lm) =>
        (capitalsOn.get(lm) as number) >= 2 || (landmassSizes[lm] as number) >= 0.02 * landCells,
    )
    .sort((a, b) => a - b);
  const continentOf = new Map(continentLandmasses.map((lm, rank) => [lm, rank]));
  const continent = capitals.map((c) => {
    const own = continentOf.get(landmass[c] as number);
    if (own !== undefined) return own;
    let best = 0;
    let bestD = Infinity;
    capitals.forEach((other) => {
      const lm = continentOf.get(landmass[other] as number);
      if (lm === undefined) return;
      const d = cellDistance(grid, c, other);
      if (d < bestD) {
        bestD = d;
        best = lm;
      }
    });
    return best;
  });
  const subregion = assignSubregions(neighbors, continent);

  // Cultures and names.
  const guard = new NameGuard(nameBlocklist);
  const cultureStream = stream('culture');
  const cultures = generateCultures(
    grid,
    {
      capitals,
      neighbors,
      ethnicGroupCounts: nations.map((n) => n.ethnicGroups),
      religionCounts: nations.map((n) => n.religions),
      languageCounts: nations.map((n) => n.languages),
      ethnicFractionalization: nations.map(
        (n) => n.stats['society.ethnic_fractionalization'] ?? 0.3,
      ),
      religiousFractionalization: nations.map(
        (n) => n.stats['society.religious_fractionalization'] ?? 0.3,
      ),
    },
    guard,
    cultureStream,
  );
  const nameStream = stream('names');
  const phonologyOf = (k: number) =>
    (cultures.families[(cultures.countries[k] as CountryCulture).family] as CultureFamily)
      .phonology;
  const countryNames = capitals.map((_, k) =>
    uniqueName(guard, (attempt) => {
      const countryRoot = cultures.countryRoots[k] as string;
      // Keep the demonym's root; if its endings are all taken, extend the root.
      const extended =
        attempt < 20
          ? countryRoot
          : countryRoot + Names.countryRoot(phonologyOf(k), nameStream).slice(0, 2);
      return Names.country(phonologyOf(k), nameStream, extended);
    }),
  );
  const namedCities: NamedCity[] = cities.map((city) => ({
    ...city,
    name: uniqueName(guard, () => Names.city(phonologyOf(city.country), nameStream)),
  }));
  const provinceNames: string[] = [];
  provinceCounts.forEach((count, k) => {
    for (let p = 0; p < count; p++)
      provinceNames.push(uniqueName(guard, () => Names.province(phonologyOf(k), nameStream)));
  });

  const cellArea = (grid.width * grid.height) / grid.count;
  let firstProvince = 0;
  const countries: GeneratedCountry[] = capitals.map((capitalCell, k) => {
    const list = cells[k] as number[];
    const coastal = list.some((c) => terrain.coastal[c] === 1);
    const country: GeneratedCountry = {
      id: k,
      name: countryNames[k] as string,
      demonym: cultures.ethnicGroups[
        (cultures.countries[k] as CountryCulture).ethnic[0]?.id ?? 0
      ] as string,
      culture: cultures.countries[k] as CountryCulture,
      capitalCell,
      nation: nations[k] as NationSample,
      cellCount: list.length,
      mapAreaKm2: Math.round(list.length * cellArea),
      neighbors: neighbors[k] as number[],
      landlocked: !coastal,
      island: (neighbors[k] as number[]).length === 0,
      continent: continent[k] as number,
      subregion: subregion[k] as number,
      firstProvince,
      provinceCount: provinceCounts[k] as number,
    };
    firstProvince += provinceCounts[k] as number;
    return country;
  });

  return {
    generatorVersion: GENERATOR_VERSION,
    guidingModelVersion: guiding.modelVersion,
    settings,
    map: {
      grid,
      terrain,
      hydrology,
      habitability,
      landmass,
      owner,
      province,
      population,
      resources,
    },
    countries,
    cities: namedCities,
    provinceNames,
    cultures: {
      families: cultures.families,
      ethnicGroups: cultures.ethnicGroups,
      faiths: cultures.faiths,
      languages: cultures.languages,
    },
    continentCount: Math.max(1, continentLandmasses.length),
    subregionCount: Math.max(0, ...subregion) + 1,
  };
}

/**
 * Subregions: clusters of about eight neighbouring countries on the same continent,
 * grown breadth-first over the land-border graph.
 */
function assignSubregions(
  neighbors: readonly (readonly number[])[],
  continent: readonly number[],
): number[] {
  const n = neighbors.length;
  const region = new Array<number>(n).fill(-1);
  const target = 8;
  let next = 0;
  for (let start = 0; start < n; start++) {
    if (region[start] !== -1) continue;
    const id = next++;
    const queue = [start];
    region[start] = id;
    let size = 1;
    for (let head = 0; head < queue.length && size < target; head++) {
      for (const j of neighbors[queue[head] as number] ?? []) {
        if (size >= target) break;
        if (region[j] !== -1 || continent[j] !== continent[start]) continue;
        region[j] = id;
        queue.push(j);
        size++;
      }
    }
  }
  return region;
}
