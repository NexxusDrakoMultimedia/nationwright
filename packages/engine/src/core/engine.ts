// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The simulation engine: owns the world state, runs the fixed tick pipeline, applies
 * queued commands, and records indicators. Pure and deterministic: given the same seed,
 * start year, systems, and command log it always produces the same world.
 */

import { formatSeed, parseSeed, type WorldSeed } from '../random/seed.ts';
import { createStream, streamDomain } from '../random/stream.ts';
import { cadencesOfTick, dateOfTick } from './calendar.ts';
import {
  toJsonPayload,
  type CommandLogEntry,
  type CommandSpec,
  type JsonValue,
  type SubmitResult,
} from './commands.ts';
import { IndicatorStore, type IndicatorSeriesDump } from './indicators.ts';
import { addModifier, createModifierState, pruneExpired, resolveModifiers } from './modifiers.ts';
import { SYSTEM_ORDER, type SystemId } from './pipeline.ts';
import type { DeepReadonly } from './readonly.ts';
import type { SliceKey, SystemSlices, WorldState } from './state.ts';
import type { InitContext, SystemDefinition, TickContext } from './system.ts';
import type { GeneratedWorld } from '../worldgen/generate.ts';

/** Any system, whatever slice it owns. */
export type AnySystem = { [K in SliceKey]: SystemDefinition<K> }[SliceKey];

export interface EngineOptions {
  /** The world seed, as a bigint or its base64url string. */
  readonly seed: WorldSeed | string;
  /** Supplied by the application layer (the engine never reads the clock). */
  readonly startYear: number;
  readonly rulesetVersion?: number;
  readonly systems?: readonly AnySystem[];
  /** The generated world (map and nations). Required again, from the save, on restore. */
  readonly generated?: GeneratedWorld;
  // Command specs are contravariant in their payload type, so accept any payload here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly commands?: readonly CommandSpec<any>[];
}

export const RULESET_VERSION = 2;

export interface PendingCommand {
  readonly seq: number;
  readonly type: string;
  readonly payload: JsonValue;
}

/** Everything needed to resume a world exactly where it stopped. */
export interface SavedWorld {
  readonly world: WorldState;
  readonly indicators: readonly IndicatorSeriesDump[];
  readonly commandLog: readonly CommandLogEntry[];
  readonly pending: readonly PendingCommand[];
}

export class Engine {
  readonly #seed: WorldSeed;
  readonly #generated: GeneratedWorld | undefined;
  readonly #world: WorldState;
  readonly #systems: ReadonlyMap<SystemId, AnySystem>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly #commands: ReadonlyMap<string, CommandSpec<any>>;
  readonly #indicators = new IndicatorStore();
  readonly #log: CommandLogEntry[] = [];
  #pending: PendingCommand[] = [];
  #nextSeq = 1;

