// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The typed protocol between the renderer and the engine process (DESIGN.md §9). The
 * renderer talks to the engine over a MessagePort; the main process only brokers the
 * port and owns native dialogs.
 */

import type { Census } from '@nationwright/app/census';

export type { Census, CensusGroup, CensusStat } from '@nationwright/app/census';

export interface WorldSummary {
  readonly path: string;
  readonly startYear: number;
  /** Months simulated so far (the next tick to run). */
  readonly month: number;
  /** Human-readable current date, e.g. "March 2031". */
  readonly date: string;
  readonly rulesetVersion: number;
  readonly systems: readonly string[];
  readonly indicatorSeries: number;
}

/** Per-country data the map screen shows. */
export interface MapCountry {
  readonly id: number;
  readonly name: string;
  readonly demonym: string;
  readonly capital: string;
  readonly capitalCell: number;
  readonly archetype: string;
  readonly government: string;
  readonly continent: number;
  readonly neighbors: readonly number[];
  readonly island: boolean;
  readonly landlocked: boolean;
  readonly areaKm2: number;
  /** Selected statistics by indicator id (real-world units). */
  readonly stats: Readonly<Record<string, number>>;
  /** Largest groups first: [name, share 0–1]. */
  readonly ethnicGroups: readonly (readonly [string, number])[];
  readonly religions: readonly (readonly [string, number])[];
  readonly languages: readonly (readonly [string, number])[];
}

export interface MapCity {
  readonly name: string;
  readonly cell: number;
  readonly country: number;
  readonly population: number;
  readonly capital: boolean;
}

/** Everything needed to draw the world map (typed arrays are copied over the port). */
export interface MapData {
  readonly width: number;
  readonly height: number;
  readonly count: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly land: Uint8Array;
  readonly biome: Uint8Array;
  readonly river: Uint8Array;
  readonly lake: Uint8Array;
  readonly elevation: Float32Array;
  readonly owner: Int32Array;
  readonly population: Float64Array;
  /** km² per cell. */
  readonly cellArea: number;
  readonly countries: readonly MapCountry[];
  readonly cities: readonly MapCity[];
}

/** Every request the renderer can make: its parameters and its result. */
export interface EngineRequests {
  /** Creates a world from a fresh random seed; the seed is never shown (D13). */
  'world.create': { params: { path: string }; result: WorldSummary };
  'world.open': { params: { path: string }; result: WorldSummary };
  'world.advance': { params: { months: number }; result: WorldSummary };
  'world.summary': { params: null; result: WorldSummary | null };
  'world.map': { params: null; result: MapData };
  /** The player's nation now (DESIGN.md §4.1 outputs). */
  'world.census': { params: null; result: Census };
  'world.close': { params: null; result: null };
}

export type EngineMethod = keyof EngineRequests;

export type EngineEvent =
  | {
      readonly type: 'progress';
      readonly done: number;
      readonly total: number;
      readonly date: string;
    }
  | { readonly type: 'saved'; readonly date: string };

export type ToEngine = {
  readonly kind: 'request';
  readonly id: number;
  readonly method: EngineMethod;
  readonly params: unknown;
};

export type FromEngine =
  | { readonly kind: 'response'; readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly kind: 'response'; readonly id: number; readonly ok: false; readonly error: string }
  | { readonly kind: 'event'; readonly event: EngineEvent };

/** What the preload script exposes on `window.nationwright`. */
export interface NationwrightApi {
  request<M extends EngineMethod>(
    method: M,
    params: EngineRequests[M]['params'],
  ): Promise<EngineRequests[M]['result']>;
  onEvent(listener: (event: EngineEvent) => void): () => void;
  chooseNewWorldPath(suggestedName: string): Promise<string | null>;
  chooseWorldToOpen(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  /** A world file the app was launched with (e.g. by double-clicking it), once. */
  initialWorldPath(): Promise<string | null>;
  readonly versions: { readonly electron: string; readonly chrome: string; readonly node: string };
}

/** Links the app may open in the system browser; everything else is refused. */
export const EXTERNAL_LINKS = [
  'https://github.com/NexxusDrakoMultimedia/nationwright',
  'https://www.gnu.org/licenses/gpl-3.0.html',
  'https://github.com/factbook/factbook.json',
] as const;

export function isAllowedExternalLink(url: string): boolean {
  return (EXTERNAL_LINKS as readonly string[]).some(
    (allowed) => url === allowed || url.startsWith(`${allowed}/`),
  );
}

/** IPC channel names between preload and main. */
export const CHANNELS = {
  enginePort: 'nationwright:engine-port',
  chooseNewWorldPath: 'nationwright:choose-new-world-path',
  chooseWorldToOpen: 'nationwright:choose-world-to-open',
  openExternal: 'nationwright:open-external',
  initialWorldPath: 'nationwright:initial-world-path',
} as const;
