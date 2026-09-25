# Nationwright — Design Document

> Status: **Draft v0.1** · Last updated: 2026-09-25
>
> This document describes what Nationwright is, how the simulation works, and how the
> software is structured. Sections marked **[Decision needed]** are open questions that
> should be settled before or during the milestone that depends on them.

---

## 1. Overview

Nationwright is a single-player nation simulator. The player founds a fictional country,
shapes its institutions and policies, and advances time to watch the nation evolve. The
core loop is:

1. **Configure** — create or edit the nation (geography, cities, institutions, policies).
2. **Simulate** — advance time by a chosen step (month, quarter, year, or N years).
3. **Observe** — read generated statistical reports, charts, and a chronicle of events.
4. **React** — respond to events, change policies, call elections, build infrastructure.

The emphasis is on **plausible, inspectable statistics** rather than real-time action.
The game is closer to a "living almanac" than a strategy game: players should be able to
ask "why did this number change?" and get an answer.

### 1.1 Goals

- **Coherent systems.** Population, economy, education, politics, and infrastructure feed
  into each other through explicit, documented relationships.
- **Deterministic and reproducible.** Same seed + same player inputs = same history.
- **Explainable.** Every major indicator can be traced back to its drivers.
- **Rich reporting.** Census-style tables, time series, league tables, election results,
  and annual yearbooks are first-class output, not afterthoughts.
- **Moddable data.** Event definitions, name lists, sports, party ideologies, and tuning
  constants live in data files, not code.
- **Fast.** Simulating 100 years of a nation with ~50 cities should take seconds, not
  minutes.

### 1.2 Non-goals (for v1)

- Multiplayer or online features.
- Real-time gameplay or tactical warfare.
- Map-based geography rendering beyond a simple schematic (see §12).
- Simulating individual citizens (agent-based). The model is aggregate/cohort-based,
  with named individuals only where they matter (politicians, athletes, notable figures).
- Modelling real-world countries accurately.

---

## 2. Core Concepts

| Concept | Description |
|---|---|
| **Nation** | The root aggregate. Owns all state for one save. |
| **Region** | Optional administrative subdivision (state/province). Contains cities and rural population. |
| **City** | A settlement with its own population, economy share, infrastructure, and institutions (e.g. universities, sports teams). |
| **Cohort** | A population bucket keyed by region × age band × sex (optionally × education level). The unit of demographic simulation. |
| **Tick** | One simulation step. The base tick is **one month**. Larger steps are repeated ticks. |
| **System** | A self-contained simulation module (Demography, Economy, Politics…) that reads state and writes its own slice of state each tick. |
| **Indicator** | A named, recorded time series (e.g. `population.total`, `economy.gdp_real`, `education.literacy_rate`). |
| **Event** | Something that happens at a point in time — scheduled, random, triggered by conditions, or player-initiated — with effects on state. |
| **Chronicle** | The ordered log of events and notable changes; the nation's "history book." |
| **Report** | A generated document (table, chart, or narrative) derived from state and indicators. |

---

## 3. Simulation Architecture

### 3.1 Time model

- Base tick: **1 month**. Calendar starts at a player-chosen founding year.
- Some systems run on coarser cadences inside the monthly tick:
  - Monthly: economy flows, approval, event checks, sports fixtures during season.
  - Quarterly: GDP accounting, unemployment, inflation.
  - Annually: demographic aging, births/deaths reconciliation, school year rollover,
    budget, infrastructure depreciation, yearbook generation.
  - Irregular: elections (per constitutional schedule or snap elections).
- The player can advance by 1 month, 1 quarter, 1 year, N years, or "until next event
  requiring input."

### 3.2 Tick pipeline

Each tick runs systems in a fixed, documented order. Systems read the state as of the
start of the tick plus outputs of systems earlier in the same tick.

```
 1. Calendar          advance date, determine which cadences fire
 2. Events (pre)      fire scheduled events, roll random events, evaluate triggers
 3. Policy            apply player decisions queued since last tick
 4. Demography        births, deaths, aging, migration (internal + international)
 5. Education         enrollment, graduation, attainment shifts in cohorts
 6. Economy           labor supply → output → incomes → prices → trade → public finance
 7. Infrastructure    capacity, utilization, construction progress, decay
 8. Cities            urbanization, city growth, service levels
 9. Politics          approval, party support, stability, legislation progress
10. Elections         run any elections scheduled for this tick
11. Sports            fixtures, results, standings, season transitions
12. Events (post)     evaluate condition-triggered events from new state
13. Indicators        record time series for this tick
14. Chronicle         append notable changes and events
```

