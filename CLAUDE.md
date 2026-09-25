# CLAUDE.md

Guidance for Claude (and other AI assistants) working in this repository.

## Project state

Implementation is under way. **M0** (skeleton: engine core, saves, CLI, Electron shell,
reference-data pipeline) is done apart from items that depend on later milestones.
**M1** (world generation and the map) and **M2** (demography, culture, internal migration,
cities, census) are done apart from items that wait on later milestones; see TODO.md.
M3 (economy and world) is under way: the player's economy and the foreign countries'
reduced-form models run; trade, commodities, capital, and the economic reports come
next. Keep the **Commands** section below
current as scripts are added.

## Source of truth

- **DESIGN.md** is authoritative for how things work. Its **§0 Decisions Log (D1–D23)**
  records settled choices.
- **GOALS.md** says why and what. **TODO.md** is the working task list.
- **Never reverse or reinterpret a logged decision on your own.** If a task seems to
  need it, ask the user. When the user decides something new, add a `D<n>` row to §0,
  update every affected section, and bump the draft version in DESIGN.md's header.
- Keep the docs in sync: a change to behavior, a milestone, or scope should update
  DESIGN.md, TODO.md, and README.md/GOALS.md where relevant, in the same commit.

## Hard constraints (from the decisions log)

- **Language:** TypeScript with `strict: true` and `noUncheckedIndexedAccess` (D1).
  Desktop shell: Electron (D9). Persistence: SQLite via `better-sqlite3`, one file per
  save (D3).
- **Determinism (§3.3):**
  - No `Math.random()`, `Date.now()`, or `new Date()` in `packages/engine`. Only the
    application layer reads the clock, once, to set the start year.
  - All randomness comes from the **world seed**: 64 bits, stored as 11-character
    unpadded **base64url**. Seeds are internal (D23): never show one to the player or
    accept one from them in the UI, CLI, reports, or exports. The last character must be one of `AEIMQUYcgkosw048`, and
    the parser rejects non-canonical input. Standard base64 and `=` padding are
    converted before validation.
  - PRNG: xoshiro256\*\* seeded via SplitMix64. Every consumer uses its own
    domain-separated stream (e.g. `worldgen/elevation`, `sim/demography@tick:N`). Never
    share or reorder streams across systems.
  - Never call `Math.log`, `Math.exp`, `Math.pow`, or trigonometric functions in
    simulation code: engines may approximate them differently. Use `detLog`/`detExp` and
    the samplers in `random/distributions.ts`. Basic arithmetic, `Math.sqrt`,
    `Math.round`, `Math.floor`, `Math.min`/`max`, and `Math.abs` are exact and fine.
  - Iterate arrays or sorted keys only. Round integer quantities with
    largest-remainder so totals are conserved.
- **Engine purity:** `packages/engine` has no UI, no I/O, and no SQLite. Systems read
  any state but write only their own slice. Cross-system effects go through the
  modifier registry.
- **Fictional world (D12):** never put a real country, real person, or real place into
  generated content, names, or fixtures. Real data (factbook.json) is used only as
  aggregated statistics (guiding variables and validation bands).
- **No nuclear weapons (D15).** Don't add arsenals, deterrence, or nuclear use in code,
  content, or events. Nuclear *energy* is fine.
- **Civilian targeting is allowed (D21, replacing D16).** Player and AI war policies may
  target civilians, always with consequences; there is no opt-in toggle. Keep it
  aggregate and statistical, never graphic.
- **Fog of war (D22).** Governments see other countries only through their own
  intelligence estimates. The AI must decide on its estimates, not true state, and the
  renderer receives only the player's view outside sandbox mode.
- **Current year only (D7):** no historical start dates and no era system.
- **Culture tracking (D14):** ethnicity × religion × language is one joint
  distribution per cohort cell, stored sparsely. Associations are randomized per
  country from the seed.

## License

- The project is **GPLv3 or later** (`GPL-3.0-or-later`), copyright **Nexxus Drako
  Multimedia**. The full text is in `LICENSE`. Don't edit `LICENSE`.
- Set `"license": "GPL-3.0-or-later"` in every `package.json`. New source files start with
  these two lines:
  ```ts
  // SPDX-License-Identifier: GPL-3.0-or-later
  // Copyright (C) <year> Nexxus Drako Multimedia
  ```
- Only add dependencies whose licenses are GPLv3-compatible (e.g. MIT, BSD, ISC,
  Apache-2.0, LGPL, CC0). Flag anything else to the user before adding it: GPL-2.0-only,
  proprietary, or "non-commercial" licenses are *not* compatible.
