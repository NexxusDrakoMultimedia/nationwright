// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Determinism rules for the engine (DESIGN.md §3.3, §9): all randomness must come from
 * the world seed, and the engine must never read the clock.
 */
const engineDeterminismRules = {
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'Use a seeded stream (random/stream.ts).' },
    ...[
      'log',
      'log2',
      'log10',
      'log1p',
      'exp',
      'expm1',
      'pow',
      'sin',
      'cos',
      'tan',
      'atan2',
      'hypot',
      'cbrt',
    ].map((property) => ({
      object: 'Math',
      property,
      message: 'Engine-dependent precision; use detLog/detExp from random/detmath.ts.',
    })),
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']",
      message: 'The ** operator is implementation-approximated; multiply, or use detExp/detLog.',
    },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'Date', message: 'The engine must not read the clock; pass time in as data.' },
    { name: 'performance', message: 'The engine must not read the clock.' },
    { name: 'crypto', message: 'Seed generation belongs to the application layer.' },
  ],
};

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/coverage/**', '**/.cache/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['packages/*/test/**/*.ts', 'scripts/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: engineDeterminismRules,
  },
);
