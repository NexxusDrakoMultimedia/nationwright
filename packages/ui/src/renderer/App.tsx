// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { useCallback, useEffect, useState } from 'react';
import type { EngineEvent, WorldSummary } from '../shared/protocol.ts';
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
  const [seed, setSeed] = useState('');
  const [seedError, setSeedError] = useState<string | null>(null);

  const reroll = useCallback(async () => {
    setSeed(await api.request('seed.generate', null));
    setSeedError(null);
  }, []);

  useEffect(() => {
    void reroll();
  }, [reroll]);

  const create = () =>
    void run('Creating world', async () => {
      const check = await api.request('seed.check', { text: seed });
      if (!check.ok) {
        setSeedError(check.message);
        return null;
      }
      const path = await api.chooseNewWorldPath(check.canonical);
      if (path === null) return null;
      return api.request('world.create', { path, seed: check.canonical });
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
        Every world comes from a 64-bit seed. Share the seed to share the world.
      </p>
      <label className="seed">
        <span>World seed</span>
        <input
          value={seed}
          spellCheck={false}
          maxLength={16}
          aria-invalid={seedError !== null}
          onChange={(e) => {
            setSeed(e.target.value);
            setSeedError(null);
          }}
        />
        <button type="button" onClick={() => void reroll()} disabled={disabled}>
          Reroll
        </button>
      </label>
      {seedError !== null && <p className="error">{seedError}</p>}
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={create}
          disabled={disabled || seed === ''}
        >
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
  const advance = (months: number, label: string) =>
    void run(label, () => api.request('world.advance', { months }));

  return (
    <section className="panel world">
      <h2>{world.date}</h2>
      <dl className="facts">
        <dt>World seed</dt>
        <dd>
          <code>{world.seed}</code>
        </dd>
        <dt>Started</dt>
        <dd>January {world.startYear}</dd>
        <dt>Months simulated</dt>
        <dd>{world.month}</dd>
        <dt>Systems</dt>
        <dd>
          {world.systems.length === 0
            ? 'none yet (world generation arrives in M1)'
            : world.systems.join(', ')}
        </dd>
        <dt>Save file</dt>
        <dd className="path">{world.path}</dd>
      </dl>
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
    </section>
  );
}
