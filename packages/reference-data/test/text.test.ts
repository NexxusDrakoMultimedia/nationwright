// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { describe, expect, it } from 'vitest';
import {
  cleanText,
  fractionalization,
  parseEstYear,
  parseNumber,
  parsePercent,
  parseShareList,
  quantile,
} from '../src/index.ts';

describe('cleanText', () => {
  it('strips tags, decodes entities, and collapses whitespace', () => {
    expect(cleanText("C&ocirc;te d'Ivoire")).toBe("Côte d'Ivoire");
    expect(cleanText('<b>note:</b>  data&nbsp;in <br>2021 dollars')).toBe(
      'note: data in 2021 dollars',
    );
    expect(cleanText('&#233;t&eacute;')).toBe('été');
  });
});

describe('parseEstYear', () => {
  it.each([
    ['9,174,390 (2025 est.)', 2025],
    ['59.5% of total population (2023)', 2023],
    ['0.68% annual rate of change (2020-25 est.)', 2025],
    ['21.2% (2024 est.) (male 839,672/female 1,060,411)', 2024],
    ['(2017 est.) 77.9', 2017],
    ['4,591 km', null],
  ])('%s -> %s', (text, year) => {
    expect(parseEstYear(text)).toBe(year);
  });
});

describe('parseNumber', () => {
  it.each([
    ['9,174,390 (2025 est.)', 9174390],
    ['$521.642 billion (2024 est.)', 521642000000],
    ['$1.2 trillion', 1.2e12],
    ['83,871 sq km', 83871],
    ['1.35 children born/woman (2025 est.)', 1.35],
    ['(2017 est.) 77.9', 77.9],
    ['-3.2 migrant(s)/1,000 population (2025 est.)', -3.2],
    ['6,123 km (2022) 3,523 km electrified', 6123],
    ['no permanent inhabitants', null],
  ])('%s -> %s', (text, value) => {
    expect(parseNumber(text)).toBe(value);
  });
});

describe('parsePercent', () => {
  it.each([
    ['-1.2% (2024 est.)', -1.2],
    ['5% (2022 est.)', 5],
    ['78.3% of GDP (2023 est.)', 78.3],
    ['military expenditures accounted for an estimated 20-30% of GDP', 25],
    ['21.2% (2024 est.) (male 839,672/female 1,060,411)', 21.2],
    ['NA', null],
  ])('%s -> %s', (text, value) => {
    expect(parsePercent(text)).toBe(value);
  });
});

describe('parseShareList', () => {
  it('splits on top-level commas and reads shares', () => {
    expect(
      parseShareList(
        'German (official nationwide) 88.6%, Croatian (official in Burgenland, Austria) 1.6%, other <1% (2001 est.)',
      ),
    ).toEqual([
      { label: 'German', share: 88.6 },
      { label: 'Croatian', share: 1.6 },
      { label: 'other', share: 0.5 },
    ]);
  });

  it('keeps items without shares', () => {
    expect(parseShareList('English (official), Hausa, Yoruba')).toEqual([
      { label: 'English', share: null },
      { label: 'Hausa', share: null },
      { label: 'Yoruba', share: null },
    ]);
  });
});

describe('stats', () => {
  it('computes type-7 quantiles', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10], 0.9)).toBe(10);
    expect(quantile([0, 10], 0.1)).toBe(1);
    expect(() => quantile([], 0.5)).toThrow(RangeError);
  });

  it('computes fractionalization with an "other" remainder', () => {
    expect(fractionalization([{ label: 'a', share: 100 }])).toBe(0);
    expect(
      fractionalization([
        { label: 'a', share: 50 },
        { label: 'b', share: 50 },
      ]),
    ).toBeCloseTo(0.5);
    expect(fractionalization([{ label: 'a', share: 90 }])).toBeCloseTo(1 - 0.81 - 0.01);
    expect(
      fractionalization([
        { label: 'a', share: 40 },
        { label: 'b', share: null },
      ]),
    ).toBeNull();
  });
});
