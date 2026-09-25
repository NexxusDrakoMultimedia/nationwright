// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Launches the built app in smoke-test mode and checks the result end to end:
 * renderer → preload → MessagePort → utility process → engine → SQLite and back.
 *
 *   npm run ui:build && npm run ui:smoke
 *   npm run ui:smoke -- --app packages/ui/dist/linux-unpacked/nationwright   (packaged build)
 *
 * On Linux without a display it runs under xvfb-run. When running as root (containers,
 * some CI), Chromium refuses to start sandboxed, so --no-sandbox is added for this test
 * only; normal launches always keep the sandbox.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const electronPath = createRequire(import.meta.url)('electron') as unknown as string;
const dir = mkdtempSync(join(tmpdir(), 'nationwright-smoke-'));

// --ui <world.nwsave> --out <dir>: open that world and screenshot the map screen instead.
const uiIndex = process.argv.indexOf('--ui');
const uiWorld = uiIndex >= 0 ? process.argv[uiIndex + 1] : undefined;
const outIndex = process.argv.indexOf('--out');
const outDir = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;

// --app <executable> tests a packaged build instead of the development one.
const appIndex = process.argv.indexOf('--app');
const packaged = appIndex >= 0 ? process.argv[appIndex + 1] : undefined;
const executable = packaged ?? electronPath;
const electronArgs = packaged === undefined ? [here] : [];
if (uiWorld !== undefined) electronArgs.push(uiWorld);
if (process.getuid?.() === 0) electronArgs.push('--no-sandbox');
const needsXvfb = process.platform === 'linux' && process.env['DISPLAY'] === undefined;
const [command, args] = needsXvfb
  ? ['xvfb-run', ['-a', executable, ...electronArgs]]
  : [executable, electronArgs];

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
console.log(`[${elapsed()}] launching Electron${needsXvfb ? ' under Xvfb' : ''}…`);

const child = spawn(command, args, {
  env: {
    ...process.env,
    NATIONWRIGHT_SMOKE_DIR: uiWorld === undefined ? dir : (outDir ?? dir),
    ...(uiWorld === undefined ? {} : { NATIONWRIGHT_SMOKE_MODE: 'ui' }),
    ELECTRON_ENABLE_LOGGING: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';
let stderr = '';
let line: string | undefined;
let buffered = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk: string) => {
  stdout += chunk;
  buffered += chunk;
  let newline = buffered.indexOf('\n');
  while (newline >= 0) {
    const text = buffered.slice(0, newline);
    buffered = buffered.slice(newline + 1);
    if (text.startsWith('PROGRESS '))
      console.log(`[${elapsed()}] ${text.slice('PROGRESS '.length)}`);
    if (text.startsWith('SMOKE ')) line = text;
    newline = buffered.indexOf('\n');
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk: string) => (stderr += chunk));
const killer = setTimeout(() => {
  console.error(`[${elapsed()}] no result after 120 s; stopping Electron`);
  child.kill('SIGKILL');
}, 120_000);
await new Promise<void>((resolve) => child.on('close', () => resolve()));
clearTimeout(killer);
rmSync(dir, { recursive: true, force: true });
console.log(`[${elapsed()}] Electron exited`);

if (line === undefined) {
  console.error('No smoke result. stdout:\n', stdout, '\nstderr:\n', stderr);
  process.exit(1);
}

if (uiWorld !== undefined) {
  const ui = JSON.parse(line.slice('SMOKE '.length)) as {
    ok: boolean;
    error?: string;
    result?: unknown;
  };
  if (!ui.ok) {
    console.error('UI smoke test FAILED:', ui.error);
    process.exit(1);
  }
  console.log(`UI smoke test passed: ${JSON.stringify(ui.result)}`);
  process.exit(0);
}

const report = JSON.parse(line.slice('SMOKE '.length)) as {
  ok: boolean;
  error?: string;
  result?: {
    seed: string;
    check: { ok: boolean; canonical?: string };
    bad: { ok: boolean };
    created: { month: number; seed: string; date: string };
    advanced: { month: number; date: string };
    reopened: { month: number; seed: string };
    error: string | null;
    progress: string[];
    nodeInRenderer: boolean;
    title: string;
    heading: string | null;
  };
};

const failures: string[] = [];
const expect = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};

if (!report.ok || report.result === undefined) {
  failures.push(`app reported failure: ${report.error ?? 'unknown'}`);
} else {
  const r = report.result;
  expect(/^[A-Za-z0-9_-]{10}[AEIMQUYcgkosw048]$/.test(r.seed), `bad seed ${r.seed}`);
  expect(r.check.ok && r.check.canonical === r.seed, 'seed.check rejected a generated seed');
  expect(!r.bad.ok, 'seed.check accepted a non-canonical seed');
  expect(r.created.month === 0 && r.created.seed === r.seed, 'world.create summary is wrong');
  expect(r.advanced.month === 24, `expected month 24 after advancing, got ${r.advanced.month}`);
  expect(r.reopened.month === 24 && r.reopened.seed === r.seed, 'reopened world differs');
  expect(r.error !== null && r.error.includes('months'), 'invalid advance was not rejected');
  expect(r.progress.includes('progress') && r.progress.includes('saved'), 'no progress events');
  expect(!r.nodeInRenderer, 'Node APIs are reachable from the renderer');
  expect(r.title === 'Nationwright' && r.heading === 'Nationwright', 'renderer did not render');
}

if (failures.length > 0) {
  console.error('Electron smoke test FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`Electron smoke test passed (${JSON.stringify(report.result?.advanced)}).`);
