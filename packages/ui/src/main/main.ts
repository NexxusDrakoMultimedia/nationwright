// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Electron main process: window lifecycle, native dialogs, and brokering the MessagePort
 * between the renderer and the engine's utility process (DESIGN.md §9, D9).
 */

import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  session,
  shell,
  utilityProcess,
  type UtilityProcess,
} from 'electron';
import { CHANNELS, isAllowedExternalLink } from '../shared/protocol.ts';
import { runSmokeTest } from './smoke.ts';

// Headless smoke tests run without a GPU (e.g. under Xvfb).
if (process.env['NATIONWRIGHT_SMOKE_DIR'] !== undefined) app.disableHardwareAcceleration();

const SAVE_FILTERS = [{ name: 'Nationwright world', extensions: ['nwsave'] }];

let engine: UtilityProcess | null = null;
let quitting = false;

function startEngine(): UtilityProcess {
  const child = utilityProcess.fork(join(__dirname, '..', 'worker', 'worker.cjs'), [], {
    serviceName: 'Nationwright engine',
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    if (engine === child) engine = null;
    if (code !== 0 && !quitting) console.error(`Engine process exited with code ${code}.`);
  });
  return child;
}

/** Gives the renderer a fresh port connected to the engine. */
function connect(window: BrowserWindow): void {
  engine ??= startEngine();
  const { port1, port2 } = new MessageChannelMain();
  engine.postMessage(null, [port1]);
  window.webContents.postMessage(CHANNELS.enginePort, null, [port2]);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Nationwright',
    show: false,
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.on('did-finish-load', () => connect(window));
  const devServer = process.env['NATIONWRIGHT_RENDERER_URL'];
  if (devServer !== undefined && !app.isPackaged) {
    void window.loadURL(devServer);
  } else {
    void window.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  }
  return window;
}

function registerIpc(): void {
  ipcMain.handle(CHANNELS.chooseNewWorldPath, async (event, suggestedName: unknown) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Create world',
      defaultPath: typeof suggestedName === 'string' ? `${suggestedName}.nwsave` : 'world.nwsave',
      filters: SAVE_FILTERS,
      properties: ['createDirectory' as const, 'showOverwriteConfirmation' as const],
    };
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);
    return result.canceled || result.filePath === undefined ? null : result.filePath;
  });

  ipcMain.handle(CHANNELS.chooseWorldToOpen, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Open world',
      filters: SAVE_FILTERS,
      properties: ['openFile' as const],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(CHANNELS.openExternal, async (_event, url: unknown) => {
    if (typeof url !== 'string' || !isAllowedExternalLink(url)) {
      throw new Error('That link is not allowed.');
    }
    await shell.openExternal(url);
  });
}

/** Locks down every web contents: no navigation, no new windows, no permissions. */
function harden(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

/** Asks the engine to save and close before the app exits. */
async function stopEngine(): Promise<void> {
  const child = engine;
  if (child === null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5000);
    child.on('message', (message) => {
      if (message === 'shutdown-complete') {
        clearTimeout(timer);
        resolve();
      }
    });
    child.postMessage('shutdown');
  });
  child.kill();
  engine = null;
}

app.on('before-quit', (event) => {
  if (quitting || engine === null) return;
  event.preventDefault();
  quitting = true;
  void stopEngine().then(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

void app.whenReady().then(() => {
  harden();
  registerIpc();
  const window = createWindow();
  const smokeDir = process.env['NATIONWRIGHT_SMOKE_DIR'];
  if (smokeDir !== undefined) runSmokeTest(window, smokeDir);
});