  /** Creates a new world, or resumes `saved` if given (see `Engine.restore`). */
  constructor(options: EngineOptions, saved?: SavedWorld) {
    this.#seed = resolveSeed(options.seed);
    this.#generated = options.generated;
    if (!Number.isSafeInteger(options.startYear)) {
      throw new RangeError(`startYear must be an integer; got ${options.startYear}.`);
    }

    const systems = new Map<SystemId, AnySystem>();
    const slices = new Set<string>();
    for (const system of options.systems ?? []) {
      if (systems.has(system.id)) throw new Error(`Two systems registered for "${system.id}".`);
      if (slices.has(system.slice)) throw new Error(`Two systems own slice "${system.slice}".`);
      systems.set(system.id, system);
      slices.add(system.slice);
      for (const definition of system.indicators ?? []) {
        if (definition.owner !== system.id) {
          throw new Error(
            `Indicator "${definition.id}" is declared by ${system.id} but owned by ${definition.owner}.`,
          );
        }
        this.#indicators.register(definition);
      }
    }
    this.#systems = systems;

    const commands = new Map<string, CommandSpec<JsonValue>>();
    for (const spec of options.commands ?? []) {
      if (commands.has(spec.type)) throw new Error(`Command "${spec.type}" is registered twice.`);
      commands.set(spec.type, spec);
    }
    this.#commands = commands;

    if (saved !== undefined) {
      this.#world = restoreWorld(options, this.#seed, systems, saved);
      this.#indicators.restore(saved.indicators);
      this.#log.push(...saved.commandLog);
      this.#pending = [...saved.pending];
      const seqs = [...saved.commandLog, ...saved.pending].map((c) => c.seq);
      this.#nextSeq = Math.max(0, ...seqs) + 1;
      return;
    }

    this.#world = {
      meta: {
        worldSeed: formatSeed(this.#seed),
        startYear: options.startYear,
        rulesetVersion: options.rulesetVersion ?? RULESET_VERSION,
        nextTick: 0,
      },
      modifiers: createModifierState(),
      chronicle: [],
      slices: {},
    };

    for (const id of SYSTEM_ORDER) {
      const system = systems.get(id);
      if (system === undefined) continue;
      const ctx: InitContext = {
        startYear: options.startYear,
        generated: options.generated,
        world: this.#world,
        stream: (name) => createStream(this.#seed, streamDomain(domainPath('init', id, name))),
      };
      setSlice(this.#world, system, system.init(ctx));
    }
    this.#world.slices = sortedSlices(this.#world.slices);
  }

  /** The generated world this engine runs on, if any. */
  get generated(): GeneratedWorld | undefined {
    return this.#generated;
  }

  get seed(): WorldSeed {
    return this.#seed;
  }

  get world(): DeepReadonly<WorldState> {
    return this.#world;
  }

  get nextTick(): number {
    return this.#world.meta.nextTick;
  }

  get indicators(): Pick<
    IndicatorStore,
    'definition' | 'definitions' | 'series' | 'latest' | 'dump'
  > {
    return this.#indicators;
  }

  get commandLog(): readonly CommandLogEntry[] {
    return this.#log;
  }

  /** Resumes a saved world. The options must describe the same seed, start year, and rules. */
  static restore(options: EngineOptions, saved: SavedWorld): Engine {
    return new Engine(options, saved);
  }

  /** Commands accepted but not yet applied, in submission order. */
  get pendingCommands(): readonly PendingCommand[] {
    return this.#pending;
  }

  /** Everything a save file needs, as independent plain data. */
  save(): SavedWorld {
    return {
      world: this.snapshot(),
      indicators: this.#indicators.dump(),
      commandLog: structuredClone(this.#log),
      pending: structuredClone(this.#pending),
    };
  }

  /** Validates a command now and queues it for the next tick's policy step. */
  submit(type: string, payload: unknown): SubmitResult {
    const spec = this.#commands.get(type);
    if (spec === undefined) return { ok: false, reason: `Unknown command "${type}".` };
    let data: JsonValue;
    try {
      data = toJsonPayload(payload);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const validation = spec.validate(data, this.#world);
    if (!validation.ok) return { ok: false, reason: validation.reason };
    const seq = this.#nextSeq++;
    this.#pending.push({ seq, type, payload: toJsonPayload(validation.payload) });
    return { ok: true, seq };
  }

  /** Runs `ticks` whole ticks. */
  advance(ticks = 1): void {
    if (!Number.isSafeInteger(ticks) || ticks < 0) {
      throw new RangeError(`ticks must be a non-negative integer; got ${ticks}.`);
    }
    for (let i = 0; i < ticks; i++) this.#runTick();
  }

  /** A deep copy of the world state, safe to serialize or mutate. */
  snapshot(): WorldState {
    return structuredClone(this.#world);
  }

  #runTick(): void {
    const world = this.#world;
    const tick = world.meta.nextTick;
    const date = dateOfTick(world.meta.startYear, tick);
    const cadences = cadencesOfTick(tick);

    pruneExpired(world.modifiers, tick);

    for (const id of SYSTEM_ORDER) {
      if (id === 'policy') this.#applyCommands(tick);
      const system = this.#systems.get(id);
      if (system === undefined) continue;
      const ctx = this.#tickContext(id, tick, date, cadences);
      stepSystem(world, system, ctx);
    }

    world.meta.nextTick = tick + 1;
  }

  #applyCommands(tick: number): void {
    const pending = this.#pending;
    this.#pending = [];
    for (const command of pending) {
      const spec = this.#commands.get(command.type);
      if (spec === undefined) continue; // unreachable: checked at submit
      // Re-validate against the state the command will actually apply to.
      const validation = spec.validate(command.payload, this.#world);
      if (!validation.ok) continue;
      spec.apply(this.#world, validation.payload, tick);
      this.#log.push({ seq: command.seq, tick, type: command.type, payload: command.payload });
    }
  }

  #tickContext(
    id: SystemId,
    tick: number,
    date: TickContext['date'],
    cadences: TickContext['cadences'],
  ): TickContext {
    const world = this.#world;
    return {
      tick,
      date,
      cadences,
      world,
      stream: (name) => createStream(this.#seed, streamDomain(domainPath('sim', id, name), tick)),
      record: (indicatorId, scope, value) =>
        this.#indicators.record(indicatorId, scope, tick, value, id),
      addModifier: (spec) =>
        addModifier(world.modifiers, { ...spec, startTick: spec.startTick ?? tick }),
      resolve: (target, scope, base) =>
        resolveModifiers(world.modifiers, tick, target, scope, base),
      chronicle: (entry) => {
        // Fixed field order, so serialized worlds compare byte for byte.
        world.chronicle.push({
          tick,
          category: entry.category,
          text: entry.text,
          refs: [...entry.refs],
        });
      },
    };
  }
}

/**
 * Rebuilds a world from its options and command log: replays each logged command at the
 * tick it was originally applied, then runs until `untilTick`.
 */
export function replay(
  options: EngineOptions,
  log: readonly CommandLogEntry[],
  untilTick: number,
): Engine {
  const engine = new Engine(options);
  const byTick = new Map<number, CommandLogEntry[]>();
  for (const entry of [...log].sort((a, b) => a.seq - b.seq)) {
    const list = byTick.get(entry.tick) ?? [];
    list.push(entry);
    byTick.set(entry.tick, list);
  }
  while (engine.nextTick < untilTick) {
    for (const entry of byTick.get(engine.nextTick) ?? []) {
      const result = engine.submit(entry.type, entry.payload);
      if (!result.ok) {
        throw new Error(
          `Replay failed at tick ${entry.tick}, command ${entry.seq}: ${result.reason}`,
        );
      }
    }
    engine.advance(1);
  }
  return engine;
}

function restoreWorld(
  options: EngineOptions,
  seed: WorldSeed,
  systems: ReadonlyMap<SystemId, AnySystem>,
  saved: SavedWorld,
): WorldState {
  const meta = saved.world.meta;
  const expectedRuleset = options.rulesetVersion ?? RULESET_VERSION;
  if (meta.worldSeed !== formatSeed(seed)) {
    throw new Error(`Saved world seed ${meta.worldSeed} does not match ${formatSeed(seed)}.`);
  }
  if (meta.startYear !== options.startYear) {
    throw new Error(`Saved start year ${meta.startYear} does not match ${options.startYear}.`);
  }
  if (meta.rulesetVersion !== expectedRuleset) {
    throw new Error(
      `Saved ruleset version ${meta.rulesetVersion} does not match ${expectedRuleset}; migrate the save first.`,
    );
  }
  const expected = [...systems.values()].map((s) => s.slice as string).sort();
  const actual = Object.keys(saved.world.slices).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(
      `Saved slices [${actual.join(', ')}] do not match registered systems [${expected.join(', ')}].`,
    );
  }
  const world = structuredClone(saved.world);
  world.slices = sortedSlices(world.slices);
  return world;
}

/** Slices are kept in key order so serialized worlds compare byte for byte. */
function sortedSlices(slices: WorldState['slices']): WorldState['slices'] {
  return Object.fromEntries(
    Object.entries(slices).sort(([a], [b]) => (a < b ? -1 : 1)),
  ) as WorldState['slices'];
}

function resolveSeed(seed: WorldSeed | string): WorldSeed {
  if (typeof seed === 'bigint') {
    formatSeed(seed); // range check
    return seed;
  }
  const parsed = parseSeed(seed);
  if (!parsed.ok) throw new RangeError(`Invalid world seed "${seed}".`);
  return parsed.seed;
}

function domainPath(root: 'init' | 'sim', id: SystemId, name?: string): string {
  return name === undefined ? `${root}/${id}` : `${root}/${id}/${name}`;
}

// The two helpers below are where the slice/system pairing is erased; keeping the casts
// here lets every system see its own slice type exactly.
function setSlice<K extends SliceKey>(
  world: WorldState,
  system: SystemDefinition<K>,
  slice: SystemSlices[K],
): void {
  (world.slices as Record<string, unknown>)[system.slice] = slice;
}

function stepSystem<K extends SliceKey>(
  world: WorldState,
  system: SystemDefinition<K>,
  ctx: TickContext,
): void {
  const slice = (world.slices as Record<string, unknown>)[system.slice] as SystemSlices[K];
  system.step(ctx, slice);
}
