# Nationwright

A single-player nation simulator. Found a fictional country, shape its institutions and
policies, advance time, and watch it evolve through detailed statistical reports: census
tables, economic surveys, election results, league standings, war reports, and an annual
yearbook.

> **Status: early development.** World generation and the map work: a new world has
> 196 generated countries (by default) with terrain, climate, rivers, borders, provinces,
> cities, names, cultures, and statistics drawn from real-world distributions. You can
> explore it on the map, save it, and advance time. The simulation systems below
> (population, economy, politics, and the rest) are designed but not built yet. See
> [TODO.md](TODO.md) for progress and [DESIGN.md](DESIGN.md) for the full design.

## What it will simulate

- **Population & demographics:** cohort-component model by region, urban/rural, age,
  sex, and education, with a joint ethnicity × religion × language distribution
- **Cities**, **economy**, **education**, and **infrastructure**
- **Political institutions & elections:** constitutions, parties, coalitions, and
  pluggable electoral systems
- **Sports leagues:** clubs, seasons, promotion/relegation, and international
  tournaments
- **Foreign relations & war:** a world of fictional countries with their own
  governments, pairwise diplomacy, and operational-level conventional warfare
- **Intelligence & fog of war:** other countries are seen through your intelligence
  service's estimates; covert operations can be exposed
- **Historical events:** data-driven random, triggered, and scheduled events, recorded
  in a chronicle

## Key ideas

- **You are the overseer.** You set the agenda. Elections, legislatures, and courts
  constrain what gets done, but you are never voted out.
- **Fictional but grounded.** Every country, including yours, is procedurally generated.
  Its statistics are sampled from real-world distributions fitted to
  [factbook.json](https://github.com/factbook/factbook.json) (public domain), projected
  to the current year.
- **Every world is new.** Each world is generated at random; to share one, share its
  save file.
- **Generated map.** Terrain, climate, rivers, borders, regions, and cities are
  generated, and the map shows any statistic.
- **Deterministic and explainable.** The same world and inputs always give the same
  history, and every major number can be traced to its causes.

## Getting started

Requires Node.js 22.12 or later (see `.nvmrc`). From the repository root:

```sh
npm install
npm run ui:start        # build and launch the desktop app
```

Other useful commands:

| Command | What it does |
|---|---|
| `npm run check` | Typecheck, lint, format check, tests, and license check (what CI runs) |
| `npm run nw -- new world.nwsave` | Create a world from the command line |
| `npm run nw -- run world.nwsave --years 5` | Advance a saved world |
| `npm run nw -- info world.nwsave` | Show a save's dates and contents |
| `npm run ui:package -- --linux AppImage` | Build an installer into `packages/ui/dist/` |
| `npm run worldgen:validate` | Check 200 generated worlds against real-world statistics |

[CLAUDE.md](CLAUDE.md#commands) lists every command.

## Technology

TypeScript (strict) · Electron (React + Vite renderer, engine in a separate utility
process) · SQLite via `better-sqlite3` (one file per save) · Vitest. See
[DESIGN.md §9](DESIGN.md#9-technology).

```
packages/
  engine/          pure, deterministic simulation and world generation (no UI, no I/O)
  app/             saves, world sessions, and the ruleset of simulation systems
  ui/              Electron app: main process, preload, engine worker, React renderer
  cli/             headless command-line runner
  reference-data/  factbook.json ingest → guiding variables and validation bands
scripts/           license check, map renderer, world-generator validation
docs/validation/   latest world-generator validation report
```

A `content/` folder of YAML data packs (events, sports, culture and name packs,
tuning) is planned.

## Documents

| File | Purpose |
|---|---|
| [GOALS.md](GOALS.md) | Vision, goals, non-goals, and what success looks like |
| [DESIGN.md](DESIGN.md) | Full design: systems, architecture, data model, decisions log |
| [TODO.md](TODO.md) | Milestone task list |
| [CLAUDE.md](CLAUDE.md) | Guidance for AI coding assistants working in this repo |

## Data & attribution

Reference statistics come from the World Factbook via
[factbook/factbook.json](https://github.com/factbook/factbook.json), which is dedicated
to the public domain (CC0). No real country, person, or place appears in the game. The
data only shapes the statistical distributions that fictional nations are drawn from.

## License

Copyright (C) 2026 Nexxus Drako Multimedia.

Nationwright is free software: you can redistribute it and/or modify it under the terms
of the **GNU General Public License** as published by the Free Software Foundation,
either **version 3** of the License, or (at your option) **any later version** (SPDX:
`GPL-3.0-or-later`). It is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.
