// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GENERATOR_VERSION, storeWorld } from '@nationwright/engine';
import { SaveFile, WorldSession } from '../src/index.ts';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'nationwright-generated-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const now = () => new Date('2026-09-25T12:00:00Z');
// A small world keeps the test fast; the full-size generator is tested in the engine.
const settings = { countryCount: 40, cellsPerCountry: 60 };

describe('worlds with a generated map', () => {
  it('creates, stores, and reloads the generated world exactly', () => {
    const path = join(dir, 'world.nwsave');
    const session = WorldSession.create({
      path,
      seed: 'q3Zk1d0XbAc',
      startYear: 2026,
      now,
      settings,
    });
    const generated = session.engine.generated!;
    expect(generated.countries).toHaveLength(40);
    const slice = session.engine.world.slices.world!;
    expect(slice.countries.map((c) => c.name)).toEqual(generated.countries.map((c) => c.name));
    expect(slice.playerCountry).toBeNull();
    session.advance(24);
    session.close();

    const file = SaveFile.open(path);
    expect(file.info().generatorVersion).toBe(GENERATOR_VERSION);
    file.close();

    const reopened = WorldSession.open(path, { now });
    const loaded = reopened.engine.generated!;
    expect(storeWorld(loaded)).toEqual(storeWorld(generated));
    expect(reopened.engine.indicators.series('world.population', 'nation').ticks).toEqual([11, 23]);
    reopened.close();
  });

  it('builds the same world from the same seed and settings', () => {
    const a = WorldSession.create({
      path: join(dir, 'a.nwsave'),
      seed: 'AAAAAAAAAAE',
      startYear: 2026,
      now,
      settings,
    });
    const b = WorldSession.create({
      path: join(dir, 'b.nwsave'),
      seed: 'AAAAAAAAAAE',
      startYear: 2026,
      now,
      settings,
    });
    expect(storeWorld(a.engine.generated!).json).toBe(storeWorld(b.engine.generated!).json);
    a.close();
    b.close();
  });

  it('carries the map into branches', () => {
    const path = join(dir, 'main.nwsave');
    const session = WorldSession.create({
      path,
      seed: 'q3Zk1d0XbAc',
      startYear: 2026,
      now,
      settings,
    });
    session.advance(12);
    session.branch(join(dir, 'branch.nwsave'), 6);
    const branch = WorldSession.open(join(dir, 'branch.nwsave'), { now });
    expect(branch.engine.generated?.countries).toHaveLength(40);
    expect(branch.engine.nextTick).toBe(6);
    branch.close();
    session.close();
  });
});
