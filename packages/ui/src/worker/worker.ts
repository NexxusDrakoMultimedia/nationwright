// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Utility-process entry point. The main process sends one MessagePort; every request
 * from the renderer arrives on it and is answered on it. The simulation runs here, off
 * the UI thread.
 */

import type { MessagePortMain } from 'electron';
import type { FromEngine, ToEngine } from '../shared/protocol.ts';
import { EngineHost } from './host.ts';

let port: MessagePortMain | null = null;
const send = (message: FromEngine) => port?.postMessage(message);
const host = new EngineHost((event) => send({ kind: 'event', event }));

process.parentPort.on('message', (message) => {
  if (message.data === 'shutdown') {
    host.shutdown();
    process.parentPort.postMessage('shutdown-complete');
    return;
  }
  const next = message.ports[0];
  if (next === undefined) return;
  port?.close();
  port = next;
  port.on('message', (event) => send(host.handle(event.data as ToEngine)));
  port.start();
});