Ordering rationale: demography produces the people that education and the economy then
use; the economy produces the revenue that infrastructure and politics depend on;
politics reacts to the outcomes of everything before it.

### 3.3 Determinism

- A single seeded PRNG (e.g. PCG32 or xoshiro128\*\*) is owned by the simulation.
- Each system derives its own **sub-stream** from `(seed, system_id, tick)` so that adding
  randomness to one system does not shift outcomes in another.
- No wall-clock time, unordered map iteration, or floating-point non-determinism in the
  engine (avoid parallel reductions whose order can vary).
- A save stores the seed plus a log of player inputs, which enables **replay** and
  **branching** ("what if I had lost that election?").

### 3.4 Engine / UI separation

The simulation engine is a pure library with no UI dependencies:

```
          ┌───────────────────────────────┐
          │           UI layer            │  screens, charts, dialogs
          └──────────────┬────────────────┘
                         │ commands / queries
          ┌──────────────▼────────────────┐
          │       Application layer       │  save/load, command queue, report builder
          └──────────────┬────────────────┘
                         │
          ┌──────────────▼────────────────┐
          │       Simulation engine       │  state, systems, events, RNG
          └──────────────┬────────────────┘
                         │
          ┌──────────────▼────────────────┐
          │    Content / data packs       │  events, names, tuning, rulesets
          └───────────────────────────────┘
```

- **Commands** mutate state only between ticks (e.g. `SetTaxRate`, `FoundCity`,
  `CallSnapElection`). They are validated, queued, and logged for replay.
- **Queries** are read-only (e.g. `GetIndicator`, `GetElectionResult`).
- This makes the engine testable headless and allows a CLI "batch simulate" mode.

---

## 4. Domain Systems

Each subsection lists the system's **state**, **inputs**, **outputs**, and **key
mechanics**. Formulas are initial proposals; constants live in tuning files.

### 4.1 Population & Demographics

**State:** cohorts by region × 5-year age band (0–4 … 100+) × sex; optional attributes
per cohort: education level, urban/rural, ethnicity/language/religion shares
(configurable, may be empty).

**Mechanics:**
- **Cohort-component model** — the standard demographic projection method:
  - Births = Σ (women in age band × age-specific fertility rate).
  - Deaths = Σ (cohort × age-specific mortality rate).
  - Aging moves 1/5 of each band upward per year (or 1/60 monthly).
- **Fertility** is driven by a baseline Total Fertility Rate modified by income,
  female education, urbanization, and policy (e.g. child benefits).
- **Mortality** is driven by a life-expectancy baseline modified by healthcare
  infrastructure, income, and shocks (epidemics, disasters, war).
- **Migration:**
  - *Internal:* flows between regions/cities based on relative wages, jobs, and
    services (gravity-style model).
  - *International:* net migration based on relative prosperity, stability, and
    immigration policy.

**Outputs / indicators:** total population, growth rate, crude birth/death rates, TFR,
life expectancy, median age, dependency ratio, population pyramid, urbanization rate,
minority shares.

### 4.2 Cities

**State:** name, region, founding date, population (derived from cohorts or tracked as
a share of regional urban population), economic specialization, service levels, list of
attached institutions (universities, stadiums, capital status).

**Mechanics:**
- City growth follows regional urban growth distributed by attractiveness
  (jobs, infrastructure, amenities, capital bonus).
- New settlements can be founded by the player or emerge when rural population density
  and infrastructure cross thresholds.
- Cities rank by size; the rank-size distribution is reported (Zipf check as a sanity
  indicator).

**Outputs:** city population table, growth leaderboard, city profiles.

### 4.3 Economy

The economy is a **simplified macro model**, not a full general-equilibrium model.

**State:** sectors (agriculture, industry, services, public sector; extensible),
capital stock per sector, productivity (TFP), price level, interest rate, government
budget and debt, trade balance, unemployment.

**Mechanics:**
- **Output:** Cobb-Douglas production per sector,
  `Y = A · K^α · (H · L)^(1−α)`, where `H` is human capital from education and `A`
  is productivity influenced by infrastructure and institutions.
- **Labor market:** labor force = working-age population × participation rate;
  employment allocated to sectors by relative wages; unemployment has a natural rate plus
  a cyclical component.
