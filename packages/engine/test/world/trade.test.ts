// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  exportsOf,
  fitTrade,
  generateWorld,
  importsOf,
  tradeFlows,
  tradeGeography,
  type GuidingVariables,
  type TradeInputs,
} from '../../src/index.ts';

const guiding = JSON.parse(
  readFileSync(
    new URL('../../../reference-data/data/guiding-variables-2026.json', import.meta.url),
    'utf8',
  ),
) as GuidingVariables;

describe('transport distances', () => {
  const world = generateWorld(
    0x1234_5678_9abc_def0n,
    { ...defaultSettings(), countryCount: 40, cellsPerCountry: 60 },
    guiding,
  );
  const geo = tradeGeography(world);

  it('are symmetric, finite, and zero only on the diagonal', () => {
    const n = world.countries.length;
    for (let i = 0; i < n; i++) {
      expect(geo.distances[i]![i]).toBe(0);
      for (let j = 0; j < n; j++) {
        expect(Number.isFinite(geo.distances[i]![j]!)).toBe(true);
        if (i !== j) expect(geo.distances[i]![j]!).toBeGreaterThan(0);
        expect(Math.abs(geo.distances[i]![j]! - geo.distances[j]![i]!)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('put neighbours closer than the typical pair, and every port on a coast', () => {
    const all = geo.distances
      .flatMap((row, i) => row.filter((_, j) => j > i))
      .sort((a, b) => a - b);
    const neighbours = world.countries
      .flatMap((c) => c.neighbors.map((j) => geo.distances[c.id]![j]!))
      .sort((a, b) => a - b);
    expect(neighbours[Math.floor(neighbours.length / 2)]!).toBeLessThan(
      all[Math.floor(all.length / 2)]!,
    );
    for (const p of geo.ports) expect(world.map.terrain.coastal[p]).toBe(1);
  });
});

describe('gravity trade', () => {
  const inputs: TradeInputs = {
    gdp: [100, 200, 50, 400],
    priceLevel: [0.5, 1, 0.4, 0.9],
    distances: [
      [0, 1000, 3000, 5000],
      [1000, 0, 2000, 4000],
      [3000, 2000, 0, 1500],
      [5000, 4000, 1500, 0],
    ],
  };
  const exports = [30, 40, 20, 80];
  const imports = [35, 45, 15, 75];

  it('fits every country’s exports and imports at the start', () => {
    const model = fitTrade(inputs, exports, imports);
    const flows = tradeFlows(model, inputs);
    exports.forEach((x, i) => expect(exportsOf(flows, i)).toBeCloseTo(x, 6));
    imports.forEach((m, j) => expect(importsOf(flows, j)).toBeCloseTo(m, 6));
  });

  it('keeps openness when every economy grows alike', () => {
    const model = fitTrade(inputs, exports, imports);
    const doubled = { ...inputs, gdp: inputs.gdp.map((g) => 2 * g) };
    const flows = tradeFlows(model, doubled);
    exports.forEach((x, i) =>
      expect(exportsOf(flows, i) / doubled.gdp[i]!).toBeCloseTo(x / inputs.gdp[i]!, 9),
    );
  });

  it('trades less with far partners and loses exports to a real appreciation', () => {
    const model = fitTrade(inputs, exports, imports);
    const flows = tradeFlows(model, inputs);
    const pricier = tradeFlows(model, { ...inputs, priceLevel: [1, 1, 0.4, 0.9] });
    expect(exportsOf(pricier, 0)).toBeLessThan(exportsOf(flows, 0));
    const far = tradeFlows(model, {
      ...inputs,
      distances: inputs.distances.map((row, i) =>
        row.map((d, j) => (i === 0 || j === 0 ? 2 * d : d)),
      ),
    });
    expect(exportsOf(far, 0)).toBeLessThan(exportsOf(flows, 0));
  });
});
