// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: `${here}src/renderer`,
  base: './', // loaded from file:// in production
  plugins: [react()],
  build: {
    outDir: `${here}out/renderer`,
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: true,
  },
  server: { port: 5873, strictPort: true },
});
