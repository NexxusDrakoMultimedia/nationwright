// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Converts a generated world to storable parts and back (DESIGN.md §4.12.2: the map is
 * stored in the save, never regenerated on load). Typed-array layers are stored as raw
 * little-endian bytes; everything else as JSON.
 */

import type { GeneratedWorld } from './generate.ts';

export type LayerType = 'f32' | 'f64' | 'i32' | 'u32' | 'u16' | 'u8';

export interface StoredLayer {
  readonly type: LayerType;
  readonly bytes: Uint8Array;
}

export interface StoredWorld {
  readonly json: string;
  readonly layers: Readonly<Record<string, StoredLayer>>;
}

type Typed = Float32Array | Float64Array | Int32Array | Uint32Array | Uint16Array | Uint8Array;

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function layer(array: Typed): StoredLayer {
  if (!LITTLE_ENDIAN) throw new Error('Big-endian platforms are not supported.');
  const type: LayerType =
    array instanceof Float32Array
      ? 'f32'
      : array instanceof Float64Array
        ? 'f64'
        : array instanceof Int32Array
          ? 'i32'
          : array instanceof Uint32Array
            ? 'u32'
            : array instanceof Uint16Array
              ? 'u16'
              : 'u8';
  return {
    type,
    bytes: new Uint8Array(
      array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength),
    ),
  };
}

function typed(stored: StoredLayer | undefined, name: string): Typed {
  if (stored === undefined) throw new Error(`Saved world is missing map layer "${name}".`);
  const buffer = stored.bytes.buffer.slice(
    stored.bytes.byteOffset,
    stored.bytes.byteOffset + stored.bytes.byteLength,
  );
  switch (stored.type) {
    case 'f32':
      return new Float32Array(buffer);
    case 'f64':
      return new Float64Array(buffer);
    case 'i32':
      return new Int32Array(buffer);
    case 'u32':
      return new Uint32Array(buffer);
    case 'u16':
      return new Uint16Array(buffer);
    case 'u8':
      return new Uint8Array(buffer);
  }
}

export function storeWorld(world: GeneratedWorld): StoredWorld {
  const { map } = world;
  const { grid, terrain, hydrology } = map;
  const layers: Record<string, StoredLayer> = {
    'grid.x': layer(grid.x),
    'grid.y': layer(grid.y),
    'grid.offsets': layer(grid.offsets),
    'grid.neighbors': layer(grid.neighbors),
    'terrain.elevation': layer(terrain.elevation),
    'terrain.land': layer(terrain.land),
    'terrain.temperature': layer(terrain.temperature),
    'terrain.moisture': layer(terrain.moisture),
    'terrain.biome': layer(terrain.biome),
    'terrain.coastal': layer(terrain.coastal),
    'terrain.oceanDistance': layer(terrain.oceanDistance),
    'hydrology.downstream': layer(hydrology.downstream),
    'hydrology.flow': layer(hydrology.flow),
    'hydrology.river': layer(hydrology.river),
    'hydrology.lake': layer(hydrology.lake),
    habitability: layer(map.habitability),
    landmass: layer(map.landmass),
    owner: layer(map.owner),
    province: layer(map.province),
    population: layer(map.population),
    'resources.kind': layer(map.resources.kind),
    'resources.richness': layer(map.resources.richness),
  };
  const json = JSON.stringify({
    generatorVersion: world.generatorVersion,
    guidingModelVersion: world.guidingModelVersion,
    settings: world.settings,
    grid: { width: grid.width, height: grid.height, count: grid.count, spacing: grid.spacing },
    countries: world.countries,
    cities: world.cities,
    provinceNames: world.provinceNames,
    cultures: world.cultures,
    continentCount: world.continentCount,
    subregionCount: world.subregionCount,
  });
  return { json, layers };
}

export function loadWorld(stored: StoredWorld): GeneratedWorld {
  const meta = JSON.parse(stored.json) as Omit<GeneratedWorld, 'map'> & {
    grid: { width: number; height: number; count: number; spacing: number };
  };
  const get = <T extends Typed>(name: string) => typed(stored.layers[name], name) as T;
  const { grid, ...rest } = meta;
  return {
    ...rest,
    map: {
      grid: {
        ...grid,
        x: get<Float64Array>('grid.x'),
        y: get<Float64Array>('grid.y'),
        offsets: get<Uint32Array>('grid.offsets'),
        neighbors: get<Uint32Array>('grid.neighbors'),
      },
      terrain: {
        elevation: get<Float32Array>('terrain.elevation'),
        land: get<Uint8Array>('terrain.land'),
        temperature: get<Float32Array>('terrain.temperature'),
        moisture: get<Float32Array>('terrain.moisture'),
        biome: get<Uint8Array>('terrain.biome'),
        coastal: get<Uint8Array>('terrain.coastal'),
        oceanDistance: get<Uint16Array>('terrain.oceanDistance'),
      },
      hydrology: {
        downstream: get<Int32Array>('hydrology.downstream'),
        flow: get<Float32Array>('hydrology.flow'),
        river: get<Uint8Array>('hydrology.river'),
        lake: get<Uint8Array>('hydrology.lake'),
      },
      habitability: get<Float32Array>('habitability'),
      landmass: get<Int32Array>('landmass'),
      owner: get<Int32Array>('owner'),
      province: get<Int32Array>('province'),
      population: get<Float64Array>('population'),
      resources: {
        kind: get<Uint8Array>('resources.kind'),
        richness: get<Float32Array>('resources.richness'),
      },
    },
  };
}
