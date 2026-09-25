// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '@nationwright/engine';
import { SCHEMA_VERSION, SaveFile } from '../src/index.ts';
import { baseOptions } from '../../engine/test/core/fixtures.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nationwright-save-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fingerprint(engine: Engine): string {
  const { world, indicators, commandLog, pending } = engine.save();
  return JSON.stringify({ world, indicators, commandLog, pending });
}

const T0 = new Date('2026-09-25T12:00:00Z');
const T1 = new Date('2026-09-25T13:00:00Z');

describe('SaveFile', () => {
  it('creates the schema on open', () => {
    const file = SaveFile.open(join(dir, 'a.nwsave'));
    expect(file.hasWorld).toBe(false);
    file.close();
    const db = new Database(join(dir, 'a.nwsave'));
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('round-trips a world exactly', () => {
    const engine = new Engine(baseOptions);
    engine.advance(18);
    engine.submit('economy/set-tax-rate', { rate: 0.4 });
    engine.advance(6);
    engine.submit('economy/set-tax-rate', { rate: 0.25 }); // still pending at save time

    const file = SaveFile.open(join(dir, 'w.nwsave'));
    file.write(engine.save(), { now: T0 });
    const loaded = file.read();
    file.close();

    expect(JSON.stringify(loaded)).toBe(fingerprint(engine));
  });

  it('resumes as if the game had never stopped', () => {
    const uninterrupted = new Engine(baseOptions);
    uninterrupted.advance(10);
    uninterrupted.submit('economy/set-tax-rate', { rate: 0.3 });
    uninterrupted.advance(50);

    const first = new Engine(baseOptions);
    first.advance(10);
    first.submit('economy/set-tax-rate', { rate: 0.3 });
    const path = join(dir, 'resume.nwsave');
    const file = SaveFile.open(path);
    file.write(first.save(), { now: T0 });
    file.close();

    const reopened = SaveFile.open(path);
    const resumed = Engine.restore(baseOptions, reopened.read());
    resumed.advance(50);
    reopened.write(resumed.save(), { now: T1 });
    const info = reopened.info();
    const again = reopened.read();
    reopened.close();

    expect(fingerprint(resumed)).toBe(fingerprint(uninterrupted));
    expect(JSON.stringify(again)).toBe(fingerprint(uninterrupted));
    expect(info).toEqual({
      schemaVersion: SCHEMA_VERSION,
      generatorVersion: null,
      worldSeed: 'q3Zk1d0XbAc',
      startYear: 2026,
      rulesetVersion: 1,
      nextTick: 60,
      createdAt: T0.toISOString(),
      savedAt: T1.toISOString(),
    });
  });

  it('stores the seed as 8 bytes next to its base64url form', () => {
    const engine = new Engine(baseOptions);
    const path = join(dir, 'seed.nwsave');
    const file = SaveFile.open(path);
    file.write(engine.save(), { now: T0 });
    file.close();
    const db = new Database(path);
    const row = db.prepare("SELECT value FROM meta WHERE key = 'world_seed'").get() as {
      value: Buffer;
    };
    db.close();
    expect(row.value.toString('base64url')).toBe('q3Zk1d0XbAc');
  });

  it('refuses to mix worlds or go back in time', () => {
    const path = join(dir, 'guard.nwsave');
    const a = new Engine(baseOptions);
    a.advance(12);
    const file = SaveFile.open(path);
    file.write(a.save(), { now: T0 });

    const other = new Engine({ ...baseOptions, seed: 'AAAAAAAAAAE' });
    expect(() => file.write(other.save(), { now: T1 })).toThrow(/different world/);
    const earlier = new Engine(baseOptions);
    earlier.advance(6);
    expect(() => file.write(earlier.save(), { now: T1 })).toThrow(/earlier point/);
    expect(file.info().nextTick).toBe(12); // failed writes changed nothing
    file.close();
  });

  it('branches by copying the file', () => {
    const engine = new Engine(baseOptions);
    engine.advance(24);
    const file = SaveFile.open(join(dir, 'main.nwsave'));
    file.write(engine.save(), { now: T0 });
    file.copyTo(join(dir, 'branch.nwsave'));
    const original = file.read();
    file.close();

    const branch = SaveFile.open(join(dir, 'branch.nwsave'));
    expect(JSON.stringify(branch.read())).toBe(JSON.stringify(original));
    branch.close();
  });

  it('rejects saves from a newer schema', () => {
    const path = join(dir, 'future.nwsave');
    const db = new Database(path);
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    expect(() => SaveFile.open(path)).toThrow(/newer/);
  });

  it('rejects restoring into a different ruleset or system set', () => {
    const engine = new Engine(baseOptions);
    engine.advance(3);
    const saved = engine.save();
    expect(() => Engine.restore({ ...baseOptions, rulesetVersion: 2 }, saved)).toThrow(/ruleset/);
    expect(() => Engine.restore({ ...baseOptions, systems: [] }, saved)).toThrow(/slices/);
    expect(() => Engine.restore({ ...baseOptions, startYear: 2027 }, saved)).toThrow(/start year/);
  });
});