- **Investment & capital:** savings rate → investment → capital accumulation with
  depreciation.
- **Prices:** inflation driven by output gap and money/fiscal stance (simple Phillips-curve
  style relationship).
- **Public finance:** revenue from income, corporate, consumption, and trade taxes;
  spending on education, health, infrastructure, defense, welfare, debt service;
  deficit → debt.
- **Structural change:** sector shares shift with development (agriculture → industry →
  services).
- **Business cycle:** mean-reverting shocks plus event-driven shocks (recession, boom,
  commodity price swing).

**Outputs:** GDP (nominal/real), GDP per capita, growth, sector shares, unemployment,
inflation, Gini coefficient (from an income distribution approximation), budget balance,
debt-to-GDP, trade balance.

### 4.4 Political Institutions

**State:**
- **Constitution:** system of government (presidential, parliamentary,
  semi-presidential, monarchy variants, one-party state), term lengths, term limits,
  legislature structure (uni/bicameral, seat counts), electoral system(s), federal vs.
  unitary, judicial independence level, amendment rules.
- **Offices:** head of state, head of government, cabinet, legislature seats — held by
  named politicians belonging to parties.
- **Parties:** name, ideology position on a small number of axes (e.g. economic
  left–right, social liberal–conservative, centralist–regionalist), base support by
  demographic group, leader.
- **Political climate:** government approval, party support, stability/legitimacy,
  civil liberties, corruption.

**Mechanics:**
- **Approval** responds to economic performance (growth, unemployment, inflation),
  events, scandals, and time in office (incumbency fatigue).
- **Party support** = Σ over demographic groups (group size × group affinity for party),
  where affinity depends on ideological distance to the group's preferences and on
  government performance for the incumbent. This ties politics directly to demographics
  and education.
- **Legislation:** player-proposed policies must pass the legislature; passage
  probability depends on the government's seat share, coalition discipline, and
  ideological fit.
- **Stability:** low legitimacy + economic distress can trigger protests, government
  collapse, or (in fragile regimes) coups as events.
- **Constitutional change:** amendments follow the constitution's own rules
  (supermajority, referendum).

**Outputs:** approval series, party polling, composition of government, legislation log,
stability indices.

### 4.5 Elections

**Mechanics:**
- Elections are scheduled by the constitution; snap elections can be triggered by events
  or the player (if the constitution allows).
- **Vote model:** per region, compute party vote shares from party support (§4.4) plus
  campaign effects, turnout model, and a random error term (polling error).
- **Electoral systems** (pluggable, one module each):
  - First-past-the-post (single-member districts)
  - Two-round system
  - Party-list proportional representation — D'Hondt and Sainte-Laguë, with thresholds
  - Mixed-member proportional
  - Instant-runoff / ranked-choice (needs a preference-order approximation)
- **Districts:** generated from regions/cities with configurable magnitudes;
  malapportionment is reported.
- **Government formation:** majority → single-party government; otherwise coalition
  formation by minimal-connected-winning heuristic on ideological axes.
- **Pre-election polling:** synthetic polls with sampling noise, so players see
  uncertainty before results.

**Outputs:** results by district/region, seat allocation, turnout, swing, proportionality
index (Gallagher), historical election table.

### 4.6 Education

**State:** per region: schools/places at each level (primary, secondary, tertiary,
vocational), enrollment, teacher counts, spending per student, quality index; named
universities attached to cities.

**Mechanics:**
- **Enrollment rate** per level depends on capacity, household income, urban/rural,
  and compulsory-schooling policy.
- **Graduation** moves cohorts to higher attainment levels as they age out of school
  bands.
- **Quality** depends on spending per student and student–teacher ratio; quality
  multiplies the human-capital contribution of attainment.
- **Human capital index** `H` feeds the economy (§4.3); female attainment feeds
  fertility (§4.1); attainment feeds party affinity (§4.4).

**Outputs:** literacy rate, enrollment ratios by level, mean years of schooling,
attainment distribution of adults, education spending % of GDP, university rankings
(internal).

### 4.7 Infrastructure

**State:** a set of asset categories per region/city, each with capacity, condition
(0–100%), and maintenance cost:
- Transport: roads, rail, ports, airports
- Energy: generation capacity by source, grid coverage
- Water & sanitation
- Healthcare: hospital beds, clinics
- Communications: telecom/internet coverage
- Housing stock

