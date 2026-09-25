// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { describe, expect, it } from 'vitest';
import { isAllowed } from './check-licenses.ts';

describe('isAllowed', () => {
  it.each([
    ['MIT', true],
    ['(MIT OR Apache-2.0)', true],
    ['MIT AND BSD-3-Clause', true],
    ['GPL-2.0-only', false],
    ['GPL-2.0-only OR MIT', true],
    ['MIT AND GPL-2.0-only', false],
    ['Apache-2.0 WITH LLVM-exception', true],
    ['SSPL-1.0', false],
    ['UNLICENSED', false],
  ])('%s -> %s', (expression, expected) => {
    expect(isAllowed(expression)).toBe(expected);
  });
});
