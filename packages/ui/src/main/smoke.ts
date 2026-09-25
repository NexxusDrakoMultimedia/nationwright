// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * End-to-end smoke test (npm run ui:smoke). Drives the real renderer API through the
 * real preload, MessagePort, and utility process, then prints a JSON result and quits.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, type BrowserWindow } from 'electron';

/** One line per step, streamed live by the smoke runner (packages/ui/smoke.ts). */
function progress(message: string): void {
  process.stdout.write(`PROGRESS ${message}\n`);
}

export function runSmokeTest(window: BrowserWindow, dir: string): void {
  const fail = (reason: unknown) => {
    process.stdout.write(`SMOKE ${JSON.stringify({ ok: false, error: String(reason) })}\n`);
    app.exit(1);
  };
  const timeout = setTimeout(() => fail('timed out after 60 s'), 60_000);

  const js = <T>(code: string) => window.webContents.executeJavaScript(code) as Promise<T>;
  const call = <T>(method: string, params: unknown) =>
    js<T>(`window.nationwright.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`);

  window.webContents.once('did-finish-load', () => {
    void (async () => {
      progress('renderer loaded');
      const path = join(dir, 'smoke.nwsave');
      await js(
        `(window.__progress = [], window.nationwright.onEvent((e) => window.__progress.push(e.type)), true)`,
      );
      let seedRequest: string | null = null;
      try {
        await call('seed.generate', null);
      } catch (e) {
        seedRequest = e instanceof Error ? e.message : String(e);
      }
      const created = await call<unknown>('world.create', { path });
      progress('world generated and saved');
      const advanced = await call<unknown>('world.advance', { months: 24 });
      progress('advanced 24 months');
      let error: string | null = null;
      try {
        await call('world.advance', { months: 0 });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      await call('world.close', null);
      const reopened = await call<unknown>('world.open', { path });
      progress('world closed and reopened');
      const result = {
        seedRequest,
        created,
        advanced,
        reopened,
        error,
        progress: await js<string[]>('window.__progress'),
        nodeInRenderer: await js<boolean>(
          `typeof require !== 'undefined' || typeof process !== 'undefined'`,
        ),
        title: await js<string>('document.title'),
        heading: await js<string | null>(`document.querySelector('h1')?.textContent ?? null`),
      };
      clearTimeout(timeout);
      const screenshot = process.env['NATIONWRIGHT_SMOKE_SCREENSHOT'];
      if (screenshot !== undefined) {
        const image = await window.webContents.capturePage();
        writeFileSync(screenshot, image.toPNG());
      }
      process.stdout.write(`SMOKE ${JSON.stringify({ ok: true, result })}\n`);
      app.quit();
    })().catch(fail);
  });
}

export function runUiSmokeTest(window: BrowserWindow, dir: string): void {
  const fail = (reason: unknown) => {
    process.stdout.write(`SMOKE ${JSON.stringify({ ok: false, error: String(reason) })}\n`);
    app.exit(1);
  };
  const timeout = setTimeout(() => fail('timed out after 90 s'), 90_000);
  const js = <T>(code: string) => window.webContents.executeJavaScript(code) as Promise<T>;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const shot = async (name: string) => {
    const image = await window.webContents.capturePage();
    writeFileSync(join(dir, `${name}.png`), image.toPNG());
    return name;
  };
  const clickButton = (text: string) =>
    js<boolean>(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
      if (!b) return false;
      b.click();
      return true;
    })()`);

  window.webContents.once('did-finish-load', () => {
    void (async () => {
      progress('renderer loaded; waiting for the map');
      for (let i = 0; i < 120; i++) {
        if (await js<boolean>(`!!document.querySelector('.map-legend')`)) break;
        await wait(500);
      }
      if (!(await js<boolean>(`!!document.querySelector('.map-canvas')`)))
        throw new Error('map never appeared');
      progress('map drawn');
      await wait(800);
      const shots: string[] = [await shot('map-political')];
      progress('screenshot: political layer');
      for (const [button, name] of [
        ['Physical', 'map-physical'],
        ['Statistics', 'map-statistics'],
      ] as const) {
        if (!(await clickButton(button))) throw new Error(`no ${button} button`);
        await wait(800);
        shots.push(await shot(name));
        progress(`screenshot: ${button.toLowerCase()} layer`);
      }
      await clickButton('Table');
      await wait(300);
      await js(`document.querySelector('.country-table tbody button')?.click()`);
      await wait(800);
      shots.push(await shot('map-profile'));
      progress('screenshot: country profile');
      const countries = await js<number>(
        `document.querySelectorAll('.country-table tbody tr').length`,
      );
      const profile = await js<string | null>(
        `document.querySelector('.country-panel h3')?.textContent ?? null`,
      );
      if (!(await clickButton('Census'))) throw new Error('no Census tab');
      for (let i = 0; i < 60; i++) {
        if (await js<boolean>(`!!document.querySelector('.stat-grid')`)) break;
        await wait(250);
      }
      await wait(500);
      shots.push(await shot('census'));
      progress('screenshot: census');
      await js(`document.querySelector('.pyramid')?.scrollIntoView()`);
      await wait(300);
      shots.push(await shot('census-pyramid'));
      progress('screenshot: population pyramid');
      const census = await js<{ tiles: number; bands: number; regions: number }>(`({
        tiles: document.querySelectorAll('.stat-tile').length,
        bands: document.querySelectorAll('.pyramid path.female').length,
        regions: document.querySelectorAll('.census table.wide')[0]?.querySelectorAll('tbody tr').length ?? 0,
      })`);
      clearTimeout(timeout);
      process.stdout.write(
        `SMOKE ${JSON.stringify({ ok: true, result: { shots, countries, profile, census } })}\n`,
      );
      app.quit();
    })().catch(fail);
  });
}
