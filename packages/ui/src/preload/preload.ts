// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Preload script (sandboxed). Holds the engine MessagePort and exposes a narrow, typed
 * API on `window.nationwright`; the renderer never touches Node or IPC directly.
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  CHANNELS,
  type EngineEvent,
  type FromEngine,
  type NationwrightApi,
  type ToEngine,
} from '../shared/protocol.ts';

let port: MessagePort | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
const listeners = new Set<(event: EngineEvent) => void>();
const queued: ToEngine[] = [];

ipcRenderer.on(CHANNELS.enginePort, (event) => {
  const next = event.ports[0];
  if (next === undefined) return;
  port?.close();
  port = next;
  port.onmessage = (message: MessageEvent<FromEngine>) => {
    const data = message.data;
    if (data.kind === 'event') {
      for (const listener of listeners) listener(data.event);
      return;
    }
    const waiter = pending.get(data.id);
    if (waiter === undefined) return;
    pending.delete(data.id);
    if (data.ok) waiter.resolve(data.result);
    else waiter.reject(new Error(data.error));
  };
  for (const message of queued.splice(0)) port.postMessage(message);
});

const api: NationwrightApi = {
  request(method, params) {
    return new Promise((resolve, reject) => {
      const message: ToEngine = { kind: 'request', id: nextId++, method, params };
      pending.set(message.id, { resolve: resolve as (value: unknown) => void, reject });
      if (port === null) queued.push(message);
      else port.postMessage(message);
    });
  },
  onEvent(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  chooseNewWorldPath: (suggestedName) =>
    ipcRenderer.invoke(CHANNELS.chooseNewWorldPath, suggestedName) as Promise<string | null>,
  chooseWorldToOpen: () => ipcRenderer.invoke(CHANNELS.chooseWorldToOpen) as Promise<string | null>,
  openExternal: (url) => ipcRenderer.invoke(CHANNELS.openExternal, url) as Promise<void>,
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node,
  },
};

contextBridge.exposeInMainWorld('nationwright', api);
