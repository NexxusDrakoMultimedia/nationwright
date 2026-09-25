// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { describe, expect, it } from 'vitest';
import { cadencesOfTick, dateOfTick, formatDate, tickOfDate } from '../../src/index.ts';

describe('calendar', () => {
  it('maps ticks to months starting in January of the start year', () => {
    expect(dateOfTick(2026, 0)).toEqual({ year: 2026, month: 1 });
    expect(dateOfTick(2026, 11)).toEqual({ year: 2026, month: 12 });
    expect(dateOfTick(2026, 12)).toEqual({ year: 2027, month: 1 });
    expect(formatDate(dateOfTick(2026, 25))).toBe('February 2028');
  });

  it('round-trips dates and ticks', () => {
    for (let tick = 0; tick < 500; tick++) {
      expect(tickOfDate(2026, dateOfTick(2026, tick))).toBe(tick);
    }
  });

  it('fires quarterly and annual cadences at the end of each period', () => {
    const quarterly = [...Array(24).keys()].filter((t) => cadencesOfTick(t).quarterly);
    const annual = [...Array(24).keys()].filter((t) => cadencesOfTick(t).annual);
    expect(quarterly).toEqual([2, 5, 8, 11, 14, 17, 20, 23]);
    expect(annual).toEqual([11, 23]);
  });

  it('rejects invalid ticks', () => {
    expect(() => dateOfTick(2026, -1)).toThrow(RangeError);
    expect(() => cadencesOfTick(1.5)).toThrow(RangeError);
    expect(() => tickOfDate(2026, { year: 2025, month: 12 })).toThrow(RangeError);
  });
});