**Mechanics:**
- **Projects:** the player (or AI government) commissions projects with cost, duration,
  and resulting capacity. Construction progresses monthly if funded.
- **Decay:** condition declines each year unless maintenance is funded; low condition
  reduces effective capacity and can trigger failure events (blackouts, bridge collapse).
- **Utilization:** demand (from population and economy) vs. capacity; over-utilization
  penalizes productivity, city attractiveness, and health outcomes.
- **Effects:** transport and energy raise TFP; healthcare lowers mortality; housing
  constrains city growth; communications raise productivity in services.

**Outputs:** coverage rates, capacity vs. demand, project pipeline, infrastructure
investment % of GDP, asset condition overview.

### 4.8 Sports Leagues

Sports give the nation cultural texture and generate a steady stream of storylines.

**State:**
- **Sports** (data-defined): name, season calendar, match format, scoring model,
  popularity.
- **Leagues:** tiers, number of teams, season structure (round robin, playoffs),
  promotion/relegation or closed franchise model, cup competitions.
- **Teams:** name, home city, founding year, strength rating, finances, stadium,
  fan base.
- **Athletes (optional, v1.x):** named notable players with ratings and careers.

**Mechanics:**
- **Team founding:** new teams appear as cities grow and sport popularity rises; teams
  can relocate or fold under financial stress.
- **Match results:** probabilistic model from team strengths (e.g. Elo-based win
  probability; Poisson goals for football-like sports).
- **Strength evolution:** driven by team finances (linked to city population and
  income), random development, and regression to the mean.
- **Season lifecycle:** fixtures → standings → playoffs/cups → promotion/relegation →
  off-season.
- **National team:** optional, strength derived from the domestic talent pool
  (population × sport popularity × development).

**Outputs:** standings, champions history, all-time tables, records, team profiles,
attendance.

### 4.9 Historical Events

**Event types:**
- **Scheduled:** elections, census years, national holidays, anniversaries.
- **Random:** natural disasters, epidemics, economic shocks, scientific breakthroughs,
  scandals, sporting upsets.
- **Triggered:** fire when conditions are met (e.g. `unemployment > 15% for 12 months`
  → mass protests; `debt_to_gdp > 120%` → debt crisis).
- **Player-initiated:** declare national holiday, host international games, rename a
  city, found a university.

**Event definition (data-driven):**

```yaml
id: epidemic_major
category: health
weight: 0.002              # base monthly probability
conditions:
  - "infrastructure.healthcare.coverage < 0.6"
weight_modifiers:
  - when: "cities.max_density > 8000"
    multiply: 2.0
duration_months: [6, 18]
effects:
  - target: demography.mortality_multiplier
    op: multiply
    value: 1.15
  - target: economy.productivity_shock
    op: add
    value: -0.02
choices:                    # optional player decision
  - id: lockdown
    label: "Impose strict quarantine"
    effects: [...]
  - id: ignore
    label: "Keep the country open"
    effects: [...]
chronicle: "{year}: A major epidemic struck {largest_city}."
```

**Mechanics:**
- Effects are **declarative** (target, operator, value, duration) so they can be applied,
  expired, and explained uniformly.
- Events can chain via follow-up events and flags.
- Events requiring a choice pause multi-year simulation and prompt the player
  (with an optional "auto-decide by government ideology" mode).
- Historical flags record milestones (first female head of government, first
  championship of a city, population passing 10 million) for the chronicle.

---

## 5. System Interactions

The main cross-system feedback loops:

```
 Education ──(human capital)──▶ Economy ──(tax revenue)──▶ Public budget
    ▲                              │                           │
    │                         (income, jobs)          (spending choices)
    │                              ▼                           ▼
 Public budget ◀──────────── Demography ◀──(health)── Infrastructure
                                   │                           ▲
                          (group composition)                  │
                                   ▼                           │
                               Politics ──(policy, stability)──┘
                                   │
                              (elections)
 Cities ◀──(migration)── Demography         Sports ◀──(city size, income)── Cities
```

Design rules for interactions:
- A system may **read** any state but **writes only its own slice**. Cross-system
  influence goes through read state or through modifiers registered by events/policies.
- All modifiers are stored in a **modifier registry** with source, target, value, and
  expiry, so the UI can display "Life expectancy −1.2 years: Epidemic (2041),
  +0.4 years: Hospital expansion program".

---

## 6. Data Model

