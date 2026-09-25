// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Save-file schema and migrations (DESIGN.md §6.3). Migrations run in order on open; each
 * one moves a file from version N-1 to N inside a transaction. Never edit a released
 * migration: add a new one.
 */

import type Database from 'better-sqlite3';

export interface Migration {
  readonly version: number;
  readonly description: string;
  up(db: Database.Database): void;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'Initial schema: meta, snapshot, commands, indicators, chronicle',
    up(db) {
      db.exec(`
        CREATE TABLE meta (
          key   TEXT PRIMARY KEY,
          value NOT NULL
        ) WITHOUT ROWID;

        -- Latest full engine state, one row per part (meta, modifiers, slice:<key>).
        CREATE TABLE snapshot (
          part   TEXT PRIMARY KEY,
          format TEXT NOT NULL CHECK (format IN ('json')),
          data   BLOB NOT NULL
        ) WITHOUT ROWID;

        -- Append-only command log; applied_tick is NULL while a command is pending.
        CREATE TABLE commands (
          seq          INTEGER PRIMARY KEY,
          applied_tick INTEGER,
          type         TEXT NOT NULL,
          payload      TEXT NOT NULL
        );

        CREATE TABLE indicators (
          indicator_id TEXT NOT NULL,
          scope        TEXT NOT NULL,
          tick         INTEGER NOT NULL,
          value        REAL NOT NULL,
          PRIMARY KEY (indicator_id, scope, tick)
        ) WITHOUT ROWID;

        CREATE TABLE chronicle (
          id       INTEGER PRIMARY KEY,
          tick     INTEGER NOT NULL,
          category TEXT NOT NULL,
          text     TEXT NOT NULL,
          refs     TEXT NOT NULL
        );
        CREATE INDEX chronicle_by_tick ON chronicle (tick);
      `);
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

/** Brings a database up to SCHEMA_VERSION. Returns the version it started at. */
export function migrate(db: Database.Database): number {
  const from = db.pragma('user_version', { simple: true }) as number;
  if (from > SCHEMA_VERSION) {
    throw new Error(
      `Save file schema v${from} is newer than this version of Nationwright supports (v${SCHEMA_VERSION}).`,
    );
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;
    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
  return from;
}
