// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { describe, expect, it } from 'vitest';
import {
  buildPopulation,
  cohortsOf,
  createStream,
  migrateInternally,
  summarize,
  type NationPopulation,
  type NationStats,
} from '../../src/index.ts';

const stats: NationStats = {
  'population.total': 10_000_000,
  'population.urban_share': 50,
  'population.life_expectancy': 76,
  'population.infant_mortality': 10,
  'population.tfr': 2,
  'population.age_0_14_share': 20,
  'population.age_65_plus_share': 10,
  'education.literacy': 95,
  'education.school_life_expectancy': 14,
};

function build(populations: number[]): NationPopulation {
  return buildPopulation(
    stats,
    populations.map((p) => ({ population: p, urbanPopulation: p / 2 })),
    {
      joint: [
        { ethnic: 0, religion: 0, language: 0, share: 0.8 },
        { ethnic: 1, religion: 1, language: 1, share: 0.2 },
      ],
      stream: createStream(3n, 'test/internal'),
    },
  );
}

const regionTotals = (pop: NationPopulation) =>
  pop.regions.map((g) => summarize([g.cohorts]).total);

describe('internal migration', () => {
  const distances = [
    [0, 500, 900],
    [500, 0, 600],
    [900, 600, 0],
  ];

  it('moves people without creating or losing anyone', () => {
    const pop = build([6e6, 3e6, 1e6]);
    const before = summarize(cohortsOf(pop.regions)).total;
    for (let m = 0; m < 24; m++) {
      const flows = migrateInternally(pop.regions, {
        rate: 0.03,
        attractiveness: [2, 1, 0.5],
        distances,
      });
      expect(flows.net.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 3);
      expect(flows.movers).toBeGreaterThan(0);
    }
    expect(summarize(cohortsOf(pop.regions)).total / before).toBeCloseTo(1, 10);
    for (const g of pop.regions) {
      g.cohorts.forEach((n, i) => {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(g.culture.reduce((s, l) => s + l[i]!, 0)).toBeCloseTo(n, 6);
      });
    }
  });

  it('has no net flows when every region is equally attractive, whatever their sizes', () => {
    const pop = build([8e6, 1.5e6, 0.5e6]);
    const flows = migrateInternally(pop.regions, {
      rate: 0.03,
      attractiveness: [1, 1, 1],
      distances,
    });
    for (const n of flows.net) expect(Math.abs(n)).toBeLessThan(1e-6 * 1e7);
  });

  it('draws people to more attractive regions, at a bounded rate', () => {
    const pop = build([5e6, 5e6]);
    const start = regionTotals(pop);
    for (let m = 0; m < 12; m++) {
      migrateInternally(pop.regions, {
        rate: 0.03,
        attractiveness: [3, 1],
        distances: [
          [0, 800],
          [800, 0],
        ],
      });
    }
    const end = regionTotals(pop);
    expect(end[0]!).toBeGreaterThan(start[0]!);
    expect(end[1]!).toBeLessThan(start[1]!);
    expect(start[1]! - end[1]!).toBeLessThan(0.03 * start[1]!);
  });

  it('does nothing with a single region', () => {
    const pop = build([1e6]);
    const flows = migrateInternally(pop.regions, {
      rate: 0.03,
      attractiveness: [1],
      distances: [[0]],
    });
    expect(flows).toEqual({ net: [0], movers: 0 });
  });
});