### 6.1 State shape (sketch)

```
Nation
├── meta: name, founding_date, current_date, seed, ruleset_version
├── geography: regions[], terrain/climate traits
├── demography: cohorts[region][age][sex][education]
├── cities[]: id, name, region_id, population, traits, institutions[]
├── economy: sectors[], prices, fiscal, trade, labor
├── politics: constitution, offices[], parties[], politicians[], approval
├── elections: schedule[], history[]
├── education: per-region stats, universities[]
├── infrastructure: assets[region|city][category], projects[]
├── sports: sports[], leagues[], teams[], seasons[], athletes[]
├── events: active_effects[], flags{}, pending_choices[]
├── modifiers: registry[]
├── indicators: time series store
└── chronicle: entries[]
```

- Entities use stable IDs (`city:0012`, `party:0003`) that never get reused.
- Names come from configurable name-generation packs (language/culture flavors).

### 6.2 Indicator store

- Columnar time series keyed by indicator ID, one row per recorded tick.
- Monthly values kept for recent history; older history can be downsampled to
  quarterly/annual to keep saves small (configurable).
- Indicators are registered with metadata: unit, description, aggregation rule
  (sum/mean/last), and the system that owns them.

### 6.3 Persistence

- **Save file:** a single file containing a versioned snapshot plus the command log.
  Proposed: SQLite (queryable, robust, good for time series) or compressed JSON/MessagePack.
  **[Decision needed]**
- **Schema versioning:** each save stores `schema_version`; migrations upgrade older
  saves on load.
- **Autosave** every N simulated years and before any player decision.

---

## 7. Reports & Statistics

Reports are generated from state + indicators by a **report builder** that is separate
from the engine.

| Report | Contents | Cadence |
|---|---|---|
| **National Dashboard** | Headline indicators with sparklines and change vs. last year | Always available |
| **Census** | Population pyramid, regional breakdown, urbanization, city table, minorities | Every 10 years (configurable) + on demand |
| **Economic Survey** | GDP, growth, sectors, labor, inflation, fiscal balance, debt | Quarterly / annual |
| **Budget Report** | Revenue and spending breakdown, deficit, projections | Annual |
| **Election Report** | Results by district, seats, turnout, swing, maps/schematics | Per election |
| **Education Report** | Enrollment, attainment, literacy, university list | Annual |
| **Infrastructure Report** | Coverage, capacity vs. demand, projects | Annual |
| **Sports Almanac** | Standings, champions, records, team histories | Per season |
| **Yearbook** | Narrative summary of the year: key events, statistics, milestones | Annual |
| **History** | Full chronicle, filterable by category and period | Always available |
| **Custom Query** | Pick any indicators, regions, date range → chart/table | Always available |

Requirements:
- Every chart is backed by a table the player can view and **export** (CSV; JSON for
  full data).
- Comparative views: two time periods, two regions, or two save branches.
- Narrative text is template-based (no network dependency), e.g.
  *"Population grew 1.8% to 12.4 million, driven by natural increase in the north."*

---

## 8. Player Interaction

### 8.1 Nation creation

A guided wizard with sensible defaults and a "randomize" button for each step:

1. Name, flag colors, founding year, name/culture pack.
2. Geography: number of regions, climate, resources.
3. Starting population and development level (presets: frontier colony, agrarian
   state, industrializing nation, developed economy).
4. Cities: auto-generated from region settings, then editable.
5. Constitution: government type, legislature, electoral system.
6. Parties: generated from ideological spectrum or custom.
7. Sports: choose national sports and league structures.

### 8.2 Levers available to the player

- **Policy:** tax rates, spending allocations, immigration policy, compulsory schooling
  age, retirement age, child benefits, trade openness.
- **Projects:** infrastructure, new universities, stadiums, new cities.
- **Politics:** propose laws, call snap elections (if allowed), amend constitution.
- **Events:** respond to choice events.
- **Sandbox/god mode (optional toggle):** directly edit any value; saves flagged as
  modified.

Whether the player acts *as* the government (subject to elections) or as an
**omniscient steward** above politics is a mode choice. **[Decision needed]** —
recommendation: default to *steward* mode (player controls policy, but elections still
change which parties hold office and constrain what legislation passes), with an
optional *ruler* mode where losing power ends player control.

---

## 9. Technology

**[Decision needed]** — no stack has been chosen yet. Recommended baseline:

