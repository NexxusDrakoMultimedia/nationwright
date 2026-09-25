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
- [x] World state container: meta, modifiers, chronicle, and per-system slices
      (`SystemSlices`, extended by module augmentation)
- [ ] Full World/Nation state types (DESIGN.md §6.1), added as each system lands
- [x] Calendar (monthly ticks; quarterly/annual cadences fire at period end)
- [x] Tick loop with the fixed 19-step system order (§3.1–3.2)
- [x] Command queue: validated on submit, re-validated and applied at the `policy` step,
      logged with its tick; exact `replay()` from seed + log
- [x] Read-only query API (`world`, `indicators`, `commandLog`, `snapshot()`)
- [x] Modifier registry: (base + Σadd) × Πmultiply, lifetimes, scopes, contributions
- [x] Indicator registry + in-memory store (ownership, finiteness, one value per tick)
- [x] Chronicle entries from systems

### Persistence
- [x] `SaveFile` (`packages/app`) on `better-sqlite3` 13; the engine never touches SQLite
- [x] Schema v1: `meta` (seed as 8-byte BLOB + base64url, versions, timestamps), `snapshot`,
      `commands` (applied and pending), `indicators`, `chronicle`
- [ ] Schema additions as their data lands: `entities`, `map_*`, `wars`, `reference_bands`,
      generator version/settings in `meta`
- [x] Migrations runner (`PRAGMA user_version`); rejects saves from newer versions
- [x] Save/load with `Engine.save()` / `Engine.restore()`; resume is byte-identical to an
      uninterrupted run; indicator writes are incremental
- [x] Branch by copying the file (`VACUUM INTO`)
- [ ] Branch from an *earlier* tick (replay the command log up to the branch point)
- [ ] Autosave policy (every N simulated years and before player decisions)
- [x] Determinism tests: same seed + commands ⇒ byte-identical state (engine and save round-trip)

### Electron shell
- [ ] Main process, engine in a utility process, typed IPC over MessagePort
- [ ] Renderer: React + Vite; `contextIsolation` on, `nodeIntegration` off, strict CSP,
      preload API
- [ ] Confirm `better-sqlite3` 13 (Node-API, prebuilt binaries) loads in Electron without a
      rebuild; otherwise add `@electron/rebuild`. electron-builder config

### CLI
- [ ] Headless batch runner: create world from seed, simulate N years, dump indicators

### Reference-data pipeline (factbook.json)
- [x] Fetch at the pinned commit (`npm run data:fetch`); hash recorded in the manifest
- [x] Per-field parsers (value, est_year, series history; percentage lists; borders) with
      trimmed CC0 fixtures
- [x] Classify entities (196 states, 43 territories, excluded); drop oceans, world, meta
- [x] Report: coverage, bands, consistency warnings, unparsed values (1 left: Holy See area "0 sq km")
- [x] Forward projection to the target year (DESIGN.md §10.1); low-confidence flags
- [x] Snapshot JSON + manifest + validation bands (41 indicators) for 2026, committed
- [ ] Parse military personnel strengths (free text) into personnel per capita
- [ ] Map border-country names to Factbook codes (for neighbour-similarity statistics in M1)
- [ ] Automatic yearly rebuild reminder (the start year advances even though the data is frozen)

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
