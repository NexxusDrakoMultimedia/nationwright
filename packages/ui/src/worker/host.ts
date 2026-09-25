// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The engine host: runs in Electron's utility process and owns the WorldSession. Kept
 * free of Electron imports so it can be tested in plain Node.
 */

import { guidingFor, WorldSession, type Ruleset } from '@nationwright/app';
import { dateOfTick, formatDate } from '@nationwright/engine';
import type {
  EngineEvent,
  EngineMethod,
  EngineRequests,
  FromEngine,
  ToEngine,
  WorldSummary,
} from '../shared/protocol.ts';

/** Statistics sent with the map (profile panel and choropleth layers). */
export const MAP_STATS = [
  'population.total',
  'economy.gdp_per_capita_ppp',
  'economy.gdp_nominal',
  'population.life_expectancy',
  'population.tfr',
  'population.median_age',
  'population.urban_share',
  'communications.internet_users',
  'education.literacy',
  'military.expenditure_share',
] as const;

export interface HostOptions {
  readonly ruleset?: Ruleset;
  readonly now?: () => Date;
  /** Progress events are sent at most every this many months (default 12). */
  readonly progressEvery?: number;
}

type Handlers = {
  [M in EngineMethod]: (params: EngineRequests[M]['params']) => EngineRequests[M]['result'];
};

export class EngineHost {
  #session: WorldSession | null = null;
  #path = '';
  readonly #options: HostOptions;
  readonly #emit: (event: EngineEvent) => void;

  constructor(emit: (event: EngineEvent) => void, options: HostOptions = {}) {
    this.#emit = emit;
    this.#options = options;
  }

  /** Handles one request message and returns the response message. */
  handle(message: ToEngine): FromEngine {
    try {
      const handler = this.#handlers[message.method] as ((params: unknown) => unknown) | undefined;
      if (handler === undefined) throw new Error(`Unknown method "${String(message.method)}".`);
      return { kind: 'response', id: message.id, ok: true, result: handler(message.params) };
    } catch (error) {
      return {
        kind: 'response',
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Saves and closes any open world (on app quit). */
  shutdown(): void {
    this.#session?.close();
    this.#session = null;
  }

  readonly #handlers: Handlers = {
    'world.create': ({ path }) => {
      this.shutdown();
      this.#session = WorldSession.create({ path, ...this.#sessionOptions() });
      this.#path = path;
      return this.#summary();
    },

    'world.open': ({ path }) => {
      this.shutdown();
      this.#session = WorldSession.open(path, this.#sessionOptions());
      this.#path = path;
      return this.#summary();
    },

    'world.advance': ({ months }) => {
      const session = this.#requireSession();
      if (!Number.isSafeInteger(months) || months < 1 || months > 12 * 500) {
        throw new RangeError('months must be an integer from 1 to 6000.');
      }
      const every = this.#options.progressEvery ?? 12;
      let done = 0;
      session.advance(months, () => {
        done += 1;
        if (done % every === 0 || done === months) {
          this.#emit({ type: 'progress', done, total: months, date: this.#dateText() });
        }
      });
      session.save();
      this.#emit({ type: 'saved', date: this.#dateText() });
      return this.#summary();
    },

    'world.summary': () => (this.#session === null ? null : this.#summary()),

    'world.map': () => {
      const engine = this.#requireSession().engine;
      const generated = engine.generated;
      if (generated === undefined) throw new Error('This world has no map.');
      const slice = engine.world.slices.world;
      const guiding = guidingFor(engine.world.meta.startYear);
      const { grid, terrain, hydrology, owner, population } = generated.map;
      const { ethnicGroups, faiths, languages } = generated.cultures;
      const top = (groups: readonly { id: number; share: number }[], names: readonly string[]) =>
        [...groups]
          .sort((a, b) => b.share - a.share)
          .slice(0, 4)
          .map((g) => [names[g.id] ?? '?', g.share] as const);
      const capitalName = new Map(
        generated.cities.filter((c) => c.capital).map((c) => [c.country, c.name]),
      );
      return {
        width: grid.width,
        height: grid.height,
        count: grid.count,
        x: grid.x,
        y: grid.y,
        land: terrain.land,
        biome: terrain.biome,
        river: hydrology.river,
        lake: hydrology.lake,
        elevation: terrain.elevation,
        owner,
        population,
        cellArea: (grid.width * grid.height) / grid.count,
        countries: generated.countries.map((c) => {
          const state = slice?.countries[c.id];
          const stats = state?.stats ?? c.nation.stats;
          return {
            id: c.id,
            name: state?.name ?? c.name,
            demonym: state?.demonym ?? c.demonym,
            capital: capitalName.get(c.id) ?? '?',
            capitalCell: c.capitalCell,
            archetype: guiding.archetypes[c.nation.archetype]?.label ?? '?',
            government: state?.governmentCategory ?? c.nation.governmentCategory,
            continent: c.continent,
            neighbors: c.neighbors,
            island: c.island,
            landlocked: c.landlocked,
            areaKm2: c.mapAreaKm2,
            stats: Object.fromEntries(MAP_STATS.map((id) => [id, stats[id] ?? Number.NaN])),
            ethnicGroups: top(c.culture.ethnic, ethnicGroups),
            religions: top(c.culture.religions, faiths),
            languages: top(c.culture.languages, languages),
          };
        }),
        cities: generated.cities.map((c) => ({
          name: c.name,
          cell: c.cell,
          country: c.country,
          population: c.population,
          capital: c.capital,
        })),
      };
    },

    'world.close': () => {
      this.shutdown();
      return null;
    },
  };

  #sessionOptions() {
    return {
      ...(this.#options.ruleset === undefined ? {} : { ruleset: this.#options.ruleset }),
      ...(this.#options.now === undefined ? {} : { now: this.#options.now }),
    };
  }

  #requireSession(): WorldSession {
    if (this.#session === null) throw new Error('No world is open.');
    return this.#session;
  }

  #dateText(): string {
    const engine = this.#requireSession().engine;
    return formatDate(dateOfTick(engine.world.meta.startYear, engine.nextTick));
  }

  #summary(): WorldSummary {
    const session = this.#requireSession();
    const { world, nextTick, indicators } = session.engine;
    return {
      path: this.#path,
      startYear: world.meta.startYear,
      month: nextTick,
      date: this.#dateText(),
      rulesetVersion: world.meta.rulesetVersion,
      systems: Object.keys(world.slices),
      indicatorSeries: indicators.dump().length,
    };
  }
}
