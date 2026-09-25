// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * End-to-end smoke test (npm run ui:smoke). Drives the real renderer API through the
 * real preload, MessagePort, and utility process, then prints a JSON result and quits.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, type BrowserWindow } from 'electron';

export function runSmokeTest(window: BrowserWindow, dir: string): void {
  const fail = (reason: unknown) => {
    process.stdout.write(`SMOKE ${JSON.stringify({ ok: false, error: String(reason) })}\n`);
    app.exit(1);
  };
  const timeout = setTimeout(() => fail('timed out after 60 s'), 60_000);

  window.webContents.once('did-finish-load', () => {
    const path = join(dir, 'smoke.nwsave');
    const script = `(async () => {
      const api = window.nationwright;
      const progress = [];
      api.onEvent((e) => progress.push(e.type));
      const seed = await api.request('seed.generate', null);
      const check = await api.request('seed.check', { text: seed });
      const bad = await api.request('seed.check', { text: 'AAAAAAAAAAB' });
      const created = await api.request('world.create', { path: ${JSON.stringify(path)}, seed });
      const advanced = await api.request('world.advance', { months: 24 });
      let error = null;
      try { await api.request('world.advance', { months: 0 }); } catch (e) { error = String(e.message ?? e); }
      await api.request('world.close', null);
      const reopened = await api.request('world.open', { path: ${JSON.stringify(path)} });
      return {
        seed, check, bad, created, advanced, reopened, error, progress,
        nodeInRenderer: typeof require !== 'undefined' || typeof process !== 'undefined',
        title: document.title,
        heading: document.querySelector('h1')?.textContent ?? null,
      };
    })()`;
    window.webContents
      .executeJavaScript(script)
      .then(async (result: unknown) => {
        clearTimeout(timeout);
        const screenshot = process.env['NATIONWRIGHT_SMOKE_SCREENSHOT'];
        if (screenshot !== undefined) {
          const image = await window.webContents.capturePage();
          writeFileSync(screenshot, image.toPNG());
        }
        process.stdout.write(`SMOKE ${JSON.stringify({ ok: true, result })}\n`);
        app.quit();
      })
      .catch(fail);
  });
}
