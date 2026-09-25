# Nationwright — Design Document

> Status: **Draft v0.2** · Last updated: 2026-09-25
>
> This document describes what Nationwright is, how the simulation works, and how the
> software is structured. Settled decisions are listed in §0. Remaining open
> questions are in §12 and should be settled before or during the milestone that depends
> on them.

---

## 0. Decisions Log

| # | Topic | Decision | Sections |
|---|---|---|---|
| D1 | Tech stack | **TypeScript** (strict) for engine, application, and UI | §9 |
| D2 | Player role | **Overseer.** The player sets policy and directs the nation, but elections still decide which parties hold office, and the legislature can block policy. The player never "loses" by being voted out | §8.2 |
| D3 | Persistence | **SQLite**, one file per save | §6.3 |
| D4 | Geography | **Schematic regions** for v1; no tile/hex map. Region adjacency is kept so a map can be added later | §4.2, §6.1 |
| D5 | International layer | **Other countries exist** and exert pull on the simulation (trade, migration, investment, diplomacy, conflict, sport) | §4.10 |
| D6 | Demographic depth | **Track everything:** cohorts carry age, sex, region, urban/rural, education, plus ethnicity, language, and religion shares | §4.1 |
| D7 | Start date | **Current year only.** Every nation starts in the real-world current year; there are no historical start dates and no era system | §3.1 |
| D8 | Reference data | **OpenFactBook** is the calibration and validation source, and seeds foreign countries | §10.1 |

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
- **Grounded.** Starting conditions and simulated outcomes are checked against
  real-world country data (OpenFactBook) so the nation behaves like a plausible
  present-day country.
- **Fast.** Simulating 100 years of a nation with ~50 cities and the full foreign-country
  roster should take seconds, not minutes.

### 1.2 Non-goals (for v1)

- Multiplayer or online features.
- Real-time gameplay or tactical warfare.
- Map-based geography. v1 uses schematic regions (D4).
- Historical start dates or era-based technology gating (D7).
- Simulating individual citizens (agent-based). The model is aggregate/cohort-based,
  with named individuals only where they matter (politicians, athletes, notable figures).
- Full-depth simulation of foreign countries. They run a lighter model (§4.10); only the
  player's nation gets every system.
- Predicting real-world politics. Foreign countries start from real data but diverge
  freely once simulation begins.

---

## 2. Core Concepts

| Concept | Description |
|---|---|
| **Nation** | The player's country. The main aggregate in a save. |
| **World** | The root aggregate: the player's nation plus all foreign countries and global conditions. |
| **Foreign country** | A real-world country seeded from OpenFactBook data and simulated with a lighter model (§4.10). |
| **Region** | Administrative subdivision (state/province). Contains cities and rural population. Every nation has at least one. |
| **City** | A settlement with its own population, economy share, infrastructure, and institutions (e.g. universities, sports teams). |
| **Cohort** | A population bucket keyed by region × urban/rural × age band × sex × education level, carrying ethnicity, language, and religion shares. The unit of demographic simulation. |
| **Reference snapshot** | A versioned copy of OpenFactBook data bundled with the game and used for seeding and validation (§10.1). |
| **Tick** | One simulation step. The base tick is **one month**. Larger steps are repeated ticks. |
| **System** | A self-contained simulation module (Demography, Economy, Politics…) that reads state and writes its own slice of state each tick. |
| **Indicator** | A named, recorded time series (e.g. `population.total`, `economy.gdp_real`, `education.literacy_rate`). |
| **Event** | Something that happens at a point in time — scheduled, random, triggered by conditions, or player-initiated — with effects on state. |
| **Chronicle** | The ordered log of events and notable changes; the nation's "history book." |
| **Report** | A generated document (table, chart, or narrative) derived from state and indicators. |

---

## 3. Simulation Architecture

### 3.1 Time model

