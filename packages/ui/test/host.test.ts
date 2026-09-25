// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RULESET_VERSION } from '@nationwright/engine';
import { EngineHost } from '../src/worker/host.ts';
import {
  isAllowedExternalLink,
  type EngineEvent,
  type EngineMethod,
  type FromEngine,
} from '../src/shared/protocol.ts';
import { setTaxRate, toyDemography, toyEconomy } from '../../engine/test/core/fixtures.ts';

let dir: string;
let events: EngineEvent[];
let host: EngineHost;
let nextId: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nationwright-host-'));
  events = [];
  nextId = 1;
  host = new EngineHost((e) => events.push(e), {
    ruleset: {
      version: RULESET_VERSION,
      systems: [toyDemography, toyEconomy],
      commands: [setTaxRate],
    },
    now: () => new Date('2026-09-25T12:00:00Z'),
  });
});
afterEach(() => {
  host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

function call(method: EngineMethod, params: unknown): FromEngine {
  return host.handle({ kind: 'request', id: nextId++, method, params });
}

function ok(method: EngineMethod, params: unknown): unknown {
  const response = call(method, params);
  if (response.kind !== 'response' || !response.ok) {
    throw new Error(`expected success, got ${JSON.stringify(response)}`);
  }
  return response.result;
}

describe('EngineHost', () => {
  it('never exposes world seeds', () => {
    expect(call('seed.generate' as EngineMethod, null)).toMatchObject({ ok: false });
    const summary = ok('world.create', { path: join(dir, 's.nwsave') }) as object;
    expect(Object.keys(summary)).not.toContain('seed');
  });

  it('creates, advances with progress, closes, and reopens a world', () => {
    const path = join(dir, 'w.nwsave');
    expect(ok('world.summary', null)).toBeNull();
    expect(ok('world.create', { path })).toMatchObject({
      month: 0,
      date: 'January 2026',
      systems: ['toyEconomy', 'toyPopulation'],
    });
    expect(ok('world.advance', { months: 30 })).toMatchObject({ month: 30, date: 'July 2028' });
    expect(events).toEqual([
      { type: 'progress', done: 12, total: 30, date: 'January 2027' },
      { type: 'progress', done: 24, total: 30, date: 'January 2028' },
      { type: 'progress', done: 30, total: 30, date: 'July 2028' },
      { type: 'saved', date: 'July 2028' },
    ]);
    expect(ok('world.close', null)).toBeNull();
    expect(ok('world.open', { path })).toMatchObject({ month: 30, indicatorSeries: 2 });
  });

  it('answers errors as failed responses, never throws', () => {
    expect(call('world.advance', { months: 1 })).toMatchObject({
      ok: false,
      error: 'No world is open.',
    });
    ok('world.create', { path: join(dir, 'y.nwsave') });
    expect(call('world.advance', { months: 0 })).toMatchObject({ ok: false });
    expect(call('world.advance', { months: 1.5 })).toMatchObject({ ok: false });
    expect(call('world.open', { path: join(dir, 'missing.nwsave') })).toMatchObject({ ok: false });
    expect(call('no.such' as EngineMethod, null)).toMatchObject({
      ok: false,
      error: 'Unknown method "no.such".',
    });
  });
});

describe('isAllowedExternalLink', () => {
  it('allows only the listed links and their subpaths', () => {
    expect(isAllowedExternalLink('https://github.com/NexxusDrakoMultimedia/nationwright')).toBe(
      true,
    );
    expect(
      isAllowedExternalLink('https://github.com/NexxusDrakoMultimedia/nationwright/issues'),
    ).toBe(true);
    expect(
      isAllowedExternalLink('https://github.com/NexxusDrakoMultimedia/nationwright-evil'),
    ).toBe(false);
    expect(isAllowedExternalLink('https://example.com')).toBe(false);
    expect(isAllowedExternalLink('file:///etc/passwd')).toBe(false);
  });
});
