# TODO

Working task list, organized by the milestones in [DESIGN.md §11](DESIGN.md#11-milestones).
Each milestone ends with a playable build and updated golden-master tests. Check items
off as they land; add new ones as work reveals them.

## M0 — Skeleton

### Repository & tooling
- [x] Choose a project license: GPLv3 or later (`GPL-3.0-or-later`), © Nexxus Drako Multimedia, full text in `LICENSE`
- [x] Set `"license": "GPL-3.0-or-later"` in every `package.json` (root, engine; keep doing it for new packages)
- [ ] Add a dependency-license check to CI
- [ ] Show the license and source-code link in the app's About/credits screen
- [x] npm workspaces monorepo (`packages/*`); `packages/engine` created
- [ ] Remaining packages as they're built: `app`, `ui`, `cli`, `reference-data`; `content/`
- [x] TypeScript config: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; shared `tsconfig.base.json`
- [x] ESLint (typescript-eslint strict) + Prettier; engine rule banning `Math.random`, `Date`, `performance`, `crypto`
- [x] Vitest setup; CI workflow (typecheck, lint, format check, test)
- [x] Fill in the **Commands** section of CLAUDE.md

### Seed & randomness
- [x] Seed codec: 8 bytes ⇄ 11-char base64url; canonical last-char check; accept
      standard base64 / padding
- [x] Seed codec tests: round-trip, `0`, `2^64−1`, rejection cases (property-based)
- [x] SplitMix64 + xoshiro256\*\* (32-bit ops), with reference test vectors and a bigint oracle
- [x] Domain-separated streams (`FNV-1a 64` domain hash, pinned) with a golden master
- [ ] Deterministic normal/exponential/Poisson samplers (portable math: don't rely on
      `Math.log`/`Math.cos` being identical across JS engines)

### Engine core
- [ ] World/Nation state types (DESIGN.md §6.1)
- [ ] Tick loop with fixed system order and cadences (§3.1–3.2)
- [ ] Command queue (validated, logged) and query API (§3.4)
- [ ] Modifier registry (source, target, value, expiry)
- [ ] Indicator registry + store

### Persistence
- [ ] Storage interface; `better-sqlite3` implementation
- [ ] Schema v1: `meta` (seed BLOB + base64url, versions, settings), `snapshot`,
      `commands`, `indicators`, `entities`, `chronicle`, `reference_bands`
- [ ] Migrations runner; save/load; autosave; branch via `VACUUM INTO`
- [ ] Determinism test: same seed + commands ⇒ byte-identical state

### Electron shell
- [ ] Main process, engine in a utility process, typed IPC over MessagePort
- [ ] Renderer: React + Vite; `contextIsolation` on, `nodeIntegration` off, strict CSP,
      preload API
- [ ] `better-sqlite3` rebuilt for Electron's ABI; electron-builder config

### CLI
- [ ] Headless batch runner: create world from seed, simulate N years, dump indicators

### Reference-data pipeline (factbook.json)
- [ ] Fetch at a pinned commit; record the hash in the manifest
- [ ] Per-field parsers (value, unit, est_year; percentage lists; border lists) with
      fixtures
- [ ] Normalize (GEC codes → internal IDs; drop oceans, Antarctica, world, meta)
- [ ] Unparsed-value and coverage report
- [ ] Forward projection to the target year (DESIGN.md §10.1); low-confidence flags
- [ ] Snapshot SQLite + manifest; validation bands (typical / plausible / implausible)

## M1 — World Generation & Map
- [ ] Guiding variables: marginals, Gaussian copula, archetype clustering, categorical
      tables, structure and spatial-similarity statistics
- [ ] Map: Poisson-disk cells → Voronoi (`d3-delaunay`) → Lloyd relaxation
- [ ] Elevation (noise + ridges), sea level to target land fraction
- [ ] Climate → biomes; hydrology → rivers/lakes; habitability; resources
- [ ] Countries by weighted flood fill; continents/subregions; provinces; cities
- [ ] Sea lanes and distance graph
- [ ] Nation statistics sampling with consistency derivation
- [ ] Culture packs and name generators (fictional only)
- [ ] Randomized ethnicity × religion × language associations (alignment draws + IPF)
- [ ] Store the generated map in the save; `generator_version`
- [ ] Generator statistical tests across ≥ 200 seeds; reproducibility golden masters
- [ ] Map screen: political, physical, choropleth layers; pan/zoom; profiles

## M2 — People & Places
- [ ] Cohort grid (region × urban/rural × age × sex × education)
- [ ] Sparse joint culture distribution (combination table, pruning)
- [ ] Fertility, mortality, aging; internal migration
- [ ] Language shift, conversion/secularization, intermarriage
- [ ] Regions from the map; cities and growth
- [ ] Census report, population pyramid; validation against bands
- [ ] Performance measurements by world size (reported, not gated)

## M3 — Economy & World
- [ ] Sectors, production, labor market, prices, public finance, exchange rate
- [ ] Foreign country mid-depth model
- [ ] Trade (gravity), commodities, capital, international migration channels
- [ ] Economic survey, budget, world comparison reports; flows map layer

## M4 — Politics, Elections & Diplomacy
- [ ] Constitution, offices, parties, approval, legislation, courts
- [ ] Electoral systems: FPTP, list PR (D'Hondt, Sainte-Laguë); coalition formation
- [ ] Foreign governments, elections, coups/revolutions
- [ ] Pairwise relations matrix, blocs/alliances, salience tiers
- [ ] Foreign-policy AI (utility scoring); overseer autopilot hook
- [ ] Election and foreign relations reports

## M5 — Military & War
- [ ] Armed forces, defense budget, conscription (conventional only; no nuclear weapons)
- [ ] Path to war, war powers, alliance calls
- [ ] Theater graph from the map; monthly front resolution; naval/air
- [ ] Casualties, displacement, damage feeding other systems
- [ ] Civilian harm as an outcome, with its consequences
- [ ] Peace terms, territory transfer, insurgency, civil war
- [ ] Burn-in backstory (~30 years)
- [ ] War report, defense review, war map layer; war sanity tests

## M6 — Education & Infrastructure
- [ ] Enrollment, graduation, quality, human capital link
- [ ] Infrastructure assets, projects, decay, war damage and repair
- [ ] Education and infrastructure reports; infrastructure map layer

## M7 — Events & Chronicle
- [ ] YAML event schema; random, triggered, scheduled, and player-initiated events
- [ ] Choices, chains, flags; foreign events spilling over
- [ ] "Why did this change?" explanations from the modifier registry
- [ ] Chronicle and yearbook

## M8 — Sports
- [ ] Sports, leagues, teams; match engine (Elo/Poisson)
- [ ] Seasons, promotion/relegation, cups; national teams, tournaments
- [ ] Sports almanac

## M9 — Creation Wizard & Polish
- [ ] Wizard: seed entry/reroll with live map preview, slot placement, archetype
      profiles, plausibility review
- [ ] Dashboards, world atlas, exports (CSV/JSON, SVG/PNG maps), comparative views
- [ ] Credits/attribution screen; installers; onboarding

## v1.x
- [ ] More electoral systems (two-round, MMP, IRV)
- [ ] Named athletes
- [ ] Branching timelines UI
- [ ] Modding documentation
