// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { useCallback, useEffect, useState } from 'react';
import type { EngineEvent, MapData, WorldSummary } from '../shared/protocol.ts';
import { MapScreen } from './map/MapScreen.tsx';
import { About } from './About.tsx';
import { api } from './api.ts';

type Busy = { label: string; done: number; total: number } | null;

export function App() {
  const [world, setWorld] = useState<WorldSummary | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);

  useEffect(
    () =>
      api.onEvent((event: EngineEvent) => {
        if (event.type === 'progress') {
          setBusy((b) => (b === null ? b : { ...b, done: event.done, total: event.total }));
        }
      }),
    [],
  );

  const run = useCallback(async (label: string, task: () => Promise<WorldSummary | null>) => {
    setError(null);
    setBusy({ label, done: 0, total: 0 });
    try {
      const result = await task();
      if (result !== null) setWorld(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  // Open a world the app was launched with (double-clicked .nwsave).
  useEffect(() => {
    void api.initialWorldPath().then((path) => {
      if (path !== null) void run('Opening world', () => api.request('world.open', { path }));
    });
  }, [run]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Nationwright</h1>
        <nav>
          {world !== null && (
            <button
              type="button"
              onClick={() =>
                void run('Closing', async () => {
                  await api.request('world.close', null);
                  setWorld(null);
                  return null;
                })
              }
            >
              Close world
            </button>
          )}
          <button type="button" onClick={() => setShowAbout((v) => !v)}>
            {showAbout ? 'Back' : 'About'}
          </button>
        </nav>
      </header>

      <main className="content">
        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {busy !== null && (
          <p className="busy" aria-live="polite">
            {busy.label}
            {busy.total > 0 && ` — ${busy.done} of ${busy.total} months`}…
          </p>
        )}
        {showAbout ? (
          <About />
        ) : world === null ? (
          <StartScreen run={run} disabled={busy !== null} />
        ) : (
          <WorldScreen world={world} run={run} disabled={busy !== null} />
        )}
      </main>
    </div>
  );
}

interface ScreenProps {
  readonly run: (label: string, task: () => Promise<WorldSummary | null>) => Promise<void>;
  readonly disabled: boolean;
}

function StartScreen({ run, disabled }: ScreenProps) {
  const create = () =>
    void run('Creating world', async () => {
      const path = await api.chooseNewWorldPath('world');
      if (path === null) return null;
      return api.request('world.create', { path });
    });

  const open = () =>
    void run('Opening world', async () => {
      const path = await api.chooseWorldToOpen();
      return path === null ? null : api.request('world.open', { path });
    });

  return (
    <section className="panel start">
      <h2>New world</h2>
      <p className="hint">
        Each new world is generated at random and can't be recreated. Its save file is the world.
      </p>
      <div className="actions">
        <button type="button" className="primary" onClick={create} disabled={disabled}>
          Create world…
        </button>
        <button type="button" onClick={open} disabled={disabled}>
          Open world…
        </button>
      </div>
    </section>
  );
}

function WorldScreen({ world, run, disabled }: ScreenProps & { readonly world: WorldSummary }) {
  const [map, setMap] = useState<MapData | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .request('world.map', null)
      .then((data) => {
        if (!cancelled) setMap(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setMapError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [world.path]);

  const advance = (months: number, label: string) =>
    void run(label, () => api.request('world.advance', { months }));

  return (
    <section className="world">
      <div className="world-bar">
        <div>
          <h2>{world.date}</h2>
          <p className="hint">
            Started January {world.startYear} · {world.month} months simulated
          </p>
        </div>
        <div className="actions">
          <button type="button" onClick={() => advance(1, 'Advancing 1 month')} disabled={disabled}>
            +1 month
          </button>
          <button type="button" onClick={() => advance(12, 'Advancing 1 year')} disabled={disabled}>
            +1 year
          </button>
          <button
            type="button"
            onClick={() => advance(120, 'Advancing 10 years')}
            disabled={disabled}
          >
            +10 years
          </button>
        </div>
      </div>
      {mapError !== null && <p className="error">{mapError}</p>}
      {map === null && mapError === null && <p className="busy">Loading the map…</p>}
      {map !== null && <MapScreen map={map} />}
    </section>
  );
}