- Base tick: **1 month**.
- **Start date = current year (D7).** At nation creation the calendar is set to January of
  the real-world current year, taken from the system clock. The start year is then stored
  in the save and never read from the clock again, which keeps replays deterministic.
  - The nation may have a fictional *founding date* in the past for flavor (shown in
    reports and anniversaries), but simulation always begins in the present.
  - All technology, infrastructure types, and sports are present-day. There is no era
    system.
  - The reference snapshot (§10.1) should match the start year. If the newest snapshot
    is older, the game warns and uses the nearest available year.
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
 4. World             foreign countries update; global prices, demand, and relations
 5. Demography        births, deaths, aging, migration (internal + international)
 6. Education         enrollment, graduation, attainment shifts in cohorts
 7. Economy           labor supply → output → incomes → prices → trade → public finance
 8. Infrastructure    capacity, utilization, construction progress, decay
 9. Cities            urbanization, city growth, service levels
10. Politics          approval, party support, stability, legislation progress
11. Elections         run any elections scheduled for this tick
12. Sports            fixtures, results, standings, season transitions
13. Events (post)     evaluate condition-triggered events from new state
14. Indicators        record time series for this tick
15. Validation        (debug/test builds) check indicators against reference bands
16. Chronicle         append notable changes and events
```

Ordering rationale: the world updates first, so foreign conditions (prices, demand,
migration pressure) are fixed for the tick. Demography produces the people that
education and the economy then use. The economy produces the revenue that
infrastructure and politics depend on. Politics reacts to the outcomes of everything
before it.

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

**State (D6: track everything):**

| Dimension | Values | Stored as |
|---|---|---|
| Region | 1…R | cohort key |
| Settlement | urban, rural | cohort key |
| Age | 5-year bands, 0–4 … 100+ (21 bands) | cohort key |
| Sex | female, male | cohort key |
| Education | none, primary, secondary, vocational, tertiary | cohort key |
| Ethnicity | player-defined groups | share vector per cohort |
| Language | player-defined groups | share vector per cohort |
| Religion | player-defined groups, incl. none | share vector per cohort |

- The key dimensions form a dense array: R × 2 × 21 × 2 × 5 = **420 cells per region**
  (8,400 for 20 regions). That is small enough to update every tick.
- Ethnicity, language, and religion are **share vectors** attached to each cell rather
  than further key dimensions. A full cross-product (e.g. 6 × 4 × 5 groups) would
  multiply state by 120 while adding little. The trade-off: correlations *between*
  ethnicity and religion inside one cell are not tracked. This is acceptable for v1;
  revisit if politics needs it.
- Additional tracked attributes per region: households and average household size,
  labor-force status by cohort (employed, unemployed, inactive, student, retired),
  foreign-born share by origin country (links to §4.10), disability/health-status index.

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
  - *International:* **bilateral** flows with each foreign country (§4.10), driven by
    wage and stability gaps, distance/proximity, shared language, existing diaspora size,
    and both sides' immigration policies. Refugee surges come from foreign crises.
- **Cultural change:** language shift toward the dominant/official language over
  generations (rate set by education and urbanization), religious-affiliation drift
  (secularization with income and education), and intermarriage blending ethnic shares in
  newborn cohorts.

**Outputs / indicators:** total population, growth rate, crude birth/death rates, TFR,
life expectancy (by sex), infant mortality, median age, dependency ratio, population
pyramid, urbanization rate, ethnic/linguistic/religious composition, foreign-born share
by origin, net migration by partner country, household statistics.

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
- **Trade & external sector:** exports and imports are tracked **per partner country**
  (§4.10), using a gravity-style model: partner GDP, proximity, tariffs/trade agreements,
  relations, and the exchange rate. Global commodity prices from the World system
  feed export revenue and import costs. Foreign direct investment adds to capital stock;
  remittances flow in or out with the diaspora.
- **Exchange rate:** a managed float against a world reference currency, driven by the
  trade balance, inflation gap, and interest-rate gap.
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
- **National team:** strength derived from the domestic talent pool
  (population × sport popularity × development).
- **International competition:** national teams play foreign countries (§4.10) in
  qualifiers and tournaments (world championships, continental cups, multi-sport
  games). Foreign team strength is derived the same way from their data. Hosting a
  tournament is a player-initiated event with infrastructure and tourism effects.

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
- Foreign countries are also event sources: foreign elections, recessions, wars,
  disasters, and pandemics can spill over through trade, migration, and relations
  (§4.10).

### 4.10 World & Foreign Countries

The player's nation sits inside a world of **real countries** (D5), seeded from the
OpenFactBook reference snapshot at the start year (§10.1). They are not background
decoration: they constantly pull on the nation's economy, population, politics, and
sport.

**Placement:** at creation the player picks a continent/subregion and 1–8 **neighbor**
countries. Neighbors get a land border (proximity = 1). Proximity to everyone else comes
from the chosen subregion and real capital coordinates.

**Foreign country state (lighter model):**

| Group | Fields (seeded from reference data) |
|---|---|
| Demography | population, growth rate, TFR, life expectancy, median age, net migration rate |
| Economy | GDP (PPP and nominal), GDP per capita, real growth, inflation, unemployment, sector shares, export/import totals, main export commodities, public debt |
| Politics | government type, stability index (derived), alignment on the same ideological axes as parties |
| Society | languages, religions, ethnic groups, literacy |
| Sport | popularity per sport (content data), national team strength (derived) |

Foreign countries advance each tick with **reduced-form trend models**: population
follows its own cohort-free growth path, GDP follows trend growth plus shocks, and
stability mean-reverts plus shocks. They do not run elections, cities, or sports leagues
in detail. Headline events (government change, recession, conflict, disaster) come from
the event engine.

**Bilateral relationship state (nation ↔ each foreign country):** relations score
(−100…+100), trade agreement tier, tariff level, visa/migration regime, alliance or
treaty memberships, diaspora sizes (both directions), trade flows, FDI stock.

**Channels of pull on the player's nation:**

| Channel | Mechanism | Affects |
|---|---|---|
| Trade | Gravity model per partner; partner recessions cut export demand | Economy §4.3 |
| Commodities | Global price indices driven by aggregate world demand and shocks | Economy, inflation, budget |
| Migration | Bilateral flows from wage and stability gaps, diaspora networks, refugee surges | Demography §4.1 |
| Capital | FDI and portfolio flows by relations and relative returns; sudden stops in crises | Economy, exchange rate |
| Ideas & culture | Neighbor/partner political alignment nudges party ideology preferences | Politics §4.4 |
| Security | Tensions with hostile neighbors raise defense spending pressure; conflict events | Budget, stability, events |
| Sport | International fixtures and tournaments | Sports §4.8 |
| Diplomacy | Player actions: sign/leave trade deals, set tariffs and visa policy, join blocs, send aid | Relations → all above |

**Pull strength** is weighted by `partner size × proximity × trade intensity`. Large,
close, deeply connected partners dominate, as they do in reality. A per-save
**"world influence" slider** (0.5×–2×) lets players dial overall foreign pull up or down.

**Performance:** at most ~260 entities (the snapshot filtered to populated countries and
territories; oceans and Antarctica excluded), each with a small fixed state, are cheap.
Bilateral state is one record per foreign country (nation ↔ foreign only; foreign ↔ foreign relations are not modelled in
v1, apart from coarse bloc membership).

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

                 ┌──────────── World / foreign countries ────────────┐
                 │ trade · commodities · capital · migration ·       │
                 │ ideas · security · sport                          │
                 └──┬──────────┬──────────┬──────────┬───────────────┘
                    ▼          ▼          ▼          ▼
                 Economy   Demography  Politics    Sports
                    │                     │
                    └──(policy, relations, tariffs, visas)──▶ World
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
World
├── meta: start_year, current_date, seed, ruleset_version, reference_snapshot_id
├── global: commodity_prices{}, world_demand, reference_currency
├── foreign_countries[]: id, iso3, name, subregion, capital_coords, state (§4.10)
├── relations[]: foreign_country_id, score, trade_tier, tariffs, visa_regime,
│               treaties[], diaspora_in, diaspora_out, trade_flows, fdi_stock
└── nation: Nation

Nation
├── meta: name, founding_date (flavor), neighbors[], subregion
├── geography: regions[] (with adjacency), terrain/climate traits
├── demography: cohorts[region][urban|rural][age][sex][education]
│               + shares{ethnicity[], language[], religion[]} per cell
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

**SQLite, one file per save (D3).**

- **Tables (sketch):**
  - `meta` — schema_version, seed, start_year, reference_snapshot_id, created_at
  - `snapshot` — the latest full engine state, serialized per system (one row per system,
    MessagePack blob) for fast load
  - `commands` — the append-only player command log (tick, type, payload) for replay and
    branching
  - `indicators` — `(indicator_id, tick, scope, value)` with an index on
    `(indicator_id, scope, tick)`; `scope` is `nation`, `region:N`, `city:N`, or
    `country:ISO3`
  - `entities` — cities, parties, politicians, teams, universities, foreign countries
    (queryable columns + JSON detail)
  - `elections`, `election_results`, `matches`, `standings` — high-volume history
  - `chronicle` — dated event log with category and references
  - `reference_*` — the OpenFactBook values used to seed this save (a frozen copy, so
    validation stays reproducible if the bundled snapshot is updated later)
- **Driver:** `better-sqlite3` for the Node/desktop build (synchronous, fast, simple
  transactions). A WASM SQLite build (e.g. the official SQLite WASM with OPFS) is used
  if a browser build is added. The application layer hides the driver behind a small
  storage interface; the engine never touches SQLite directly.
- **Writes:** each tick's indicators are batched in one transaction; the snapshot is
  rewritten on save/autosave, not every tick.
- **Schema versioning:** `meta.schema_version` + ordered migration scripts run on load.
- **Autosave** every N simulated years and before any player decision.
- **Branching:** "branch from here" copies the file (SQLite `VACUUM INTO`) and truncates
  the command log at the branch point.

---

## 7. Reports & Statistics

Reports are generated from state + indicators by a **report builder** that is separate
from the engine.

| Report | Contents | Cadence |
|---|---|---|
| **National Dashboard** | Headline indicators with sparklines and change vs. last year | Always available |
| **Census** | Population pyramid, regional breakdown, urbanization, city table, ethnicity/language/religion, education attainment, foreign-born, households | Every 10 years (configurable) + on demand |
| **Economic Survey** | GDP, growth, sectors, labor, inflation, fiscal balance, debt | Quarterly / annual |
| **Budget Report** | Revenue and spending breakdown, deficit, projections | Annual |
| **Election Report** | Results by district, seats, turnout, swing, maps/schematics | Per election |
| **Education Report** | Enrollment, attainment, literacy, university list | Annual |
| **Infrastructure Report** | Coverage, capacity vs. demand, projects | Annual |
| **Sports Almanac** | Standings, champions, records, team histories | Per season |
| **Foreign Relations** | Relations table, trade by partner, migration by origin/destination, treaties, diaspora | Annual + on demand |
| **World Comparison** | The nation ranked against all foreign countries on any indicator, and its percentile against the reference snapshot | Always available |
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

1. Name, flag colors, flavor founding date, name/culture pack. The simulation start date
   is fixed to the current year (D7) and is shown but not editable.
2. **Place in the world:** continent/subregion and neighbor countries (§4.10). The wizard
   shows the neighbors' reference stats.
3. Geography: number of regions, adjacency, climate, resources.
4. **Starting profile:** population size and development level. Presets are
   **templates drawn from the reference snapshot**, e.g. "like a typical
   upper-middle-income country in this subregion" (the median of matching countries).
   Every starting value can be edited afterwards, and each shows its percentile among
   real countries.
5. Society: ethnic, linguistic, and religious groups and their regional distribution
   (defaults suggested from the chosen neighbors' reference data).
6. Cities: auto-generated from region settings, then editable.
7. Constitution: government type, legislature, electoral system.
8. Parties: generated from ideological spectrum or custom.
9. Sports: choose national sports and league structures (defaults suggested from
   subregion popularity).
10. **Plausibility review:** any starting indicator outside the real-world range is
    flagged before the game starts (§10.1). The player may proceed anyway.

### 8.2 Player role: the Overseer (D2)

The player is an **overseer**: a permanent guiding hand above day-to-day politics, not a
character inside it. Concretely:

- The player **sets the policy agenda** and directs projects, diplomacy, and event
  responses.
- **Elections still happen and matter.** They decide which parties hold office, and the
  governing coalition's ideology determines how easily the player's agenda passes.
- **Institutions constrain the overseer:**
  - Laws need legislative passage (§4.4). A hostile legislature can block, water down,
    or delay proposals.
  - Constitutional changes follow amendment rules (supermajority, referendum).
  - Pushing policy far from the governing coalition's ideology costs approval and
    stability.
  - Courts (per judicial independence) can strike down laws that violate the
    constitution.
- **There is no game over.** The player keeps control whoever wins. Failure shows up in
  outcomes (recession, emigration, unrest), not in losing the save.
- **Autopilot:** during multi-year runs, the sitting government can make routine
  decisions and answer choice events according to its ideology. The player can override
  them at any pause.

### 8.3 Levers available to the player

- **Policy:** tax rates, spending allocations, immigration policy, compulsory schooling
  age, retirement age, child benefits, minimum wage, healthcare model.
- **Foreign policy:** tariffs, trade agreements, visa regimes, bloc membership, aid,
  ambassadorial stance (improve/worsen relations) per country.
- **Projects:** infrastructure, new universities, stadiums, new cities.
- **Politics:** propose laws, call snap elections (if the constitution allows), propose
  constitutional amendments.
- **Events:** respond to choice events.
- **Sandbox mode (optional toggle):** directly edit any value; saves are flagged as
  modified and excluded from validation statistics.

---

## 9. Technology

**TypeScript throughout (D1).** Settled: language and database. The rest of the table is
recommended and can change without affecting the architecture.

| Layer | Choice | Status | Rationale |
|---|---|---|---|
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess` | Settled | One language for engine, app, UI, and tooling |
| Engine | Pure TS over plain data; typed arrays (`Float64Array`) for cohort grids | Settled | Deterministic, fast, serializable |
| Persistence | SQLite via `better-sqlite3` behind a storage interface | Settled | D3; see §6.3 |
| Runtime | Node.js (current LTS) for engine, CLI, and data tooling | Recommended | Native SQLite driver, headless batch runs |
| UI | React + Vite, packaged as a desktop app with Electron | Recommended | Charts/tables are the core UI; Electron hosts Node, so `better-sqlite3` works unchanged |
| Charts | ECharts or Observable Plot | Recommended | Time series, pyramids, stacked bars |
| Content | YAML data packs validated with JSON Schema (via `zod` types) | Recommended | Moddability, typed at load |
| Tests | Vitest; golden-master and property-based tests (`fast-check`) | Recommended | Determinism and balance |
| Repo layout | Monorepo workspaces: `packages/engine`, `packages/app`, `packages/ui`, `packages/cli`, `packages/reference-data`, `content/` | Recommended | Enforces engine/UI separation |