- Distributed builds (Electron installers) must offer the corresponding source.

## Reference data

- Source: [factbook/factbook.json](https://github.com/factbook/factbook.json), CC0. It
  is **frozen**: the last data update was 2026-01-22, after which the CIA retired the
  World Factbook.
- Always pin the source to a commit hash. Values are free text with estimate years
  (e.g. `"9,174,390 (2025 est.)"`). Parse with per-field extractors and fixtures, and
  log unparsed values rather than guessing.
- Country codes are the Factbook's own GEC codes, **not ISO**.
- Stale values are projected forward to the start year (D11; rules in DESIGN.md
  §10.1).
- The game ships only fitted statistics, never per-country records.

## Conventions

- Layout: npm workspaces: `packages/engine` (pure simulation), `app` (saves, sessions,
  ruleset), `cli`, `reference-data`, `ui` (Electron: `main`, `preload`, `worker` = engine process,
  `renderer` = React); `content/` (YAML validated with zod/JSON Schema) comes next.
  New systems are registered in `packages/app/src/ruleset.ts`.
- Electron security settings in `packages/ui/src/main/main.ts` (context isolation, sandbox,
  CSP, denied navigation/permissions, link allowlist) are requirements, not defaults to
  relax. `--no-sandbox` is only for the smoke test when running as root.
- Packages export TypeScript source directly (`"exports": "./src/index.ts"`) and import
  with explicit `.ts` extensions.
- TypeScript is pinned to **6.0.x**: typescript-eslint doesn't support TypeScript 7 yet.
  Upgrade both together.
- Tests: Vitest; golden-master and property-based (`fast-check`) tests for
  determinism, the seed codec, world generation, and balance.
- Changing generator output requires bumping `generator_version` and updating golden
  masters in the same change.
- Performance: no targets yet (D19). Measure and report; don't optimize speculatively.
- Keep commits focused, with clear messages. Don't create pull requests unless asked.

## Commands

Requires Node ≥ 22.12 (see `.nvmrc`). From the repository root:

| Command | What it does |
|---|---|
| `npm install` | Install all workspace dependencies |
| `npm run check` | Everything CI runs: typecheck, lint, format check, tests, license check |
| `npm run typecheck` | `tsc` over all packages (no emit) |
| `npm run lint` | ESLint, including the engine determinism rules |
| `npm run format` / `format:check` | Prettier (Markdown is excluded on purpose) |
| `npm test` / `npm run test:watch` | Vitest |
| `npx vitest run -u` | Update snapshots. Only do this deliberately: the stream golden master pins every world |
| `npm run licenses` | Fail on any installed package whose license isn't GPL-3.0-or-later compatible |
| `npm run data:fetch` | Clone factbook.json at the pinned commit into `packages/reference-data/.cache/` |
| `npm run data:build -- --target-year 2026` | Rebuild `packages/reference-data/data/` (review `report-<year>.md` in the diff) |
| `npm run worldgen:validate` | Generate 200 worlds and write `docs/validation/worldgen.md` (about a minute; rerun after generator or guiding-model changes) |
| `npm run sim:validate` | Simulate 50 nations for 30 years against the real-world bands (census and economy) and write `docs/validation/simulation.md` (a few minutes; rerun after simulation changes) |
| `npm run perf:measure` | Time world creation, simulation, and saves by world size into `docs/validation/performance.md` |
| `npm run nw -- <command>` | Headless CLI: `new <file>`, `run <file> --years N`, `info`, `census`, `indicators`, `branch` |
| `npm run ui:build` | Build the desktop app into `packages/ui/out/` |
| `npm run ui:start` | Build and launch the desktop app |
| `npm run ui:smoke` | End-to-end Electron test under Xvfb (add `-- --app <binary>` for a packaged build) |
| `npm run ui:smoke -- --ui <world.nwsave> --out <dir>` | Open a world in the app and screenshot each map layer, a profile, and the census |
| `npm run ui:package -- --linux AppImage` | Build an installer into `packages/ui/dist/` |

Never combine file edits (scripts, `sed`, `python`) with long-running commands
(`npm run check`, `ui:build`, `ui:smoke`, validation scripts) in one shell command: make
the edits, then run each long command separately, so a cancelled command never leaves
edits applied but unchecked.

Run `npm run check` before every commit. After adding or changing any `package.json`
(including a new workspace package), run `npm install` and commit `package-lock.json`, or
CI's `npm ci` fails. After touching `packages/ui/src/{main,preload,worker}`, also run
`npm run ui:build && npm run ui:smoke`.
