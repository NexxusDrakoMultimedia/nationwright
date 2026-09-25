// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * A running world bound to its save file: create or open, advance, autosave, branch.
 * This is the application layer (DESIGN.md §3.4), so it may read the clock and the
 * platform RNG; the engine may not.
 */

import { existsSync } from 'node:fs';
import {
  Engine,
  formatSeed,
  generateSeed,
  replay,
  type EngineOptions,
  type SubmitResult,
  type WorldSeed,
} from '@nationwright/engine';
import { DEFAULT_RULESET, type Ruleset } from './ruleset.ts';
import { SaveFile } from './save/save-file.ts';

export interface CreateWorldOptions {
  /** Path of the new save file; must not exist yet. */
  readonly path: string;
  /** World seed (bigint or base64url); a fresh random seed if omitted. */
  readonly seed?: WorldSeed | string;
  /** Defaults to the current UTC year (D7). */
  readonly startYear?: number;
  readonly ruleset?: Ruleset;
  /** Autosave every this many simulated years (0 disables; default 5). */
  readonly autosaveYears?: number;
  /** Clock for timestamps and the default start year (tests pass a fixed one). */
  readonly now?: () => Date;
}

export interface OpenWorldOptions {
  readonly ruleset?: Ruleset;
  readonly autosaveYears?: number;
  readonly now?: () => Date;
}

export class WorldSession {
  readonly #file: SaveFile;
  readonly #engine: Engine;
  readonly #options: EngineOptions;
  readonly #autosaveTicks: number;
  readonly #now: () => Date;
  #lastSavedTick: number;

  private constructor(
    file: SaveFile,
    engine: Engine,
    options: EngineOptions,
    autosaveYears: number,
    now: () => Date,
  ) {
    this.#file = file;
    this.#engine = engine;
    this.#options = options;
    this.#autosaveTicks = Math.max(0, Math.round(autosaveYears * 12));
    this.#now = now;
    this.#lastSavedTick = engine.nextTick;
  }

  /** Creates a new world and writes its initial state. */
  static create(options: CreateWorldOptions): WorldSession {
    if (existsSync(options.path)) throw new Error(`${options.path} already exists.`);
    const now = options.now ?? (() => new Date());
    const ruleset = options.ruleset ?? DEFAULT_RULESET;
    const engineOptions: EngineOptions = {
      seed: options.seed ?? generateSeed((bytes) => crypto.getRandomValues(bytes)),
      startYear: options.startYear ?? now().getUTCFullYear(),
      rulesetVersion: ruleset.version,
      systems: ruleset.systems,
      commands: ruleset.commands,
    };
    const engine = new Engine(engineOptions);
    const file = SaveFile.open(options.path);
    file.write(engine.save(), { now: now() });
    return new WorldSession(file, engine, engineOptions, options.autosaveYears ?? 5, now);
  }

  /** Opens an existing save and resumes it exactly. */
  static open(path: string, options: OpenWorldOptions = {}): WorldSession {
    if (!existsSync(path)) throw new Error(`${path} does not exist.`);
    const file = SaveFile.open(path);
    try {
      const saved = file.read();
      const ruleset = options.ruleset ?? DEFAULT_RULESET;
      const engineOptions: EngineOptions = {
        seed: saved.world.meta.worldSeed,
        startYear: saved.world.meta.startYear,
        rulesetVersion: ruleset.version,
        systems: ruleset.systems,
        commands: ruleset.commands,
      };
      const engine = Engine.restore(engineOptions, saved);
      return new WorldSession(
        file,
        engine,
        engineOptions,
        options.autosaveYears ?? 5,
        options.now ?? (() => new Date()),
      );
    } catch (error) {
      file.close();
      throw error;
    }
  }

  get engine(): Engine {
    return this.#engine;
  }

  get seedString(): string {
    return formatSeed(this.#engine.seed);
  }

  submit(type: string, payload: unknown): SubmitResult {
    return this.#engine.submit(type, payload);
  }

  /**
   * Advances tick by tick, autosaving whenever the configured interval has passed.
   * `onTick` receives progress (for CLI output or UI progress bars).
   */
  advance(ticks: number, onTick?: (tick: number) => void): void {
    for (let i = 0; i < ticks; i++) {
      this.#engine.advance(1);
      onTick?.(this.#engine.nextTick);
      if (
        this.#autosaveTicks > 0 &&
        this.#engine.nextTick - this.#lastSavedTick >= this.#autosaveTicks
      ) {
        this.save();
      }
    }
  }

  save(): void {
    this.#file.write(this.#engine.save(), { now: this.#now() });
    this.#lastSavedTick = this.#engine.nextTick;
  }

  /**
   * Writes a new save that replays this world's command log up to `atTick` (default: the
   * present), leaving this session untouched. The branch then diverges freely.
   */
  branch(path: string, atTick: number = this.#engine.nextTick): void {
    if (existsSync(path)) throw new Error(`${path} already exists.`);
    if (!Number.isSafeInteger(atTick) || atTick < 0 || atTick > this.#engine.nextTick) {
      throw new RangeError(`Branch tick must be in [0, ${this.#engine.nextTick}]; got ${atTick}.`);
    }
    const log = this.#engine.commandLog.filter((entry) => entry.tick < atTick);
    const branched = replay(this.#options, log, atTick);
    const file = SaveFile.open(path);
    try {
      file.write(branched.save(), { now: this.#now() });
    } finally {
      file.close();
    }
  }

  /** Saves and closes the file. */
  close(): void {
    this.save();
    this.#file.close();
  }
}
