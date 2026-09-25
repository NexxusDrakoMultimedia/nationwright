// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The engine host: runs in Electron's utility process and owns the WorldSession. Kept
 * free of Electron imports so it can be tested in plain Node.
 */

import { WorldSession, type Ruleset } from '@nationwright/app';
import {
  dateOfTick,
  describeSeedError,
  formatDate,
  formatSeed,
  generateSeed,
  parseSeed,
} from '@nationwright/engine';
import type {
  EngineEvent,
  EngineMethod,
  EngineRequests,
  FromEngine,
  ToEngine,
  WorldSummary,
} from '../shared/protocol.ts';

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
    'seed.generate': () => formatSeed(generateSeed((bytes) => crypto.getRandomValues(bytes))),

    'seed.check': ({ text }) => {
      const result = parseSeed(text);
      return result.ok
        ? { ok: true, canonical: result.canonical }
        : { ok: false, message: describeSeedError(result.error) };
    },

    'world.create': ({ path, seed }) => {
      if (seed !== undefined) {
        const parsed = parseSeed(seed);
        if (!parsed.ok) throw new Error(describeSeedError(parsed.error));
      }
      this.shutdown();
      this.#session = WorldSession.create({
        path,
        ...(seed === undefined ? {} : { seed }),
        ...this.#sessionOptions(),
      });
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
      seed: session.seedString,
      startYear: world.meta.startYear,
      month: nextTick,
      date: this.#dateText(),
      rulesetVersion: world.meta.rulesetVersion,
      systems: Object.keys(world.slices),
      indicatorSeries: indicators.dump().length,
    };
  }
}
