// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Engine, RULESET_VERSION, replay } from '@nationwright/engine';
import { SaveFile, WorldSession, type Ruleset } from '../src/index.ts';
import {
  baseOptions,
  setTaxRate,
  toyDemography,
  toyEconomy,
} from '../../engine/test/core/fixtures.ts';

const ruleset: Ruleset = {
  version: RULESET_VERSION,
  systems: [toyDemography, toyEconomy],
  commands: [setTaxRate],
};
const now = () => new Date('2026-09-25T12:00:00Z');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nationwright-session-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fingerprint(engine: Engine): string {
  return JSON.stringify(engine.save());
}

describe('WorldSession', () => {
  it('creates a world with a random seed and the current year by default', () => {
    const session = WorldSession.create({ path: join(dir, 'a.nwsave'), ruleset, now });
    expect(session.seedString).toMatch(/^[A-Za-z0-9_-]{10}[AEIMQUYcgkosw048]$/);
    expect(session.engine.world.meta.startYear).toBe(2026);
    session.close();
    const other = WorldSession.create({ path: join(dir, 'b.nwsave'), ruleset, now });
    expect(other.seedString).not.toBe(session.seedString);
    other.close();
  });

  it('refuses to overwrite an existing file', () => {
    const path = join(dir, 'x.nwsave');
    WorldSession.create({ path, ruleset, now, seed: 'q3Zk1d0XbAc' }).close();
    expect(() => WorldSession.create({ path, ruleset, now })).toThrow(/already exists/);
  });

  it('autosaves on the configured interval', () => {
    const path = join(dir, 'auto.nwsave');
    const session = WorldSession.create({
      path,
      ruleset,
      now,
      seed: 'q3Zk1d0XbAc',
      autosaveYears: 1,
    });
    session.advance(30);
    const peek = SaveFile.open(path);
    expect(peek.info().nextTick).toBe(24); // last autosave at two years
    peek.close();
    session.close();
  });

  it('resumes exactly after close and reopen', () => {
    const path = join(dir, 'resume.nwsave');
    const a = WorldSession.create({ path, ruleset, now, seed: 'q3Zk1d0XbAc', startYear: 2026 });
    a.advance(7);
    a.submit('economy/set-tax-rate', { rate: 0.33 });
    a.close();
    const b = WorldSession.open(path, { ruleset, now });
    b.advance(29);

    const reference = new Engine(baseOptions);
    reference.advance(7);
    reference.submit('economy/set-tax-rate', { rate: 0.33 });
    reference.advance(29);
    expect(fingerprint(b.engine)).toBe(fingerprint(reference));
    b.close();
  });

  it('branches from an earlier tick by replaying the command log', () => {
    const path = join(dir, 'main.nwsave');
    const session = WorldSession.create({
      path,
      ruleset,
      now,
      seed: 'q3Zk1d0XbAc',
      startYear: 2026,
    });
    session.advance(5);
    session.submit('economy/set-tax-rate', { rate: 0.4 }); // applied at tick 5
    session.advance(10);
    session.submit('economy/set-tax-rate', { rate: 0.1 }); // applied at tick 15
    session.advance(10);

    session.branch(join(dir, 'branch.nwsave'), 12);
    const branch = WorldSession.open(join(dir, 'branch.nwsave'), { ruleset, now });
    expect(branch.engine.nextTick).toBe(12);
    expect(branch.engine.commandLog.map((c) => c.tick)).toEqual([5]);
    expect(fingerprint(branch.engine)).toBe(
      fingerprint(replay(baseOptions, session.engine.commandLog.slice(0, 1), 12)),
    );
    branch.close();
    expect(() => session.branch(join(dir, 'late.nwsave'), 99)).toThrow(RangeError);
    session.close();
  });

  it('will not open a save made under a different ruleset', () => {
    const path = join(dir, 'rules.nwsave');
    WorldSession.create({ path, ruleset, now, seed: 'q3Zk1d0XbAc' }).close();
    expect(() => WorldSession.open(path, { ruleset: { ...ruleset, systems: [] }, now })).toThrow();
  });
});
