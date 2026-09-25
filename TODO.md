# TODO

Working task list, organized by the milestones in [DESIGN.md §11](DESIGN.md#11-milestones).
Each milestone ends with a playable build and updated golden-master tests. Check items
off as they land; add new ones as work reveals them.

## M0 — Skeleton

### Repository & tooling
- [x] Choose a project license: GPLv3 or later (`GPL-3.0-or-later`), © Nexxus Drako Multimedia, full text in `LICENSE`
- [x] Set `"license": "GPL-3.0-or-later"` in every `package.json` (root, engine; keep doing it for new packages)
- [x] Dependency-license check (`npm run licenses`, in CI and `npm run check`)
- [x] Show the license and source-code link in the app's About/credits screen
- [x] npm workspaces monorepo (`packages/*`); `packages/engine` created
- [x] Packages: `engine`, `app`, `cli`, `reference-data`
- [x] `ui` (Electron)
- [ ] `content/` (with the first data-driven content in M1)
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
- [x] Portable `detLog`/`detExp` (IEEE basic operations only; ≤ 4e-16 relative error)
- [x] Samplers on top of them: normal (polar), log-normal, exponential, Poisson (exact
      below λ = 30, normal approximation above), weighted index, shuffle

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
- [x] Branch from an earlier tick (`WorldSession.branch`, replaying the command log)
- [x] Autosave every N simulated years (`WorldSession`, default 5)
- [ ] Autosave before player decisions (needs choice events, M7)
- [x] Determinism tests: same seed + commands ⇒ byte-identical state (engine and save round-trip)

### Electron shell
- [x] Main process, engine in a utility process, typed protocol over a MessagePort
- [x] Renderer: React + Vite; `contextIsolation` on, `nodeIntegration` off, `sandbox` on,
      strict CSP, narrow preload API; navigation, new windows, and permissions denied
- [x] `better-sqlite3` 13 (Node-API) loads in Electron without a rebuild, also when packaged
- [x] Minimal UI: new world (seed entry/reroll/validation), open, advance, close, About
- [x] End-to-end smoke test (`npm run ui:smoke`), in CI with the sandbox on
- [x] electron-builder config (`npm run ui:package`): Linux AppImage verified locally;
      macOS dmg and Windows nsis configured but not yet built
- [ ] App icon (installers currently use Electron's default)
- [ ] Development mode with hot reload (Vite dev server + `NATIONWRIGHT_RENDERER_URL`)
- [ ] Ship only the current platform's `better-sqlite3` prebuild (all 8 are packaged now)
- [ ] Code signing / notarization for macOS and Windows installers

### CLI
- [x] Application layer: `WorldSession` (create/open/advance/autosave/branch) and the
      ruleset registry (`packages/app`)
- [x] Headless runner (`packages/cli`, `npm run nw -- <command>`): `seed`, `new`, `run`,
      `info`, `indicators` (CSV), `branch`

### Reference-data pipeline (factbook.json)
- [x] Fetch at the pinned commit (`npm run data:fetch`); hash recorded in the manifest
- [x] Per-field parsers (value, est_year, series history; percentage lists; borders) with
      trimmed CC0 fixtures
- [x] Classify entities (196 states, 43 territories, excluded); drop oceans, world, meta
- [x] Report: coverage, bands, consistency warnings, unparsed values (2 left, both
      genuine: Libya personnel "not available", Holy See area "0 sq km")
- [x] Forward projection to the target year (DESIGN.md §10.1); low-confidence flags
- [x] Snapshot JSON + manifest + validation bands (43 indicators) for 2026, committed
- [x] Parse military personnel strengths (free text) into personnel per 1,000 people
- [x] Map border-country names to Factbook codes (all 660 references resolve)
- [ ] Automatic yearly rebuild reminder (the start year advances even though the data is frozen)

## M1 — World Generation & Map
- [x] Guiding variables: 101-percentile marginals, normal scores, 6 k-means archetypes,
      categorical tables, structure and spatial statistics (`guiding-variables-2026.json`,
      model v2: no imputation, states that don't report a variable are left out of it)
- [x] Engine sampler: archetype choice with neighbour copying, correlated draw, marginals,
      consistency identities; statistical tests against the model (KS < 0.08, |Δρ| < 0.15)
- [x] Map cells: jittered hex lattice + Delaunay adjacency, wrapping east–west
- [x] Elevation (warped continent cores, archipelagos, ridges), exact land fraction
- [x] Climate → biomes; priority-flood hydrology → rivers/lakes; habitability
- [ ] Resource deposits (with the economy, M3)
- [x] Countries: island capitals, archetype priors, room matching, cost-weighted growth
- [x] Continents, subregions, provinces (farthest-point seeds), cities (Zipf)
- [ ] Sea lanes and distance graph (M3)
- [x] Nation statistics placed on the map; population spread by habitability²
- [x] Generator tests: determinism, golden master (v2), invariants on 5 seeds, real
      island/landlocked/one-neighbour shares; `scripts/render-map.ts` for eyeballing
- [x] Culture families (spatially clustered), per-family phonologies, names for countries,
      demonyms, cities, provinces, faiths, languages; blocklist of hashed real country and
      capital names (`name-blocklist.json`, 1,066 hashes) plus an offensive-substring filter
- [x] Randomized ethnicity × religion × language associations (alignment draws + IPF),
      shares matching sampled fractionalization with a 1% floor
- [x] Store the generated world in the save (schema v2: `map_layers`, `worldgen`;
      `generator_version`, `guiding_model_version`, `generator_settings` in `meta`); loaded,
      never regenerated; carried into branches
- [x] World system (`packages/app/src/systems/world.ts`) owning per-country state
- [x] Generator statistical validation across 200 seeds (`npm run worldgen:validate`,
      outside CI; report in `docs/validation/worldgen.md`, PASS); border-agreement calibration
- [ ] Reduce one-neighbour countries (14% vs. 8% real) and the >14-neighbour tail
- [x] Map screen: political (graph-coloured), physical (biomes, rivers), statistics
      (quantile choropleth on the validated blue ramp, neutral water, legend, tooltip,
      table view); pan/zoom with east–west wrap; keyboard controls; country profiles
- [x] Open a world passed on the command line (`.nwsave` file association)
- [x] UI smoke test with screenshots (`npm run ui:smoke -- --ui <world> --out <dir>`)
- [x] Run the UI smoke test in CI; both smoke tests print live progress
- [ ] Map: vector borders/labels at high zoom, province and city layers, dark-mode map palette review

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
