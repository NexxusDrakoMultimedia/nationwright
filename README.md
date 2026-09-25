# Nationwright

A single-player nation simulator. Found a fictional country, shape its institutions and
policies, advance time, and watch it evolve through detailed statistical reports: census
tables, economic surveys, election results, league standings, war reports, and an annual
yearbook.

> **Status: design phase.** There is no code yet. The design is in
> [DESIGN.md](DESIGN.md), and implementation starts with milestone M0 in
> [TODO.md](TODO.md).

## What it simulates

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

## Planned technology

TypeScript (strict) · Electron (React + Vite renderer) · SQLite via `better-sqlite3`
(one file per save) · Vitest. See [DESIGN.md §9](DESIGN.md#9-technology).

Planned monorepo layout:

```
packages/
  engine/          pure simulation library (no UI, no I/O)
  app/             save/load, command queue, report builder
  ui/              Electron renderer (React)
  cli/             headless batch runner
  reference-data/  factbook.json ingest → guiding variables and validation bands
content/           YAML data packs (events, sports, culture/name packs, tuning)
```

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
