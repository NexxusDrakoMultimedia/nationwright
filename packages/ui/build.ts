// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Builds the desktop app into packages/ui/out/:
 *   main/main.cjs        Electron main process      (esbuild)
 *   preload/preload.cjs  sandboxed preload script   (esbuild)
 *   worker/worker.cjs    engine utility process     (esbuild; bundles engine + app)
 *   renderer/            React interface            (Vite)
 *
 *   node packages/ui/build.ts [--skip-renderer]
 */

import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build as esbuild, type BuildOptions } from 'esbuild';
import { build as viteBuild } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = `${here}out`;
const skipRenderer = process.argv.includes('--skip-renderer');

const common: BuildOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
  // Native and Electron-provided modules are loaded at runtime, never bundled.
  external: ['electron', 'better-sqlite3'],
  outExtension: { '.js': '.cjs' },
};

rmSync(`${out}/main`, { recursive: true, force: true });
rmSync(`${out}/preload`, { recursive: true, force: true });
rmSync(`${out}/worker`, { recursive: true, force: true });

await Promise.all([
  esbuild({ ...common, entryPoints: [`${here}src/main/main.ts`], outdir: `${out}/main` }),
  esbuild({ ...common, entryPoints: [`${here}src/preload/preload.ts`], outdir: `${out}/preload` }),
  esbuild({ ...common, entryPoints: [`${here}src/worker/worker.ts`], outdir: `${out}/worker` }),
]);

if (!skipRenderer) {
  await viteBuild({ configFile: `${here}vite.config.ts`, logLevel: 'warn' });
}

console.log(
  `Built ${skipRenderer ? 'main, preload, worker' : 'main, preload, worker, renderer'} into ${out}`,
);