Determinism notes for TypeScript:
- No `Math.random()` in the engine; lint rule bans it along with `Date.now()` and
  `new Date()` outside the application layer.
- Iterate over arrays or sorted keys, never over `Object.keys` of maps built in
  non-deterministic order.
- Integer-valued quantities (people, seats) are rounded with a documented rule
  (largest-remainder) so totals are conserved.

Performance fallback: if the M1 benchmark misses the target, hot loops (cohort update,
match simulation) can move to a Rust/WASM module behind the same TypeScript interface.

---

## 10. Testing & Validation

- **Unit tests** for each system's formulas and each electoral system (seat allocation
  against known worked examples).
- **Determinism tests:** simulate 50 years twice with the same seed; states must be
  byte-identical.
- **Golden-master tests:** store summarized indicator outputs for fixed seeds; changes
  require an explicit update.
- **Plausibility checks:** automated assertions that indicators stay inside the
  real-world bands derived from OpenFactBook (§10.1) across many seeds.
- **Balance runs:** batch-simulate N seeds × M years headless and produce distribution
  reports, to catch runaway feedback loops (e.g. infinite growth or collapse).
- **Foreign-model backtest:** starting from the snapshot, foreign-country trend models
  should not drift outside the real-world bands within 20 simulated years without an
  event explaining it.
