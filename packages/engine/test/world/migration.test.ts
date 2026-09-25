// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { describe, expect, it } from 'vitest';
import {
  initMigration,
  migrationFlows,
  remittances,
  stepDiaspora,
  type MigrationPartner,
} from '../../src/index.ts';

const partners: MigrationPartner[] = [
  { population: 0, income: 20_000, distance: 0, languageAffinity: 0 }, // the player
  { population: 50e6, income: 45_000, distance: 800, languageAffinity: 0.6 },
  { population: 120e6, income: 5_000, distance: 3_000, languageAffinity: 0 },
  { population: 8e6, income: 30_000, distance: 9_000, languageAffinity: 0.1 },
];
const player = { population: 10e6, income: 20_000, gdpNominal: 2e11 };
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe('migration channels', () => {
  for (const netMigrationRate of [-6, -1, 0, 3, 10]) {
    it(`start at the nation's net migration rate (${netMigrationRate} per 1,000)`, () => {
      const channels = initMigration(partners, {
        ...player,
        netMigrationRate,
        remittancesShare: 2,
      });
      const flows = migrationFlows(channels, partners, player);
      expect((1000 * (sum(flows.inflow) - sum(flows.outflow))) / player.population).toBeCloseTo(
        netMigrationRate,
        9,
      );
      expect(flows.inflow[0]).toBe(0);
      expect(flows.outflow[0]).toBe(0);
      expect(flows.inflow.every((f) => f >= 0) && flows.outflow.every((f) => f >= 0)).toBe(true);
      expect(remittances(channels, partners) / player.gdpNominal).toBeCloseTo(0.02, 9);
    });
  }

  it('lean toward close, richer, same-language partners', () => {
    const channels = initMigration(partners, {
      ...player,
      netMigrationRate: 0,
      remittancesShare: 1,
    });
    const flows = migrationFlows(channels, partners, player);
    // Emigrants prefer the rich neighbour sharing a language over the distant one.
    expect(flows.outflow[1]!).toBeGreaterThan(flows.outflow[3]!);
    // Immigrants come mostly from the large, poorer country.
    expect(flows.inflow[2]!).toBeGreaterThan(flows.inflow[3]!);
  });

  it('respond to incomes, openness, and build diasporas', () => {
    const channels = initMigration(partners, {
      ...player,
      netMigrationRate: 0,
      remittancesShare: 1,
    });
    const base = migrationFlows(channels, partners, player);
    const richer = migrationFlows(channels, partners, { ...player, income: 40_000 });
    expect(sum(richer.inflow)).toBeGreaterThan(sum(base.inflow));
    expect(sum(richer.outflow)).toBeLessThan(sum(base.outflow));
    expect(sum(migrationFlows(channels, partners, player, 0.5).inflow)).toBeCloseTo(
      sum(base.inflow) / 2,
      6,
    );
    const before = sum(channels.immigrants);
    stepDiaspora(channels, base);
    expect(sum(channels.immigrants)).toBeCloseTo(before * 0.98 + sum(base.inflow), 3);
  });
});