| Layer | Recommendation | Rationale |
|---|---|---|
| Engine | TypeScript (strict), pure functions over plain data | Same language for engine and UI; easy to test; runs in browser or Node |
| UI | Web app (React or Svelte) packaged as desktop via Tauri/Electron, or served locally | Charts and tables are the core UI; web tooling is strongest there |
| Charts | A mature charting library (e.g. ECharts, Vega-Lite, or Observable Plot) | Time series, pyramids, bar/stacked charts |
| Persistence | SQLite (via WASM in browser or native in desktop shell) | Queryable time series, single-file saves |
| Content | YAML/JSON data packs validated by JSON Schema | Moddability, easy diffing |
| Tests | Unit tests per system + golden-master simulation tests | Protects determinism and balancing |

Alternative: Rust engine (compiled to WASM) if performance becomes a bottleneck.
Decide after the M1 performance benchmark (§11).

---

## 10. Testing & Validation

- **Unit tests** for each system's formulas and each electoral system (seat allocation
  against known worked examples).
- **Determinism tests:** simulate 50 years twice with the same seed; states must be
  byte-identical.
- **Golden-master tests:** store summarized indicator outputs for fixed seeds; changes
  require an explicit update.
- **Plausibility checks:** automated assertions that indicators stay within realistic
  bounds (TFR 0.8–8, life expectancy 20–95, unemployment 0–50%, etc.) across many seeds.
- **Balance runs:** batch-simulate N seeds × M years headless and produce distribution
  reports, to catch runaway feedback loops (e.g. infinite growth or collapse).
- **Save migration tests:** load fixtures from every past schema version.

---

## 11. Milestones

| Milestone | Scope |
|---|---|
| **M0 — Skeleton** | Repo setup, engine/app/UI separation, tick loop, seeded RNG, save/load, indicator store, CLI batch runner |
| **M1 — People & Places** | Demography (cohort-component), regions, cities, migration, census report, population pyramid. Performance benchmark |
| **M2 — Economy** | Sectors, labor market, public finance, economic survey and budget reports |
| **M3 — Politics & Elections** | Constitution, parties, approval, FPTP + list PR, government formation, election report |
| **M4 — Education & Infrastructure** | Education pipeline, human capital link, infrastructure assets and projects |
| **M5 — Events & Chronicle** | Data-driven event engine, choices, modifier registry with explanations, yearbook |
| **M6 — Sports** | Sports/leagues/teams data model, match engine, seasons, almanac |
| **M7 — Creation Wizard & Polish** | Nation creation flow, dashboards, exports, comparative views, onboarding |
| **v1.x** | More electoral systems, named athletes, branching timelines UI, modding docs |

Each milestone ends with a playable build and updated golden-master tests.

---

## 12. Open Questions

1. **Tech stack** (§9) — confirm TypeScript/web or choose alternatives.
2. **Player role** (§8.2) — steward vs. ruler mode default.
3. **Geography depth** — schematic regions only, or a generated tile/hex map?
   Recommendation: schematic for v1, keep region adjacency data so a map can be added.
4. **Save format** (§6.3) — SQLite vs. compressed JSON/MessagePack.
5. **Demographic granularity** — include education and ethnicity dimensions in cohorts
   from the start (larger state, richer politics) or add later?
6. **International layer** — is there a world outside the nation (trade partners,
   neighbors, wars, Olympics) or only abstract "rest of world" parameters?
   Recommendation: abstract for v1.
7. **Historical start dates** — should technology/era constrain what's available
   (e.g. no airports in 1850)? Recommendation: an era system gating infrastructure types
   and sports.
8. **Calibration sources** — which reference datasets to use to sanity-check demographic
   and economic parameters (e.g. UN World Population Prospects, World Bank WDI, Penn World
   Table). Needs a licensing check before bundling any data.

---

## 13. Glossary

- **TFR** — Total Fertility Rate: average children per woman over a lifetime at current rates.
- **Cohort-component method** — demographic projection by aging cohorts and applying
  fertility, mortality, and migration rates.
- **TFP** — Total Factor Productivity: output not explained by capital and labor inputs.
- **D'Hondt / Sainte-Laguë** — highest-averages methods for allocating seats in
  proportional representation.
- **Gallagher index** — a measure of disproportionality between vote shares and seat shares.
- **Elo rating** — a rating system where expected results depend on rating difference.
- **Golden-master test** — a regression test comparing output against a stored, approved
  reference output.