- **Save migration tests:** load fixtures from every past schema version.

### 10.1 Reference data: OpenFactBook (D8)

[OpenFactBook](https://openfactbook.org/) is a free, community-maintained successor to
the retired CIA World Factbook. It covers 260+ countries and territories (geography,
demographics, government, economy, infrastructure), offers a free JSON API, and says it
draws on the CIA World Factbook, World Bank Open Data, and the REST Countries API.

**Uses in Nationwright:**

1. **Seeding foreign countries** (§4.10) at the start year.
2. **Starting-profile templates** in the creation wizard (§8.1).
3. **Validation bands** for the player's nation, at creation and during simulation.
4. **Parameter calibration**: fitting the relationships in §4 (e.g. TFR vs. income and
   female education, life expectancy vs. health spending, urbanization vs. GDP per
   capita) to the cross-section of real countries.

**Current year only (D7):** for each field, use the **most recent value** in the
snapshot. Factbook-style data mixes estimate years across fields (e.g. population
"2025 est.", GDP "2023 est."). The ingest therefore stores each value's **estimate
year**. Values older than a configurable age (default: 3 years before the start year)
are flagged. The game never uses historical series, only the latest cross-section.

**Ingest pipeline (`packages/reference-data`):**

```
fetch (OpenFactBook JSON API)
  → raw/  (verbatim JSON, committed, dated)
  → parse (text fields like "8,997,000 (2024 est.)" → value + unit + est_year)
  → normalize (units, currencies to a common base, ISO 3166 codes, names)
  → validate (schema, ranges, missing-field report)
  → snapshot/<YYYY-MM-DD>.sqlite + manifest.json (source URLs, fetch date, field coverage)
```

- The pipeline runs **offline as a developer tool**, never at game runtime. The game
  bundles the snapshot, so it works without network access and runs are reproducible.
- Each save copies the reference rows it used (§6.3), so validation results don't change
  when the bundled snapshot is updated.
- Refresh: a scripted re-fetch at least yearly, reviewed as a normal code change with a
  diff report of changed values.
- **Fallback source:** [factbook/factbook.json](https://github.com/factbook/factbook.json)
  on GitHub mirrors the Factbook country profiles as JSON (`region/code.json`, e.g.
  `europe/au.json`). It is dedicated to the public domain and was auto-updated weekly
  from the CIA source. Use it if the API is unavailable. The parser should handle both
  shapes.

**Validation bands:** for each indicator mapped to a reference field, compute the
distribution across real countries. Optionally narrow it to the nation's development
tier or subregion.

| Band | Definition | Meaning when outside |
|---|---|---|
| Typical | 10th–90th percentile | Normal |
| Plausible | min–max of real countries | Unusual: shown in yellow in reports |
| Implausible | outside real min–max by > 10% | Flagged: warning at creation; logged as a balance bug in test runs |

Initial mapped indicators: population, growth rate, birth/death rates, TFR, life
expectancy, infant mortality, median age, urbanization, literacy, GDP per capita (PPP),
real GDP growth, sector shares, unemployment, inflation, public debt % GDP, exports/
imports % GDP, electricity access, internet users per 100, roads/rail per area,
ethnic/religious fractionalization.

**Licensing & attribution:** OpenFactBook describes its data as free and public domain,
and factbook.json is public domain. OpenFactBook also aggregates World Bank data (World
Bank Open Data is generally CC BY 4.0) and REST Countries. **Before bundling, verify the
license of each field by its upstream source** and include an attribution screen listing
OpenFactBook, the CIA World Factbook, the World Bank, and REST Countries as applicable.

**Unverified (to confirm in M0):** the exact API endpoints, response schema, rate limits,
and field names. OpenFactBook was not reachable from the environment this draft was
written in. The ingest should keep all source-specific details in one adapter module.

---

## 11. Milestones

| Milestone | Scope |
|---|---|
| **M0 — Skeleton** | TS monorepo, engine/app/UI separation, tick loop, seeded RNG, SQLite save/load, indicator store, CLI batch runner. **Reference-data pipeline:** confirm OpenFactBook API/licensing, first snapshot, validation-band computation |
| **M1 — People & Places** | Demography (full cohort grid + culture shares), regions with adjacency, cities, internal migration, census report, population pyramid, validation against bands. Performance benchmark |
| **M2 — Economy & World** | Sectors, labor market, public finance; foreign countries seeded from the snapshot, trade/commodities/migration/capital channels, relations; economic survey, budget, foreign relations, and world comparison reports |
| **M3 — Politics & Elections** | Constitution, parties, approval, FPTP + list PR, government formation, election report |
| **M4 — Education & Infrastructure** | Education pipeline, human capital link, infrastructure assets and projects |
| **M5 — Events & Chronicle** | Data-driven event engine, choices, modifier registry with explanations, yearbook |
| **M6 — Sports** | Sports/leagues/teams data model, match engine, seasons, international competitions, almanac |
| **M7 — Creation Wizard & Polish** | Nation creation flow (world placement, reference templates, plausibility review), overseer autopilot, dashboards, exports, comparative views, attribution screen, onboarding |
| **v1.x** | More electoral systems, named athletes, branching timelines UI, modding docs |

Each milestone ends with a playable build and updated golden-master tests.

---

## 12. Open Questions

Questions from v0.1 were resolved as D1–D8 (§0). Remaining:

1. **UI shell** (§9) — Electron (recommended; runs `better-sqlite3` natively) vs. Tauri
   (smaller binary, but SQLite would move to Rust or WASM).
2. **Foreign country depth** (§4.10) — are the reduced-form models enough, or should
   major neighbors get fuller simulation (e.g. their own elections)?
   Recommendation: reduced-form for v1; neighbors get elections in v1.x.
3. **Foreign ↔ foreign relations** — model blocs only (v1 recommendation), or full
   pairwise relations?
4. **Conflict** — how far do wars go? Recommendation: abstract conflict events
   (economic, casualty, migration, and stability effects) without military simulation.
5. **Start-year vs. snapshot mismatch** (§3.1) — when the start year is newer than the
   bundled snapshot, use the snapshot values as-is (recommended) or project them forward
   by trend?
6. **Culture share correlations** (§4.1) — are independent share vectors enough, or does
   politics need joint ethnicity × religion distributions?
7. **Reference licensing** (§10.1) — confirm per-field licenses and attribution wording
   once the OpenFactBook API is inspected.

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
- **Gravity model** — trade or migration between two places modelled as proportional to
  their sizes and inversely related to distance/friction.
- **Validation band** — the real-world range of an indicator across countries, computed
  from the reference snapshot.
- **Overseer** — the player's role: sets direction above politics, constrained by
  institutions, never removed from power.
