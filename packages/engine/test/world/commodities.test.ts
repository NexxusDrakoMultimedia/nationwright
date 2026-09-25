// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  capEndowment,
  COMMODITIES,
  COMMODITY_TUNING,
  createMarket,
  createStream,
  defaultSettings,
  DEPOSIT_COVERAGE,
  endowments,
  generateWorld,
  prices,
  rentIndex,
  rents,
  stepMarket,
  type GuidingVariables,
} from '../../src/index.ts';

const guiding = JSON.parse(
  readFileSync(
    new URL('../../../reference-data/data/guiding-variables-2026.json', import.meta.url),
    'utf8',
  ),
) as GuidingVariables;
const world = generateWorld(
  0x0fed_cba9_8765_4320n,
  { ...defaultSettings(), countryCount: 60 },
  guiding,
);

describe('resource deposits', () => {
  it('sit on land, with each commodity near its target share of land cells', () => {
    const { kind, richness } = world.map.resources;
    const land = world.map.terrain.land.reduce((a, b) => a + b, 0);
    COMMODITIES.forEach((_, c) => {
      const cells = kind.filter((k) => k === c + 1).length;
      expect(cells / land).toBeGreaterThan(0.5 * DEPOSIT_COVERAGE[c]!);
      expect(cells / land).toBeLessThanOrEqual(DEPOSIT_COVERAGE[c]! + 1e-9);
    });
    kind.forEach((k, i) => {
      if (k === 0) expect(richness[i]).toBe(0);
      else {
        expect(world.map.terrain.land[i]).toBe(1);
        expect(richness[i]!).toBeGreaterThanOrEqual(0.2);
        expect(richness[i]!).toBeLessThanOrEqual(1.2 + 1e-6);
      }
    });
  });

  it('are summed per country', () => {
    const e = endowments(world.map.resources, world.map.owner, world.countries.length);
    const total = e.flat().reduce((a, b) => a + b, 0);
    let owned = 0;
    world.map.resources.richness.forEach((r, i) => {
      if ((world.map.owner[i] as number) >= 0) owned += r;
    });
    expect(total).toBeCloseTo(owned, 3);
  });
});

describe('commodity market', () => {
  const e = endowments(world.map.resources, world.map.owner, world.countries.length);
  const gdp = world.countries.map((c) => c.nation.stats['economy.gdp_nominal']!);
  const worldGdp = gdp.reduce((a, b) => a + b, 0);

  it('sets unit values so world rents are the target share of world GDP', () => {
    const market = createMarket(e, worldGdp);
    const total = e.reduce((s, row) => s + rents(market, row), 0);
    expect(total / worldGdp).toBeCloseTo(COMMODITY_TUNING.worldRentShare, 9);
    for (const row of e) expect(rentIndex(market, row)).toBeCloseTo(1, 9);
  });

  it('keeps rent shares plausible for small economies with large deposits', () => {
    const market = createMarket(e, worldGdp);
    e.forEach((row, k) => {
      const share = rents(market, capEndowment(market, row, gdp[k]!)) / gdp[k]!;
      expect(share).toBeLessThan(COMMODITY_TUNING.rentSaturation);
    });
  });

  it('moves prices, depletes deposits, and follows world inflation', () => {
    const market = createMarket(e, worldGdp);
    const stream = createStream(1n, 'test/commodities');
    for (let y = 0; y < 50; y++) stepMarket(market, stream, 2.5);
    for (const p of prices(market)) {
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeGreaterThan(0);
    }
    expect(market.remaining).toBeCloseTo((1 - COMMODITY_TUNING.depletion) ** 50, 12);
    expect(market.worldPrices).toBeCloseTo(1.025 ** 50, 9);
  });
});
