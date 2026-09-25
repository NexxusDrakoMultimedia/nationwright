// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * One SQLite file per save (DESIGN.md §6.3, D3). The engine never touches SQLite; this
 * class converts between `SavedWorld` and the file.
 */

import Database from 'better-sqlite3';
import {
  parseSeed,
  seedToBytes,
  type ChronicleEntry,
  type CommandLogEntry,
  type IndicatorSeriesDump,
  type JsonValue,
  type PendingCommand,
  type SavedWorld,
  type Scope,
  type WorldState,
} from '@nationwright/engine';
import { migrate, SCHEMA_VERSION } from './schema.ts';

export interface SaveInfo {
  readonly schemaVersion: number;
  readonly worldSeed: string;
  readonly startYear: number;
  readonly rulesetVersion: number;
  readonly nextTick: number;
  readonly createdAt: string;
  readonly savedAt: string;
}

export interface SaveOptions {
  /** Wall-clock time of the save (the application layer may read the clock). */
  readonly now?: Date;
}

export class SaveFile {
  readonly #db: Database.Database;

  private constructor(db: Database.Database) {
    this.#db = db;
  }

  /** Opens (creating if needed) a save file and migrates it to the current schema. */
  static open(path: string): SaveFile {
    const db = new Database(path);
    try {
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      migrate(db);
      return new SaveFile(db);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  close(): void {
    this.#db.close();
  }

  /** True once a world has been written to this file. */
  get hasWorld(): boolean {
    return this.#metaValue('world_seed_b64') !== undefined;
  }

  info(): SaveInfo {
    const text = (key: string): string => {
      const value = this.#metaValue(key);
      if (typeof value !== 'string') throw new Error(`Save file is missing meta "${key}".`);
      return value;
    };
    const int = (key: string): number => {
      const value = this.#metaValue(key);
      if (typeof value !== 'number' && typeof value !== 'bigint') {
        throw new Error(`Save file is missing meta "${key}".`);
      }
      return Number(value);
    };
    return {
      schemaVersion: SCHEMA_VERSION,
      worldSeed: text('world_seed_b64'),
      startYear: int('start_year'),
      rulesetVersion: int('ruleset_version'),
      nextTick: int('next_tick'),
      createdAt: text('created_at'),
      savedAt: text('saved_at'),
    };
  }

  /**
   * Writes the world in one transaction. Snapshot rows, pending commands, and the
   * chronicle are rewritten; indicator values and applied commands are append-only, so
   * only rows newer than the file's contents are inserted.
   */
  write(saved: SavedWorld, options: SaveOptions = {}): void {
    const db = this.#db;
    const now = (options.now ?? new Date()).toISOString();
    const { world } = saved;
    const seed = parseSeed(world.meta.worldSeed);
    if (!seed.ok) throw new Error(`World has an invalid seed "${world.meta.worldSeed}".`);

    db.transaction(() => {
      // Indicator values for ticks before this are already in the file and never change.
      let savedThrough = 0;
      if (this.hasWorld) {
        const info = this.info();
        savedThrough = info.nextTick;
        if (info.worldSeed !== world.meta.worldSeed || info.startYear !== world.meta.startYear) {
          throw new Error('This save file belongs to a different world; branch it instead.');
        }
        if (world.meta.nextTick < info.nextTick) {
          throw new Error('Refusing to overwrite a save with an earlier point in time.');
        }
      }

      const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
      if (!this.hasWorld) {
        setMeta.run('world_seed', Buffer.from(seedToBytes(seed.seed)));
        setMeta.run('world_seed_b64', world.meta.worldSeed);
        setMeta.run('start_year', world.meta.startYear);
        setMeta.run('created_at', now);
      }
      setMeta.run('ruleset_version', world.meta.rulesetVersion);
      setMeta.run('next_tick', world.meta.nextTick);
      setMeta.run('saved_at', now);

      // Snapshot: everything except the chronicle, which has its own table.
      db.prepare('DELETE FROM snapshot').run();
      const putPart = db.prepare("INSERT INTO snapshot (part, format, data) VALUES (?, 'json', ?)");
      putPart.run('meta', JSON.stringify(world.meta));
      putPart.run('modifiers', JSON.stringify(world.modifiers));
      for (const [key, slice] of Object.entries(world.slices).sort(([a], [b]) =>
        a < b ? -1 : 1,
      )) {
        putPart.run(`slice:${key}`, JSON.stringify(slice));
      }

      db.prepare('DELETE FROM commands WHERE applied_tick IS NULL').run();
      const putCommand = db.prepare(
        'INSERT OR IGNORE INTO commands (seq, applied_tick, type, payload) VALUES (?, ?, ?, ?)',
      );
      for (const c of saved.commandLog)
        putCommand.run(c.seq, c.tick, c.type, JSON.stringify(c.payload));
      for (const c of saved.pending) putCommand.run(c.seq, null, c.type, JSON.stringify(c.payload));

      const putValue = db.prepare(
        'INSERT OR IGNORE INTO indicators (indicator_id, scope, tick, value) VALUES (?, ?, ?, ?)',
      );
      for (const series of saved.indicators) {
        series.ticks.forEach((tick, i) => {
          if (tick >= savedThrough) putValue.run(series.id, series.scope, tick, series.values[i]);
        });
      }

      db.prepare('DELETE FROM chronicle').run();
      const putEntry = db.prepare(
        'INSERT INTO chronicle (tick, category, text, refs) VALUES (?, ?, ?, ?)',
      );
      for (const e of world.chronicle)
        putEntry.run(e.tick, e.category, e.text, JSON.stringify(e.refs));
    })();
  }

  /** Reads the whole world back as `SavedWorld`, ready for `Engine.restore`. */
  read(): SavedWorld {
    const db = this.#db;
    if (!this.hasWorld) throw new Error('This save file has no world yet.');

    const parts = new Map(
      (db.prepare('SELECT part, data FROM snapshot').all() as { part: string; data: string }[]).map(
        (row) => [row.part, JSON.parse(row.data) as unknown],
      ),
    );
    const slices: Record<string, unknown> = {};
    for (const [part, value] of [...parts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (part.startsWith('slice:')) slices[part.slice('slice:'.length)] = value;
    }

    const chronicle = (
      db.prepare('SELECT tick, category, text, refs FROM chronicle ORDER BY id').all() as {
        tick: number;
        category: string;
        text: string;
        refs: string;
      }[]
    ).map((row): ChronicleEntry => ({ ...row, refs: JSON.parse(row.refs) as Scope[] }));

    const world = {
      meta: parts.get('meta'),
      modifiers: parts.get('modifiers'),
      chronicle,
      slices,
    } as WorldState;

    const commandRows = db
      .prepare('SELECT seq, applied_tick, type, payload FROM commands ORDER BY seq')
      .all() as { seq: number; applied_tick: number | null; type: string; payload: string }[];
    const commandLog: CommandLogEntry[] = [];
    const pending: PendingCommand[] = [];
    for (const row of commandRows) {
      const payload = JSON.parse(row.payload) as JsonValue;
      if (row.applied_tick === null) pending.push({ seq: row.seq, type: row.type, payload });
      else commandLog.push({ seq: row.seq, tick: row.applied_tick, type: row.type, payload });
    }

    const indicators: IndicatorSeriesDump[] = [];
    const rows = db
      .prepare(
        'SELECT indicator_id, scope, tick, value FROM indicators ORDER BY indicator_id, scope, tick',
      )
      .iterate() as IterableIterator<{
      indicator_id: string;
      scope: Scope;
      tick: number;
      value: number;
    }>;
    let current: { id: string; scope: Scope; ticks: number[]; values: number[] } | undefined;
    for (const row of rows) {
      if (current === undefined || current.id !== row.indicator_id || current.scope !== row.scope) {
        current = { id: row.indicator_id, scope: row.scope, ticks: [], values: [] };
        indicators.push(current);
      }
      current.ticks.push(row.tick);
      current.values.push(row.value);
    }

    return { world, indicators, commandLog, pending };
  }

  /** Copies this save to a new file (a branch). The destination must not exist. */
  copyTo(path: string): void {
    this.#db.prepare('VACUUM INTO ?').run(path);
  }

  #metaValue(key: string): unknown {
    const row = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: unknown } | undefined;
    return row?.value;
  }
}
