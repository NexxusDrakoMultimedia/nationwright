// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The typed protocol between the renderer and the engine process (DESIGN.md §9). The
 * renderer talks to the engine over a MessagePort; the main process only brokers the
 * port and owns native dialogs.
 */

export interface WorldSummary {
  readonly path: string;
  readonly seed: string;
  readonly startYear: number;
  /** Months simulated so far (the next tick to run). */
  readonly month: number;
  /** Human-readable current date, e.g. "March 2031". */
  readonly date: string;
  readonly rulesetVersion: number;
  readonly systems: readonly string[];
  readonly indicatorSeries: number;
}

export type SeedCheck =
  | { readonly ok: true; readonly canonical: string }
  | { readonly ok: false; readonly message: string };

/** Every request the renderer can make: its parameters and its result. */
export interface EngineRequests {
  'seed.generate': { params: null; result: string };
  'seed.check': { params: { text: string }; result: SeedCheck };
  'world.create': { params: { path: string; seed?: string }; result: WorldSummary };
  'world.open': { params: { path: string }; result: WorldSummary };
  'world.advance': { params: { months: number }; result: WorldSummary };
  'world.summary': { params: null; result: WorldSummary | null };
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
} as const;
