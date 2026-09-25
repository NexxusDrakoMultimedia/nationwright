# Nationwright — Design Document

> Status: **Draft v0.9** · Last updated: 2026-09-25
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
| D4 | Geography | **Procedurally generated map in v1** (Voronoi cells with terrain, climate, and rivers). Regions, provinces, borders, and adjacency all come from the map. *(Replaces v0.2's "schematic regions only".)* | §4.12 |
| D5 | International layer | **Other countries exist** and exert pull on the simulation (trade, migration, investment, diplomacy, conflict, sport) | §4.10 |
| D6 | Demographic depth | **Track everything:** cohorts carry age, sex, region, urban/rural, education, plus a joint ethnicity × religion × language distribution (D14) | §4.1 |
| D7 | Start date | **Current year only.** Every nation starts in the real-world current year; there are no historical start dates and no era system | §3.1 |
| D8 | Reference data | **factbook.json** ([github.com/factbook/factbook.json](https://github.com/factbook/factbook.json), the public-domain World Factbook data used by OpenFactBook) is the calibration and validation source, used directly. It never appears in play directly: it drives procedural generation (D12) | §10.1 |
| D9 | UI shell | **Electron** (React + Vite renderer). The engine and `better-sqlite3` run in the main/utility process | §9 |
| D10 | Wars & foreign relations | **Deep.** Full pairwise relations among all countries; foreign countries have governments, leaders, elections, and militaries and act on their own; wars are simulated at the operational level (forces, fronts, occupation, casualties, peace terms) | §4.10, §4.11 |
| D11 | Stale reference data | **Project forward.** Each reference value is projected from its estimate year to the start year | §10.1 |
| D12 | World composition | **Completely fictional, procedurally generated world.** Every country (foreign and the player's) is invented: names, geography, borders, blocs, leaders. No real country appears in play. The factbook.json dataset supplies the **guiding variables**, the statistical distributions and correlations that generated nations are sampled from | §4.12, §10.1 |
| D13 | World seed | **Random 64-bit seed** (stored as 8 bytes plus unpadded base64url, 11 characters). It is the only randomness input for world generation and simulation. **Internal only (D23):** never shown to or entered by the player | §3.3 |
| D14 | Ethnicity × religion × language | **Tracked jointly** per cohort cell (one joint distribution, not independent vectors). How the three associate is **randomized** per country from the world seed, within the group counts and shares the guiding variables set | §4.1, §4.12.3 |
| D15 | Nuclear weapons | **Banned.** They do not exist in the world. There are no arsenals, deterrence, or use, and warfare is conventional only. Nuclear *energy* remains | §4.11 |
| D16 | Civilian harm | *(Superseded by D21.)* Was: an outcome, never an action; no option targets civilians | §4.11.3 |
| D17 | World size | **No hard limit.** The number of countries has a default (~195) and a recommended range (20–250) | §4.12 |
| D18 | Backstory | **Keep the burn-in:** a ~30-year diplomacy-and-war pre-run generates history before the start date | §4.12.4 |
| D19 | Performance targets | **None for now.** No target hardware and no world-creation or simulation time budget; performance is measured and reported, not gated | §1.1, §9 |
| D20 | License | **GPLv3 or later** (`GPL-3.0-or-later`), copyright Nexxus Drako Multimedia; full text in `LICENSE`. Dependencies must be GPLv3-compatible | §9 |
| D21 | Civilian targeting | **Allowed, for the player and the AI alike, with no opt-in setting.** Wars can deliberately target civilians through aggregate war policies (strike targeting, blockade scope, occupation policy). Civilian harm is also still an incidental outcome of fighting. Both carry diplomatic, legal, political, and demographic consequences. *(Replaces D16.)* | §4.11.3 |
| D22 | Fog of war & intelligence | **Foreign countries are seen through intelligence estimates,** not true values. Every country (the player's included) has an intelligence service; knowledge of each other country depends on collection, access, and the target's openness and counterintelligence. The foreign-policy AI decides on its own estimates too. Covert operations exist and can be exposed | §4.13 |
| D23 | Visible seeds | **None.** Seeds stay internal (determinism, replay, branching, tests). The player never sees, copies, or enters one; every new world is random, and a world is shared by sharing its save file. Generator and guiding-model changes alter what a seed produces, so seeds were never a durable way to share worlds | §3.3, §4.12, §8 |

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

The summary below is expanded, with success criteria, in [GOALS.md](GOALS.md).

- **Coherent systems.** Population, economy, education, politics, and infrastructure feed
  into each other through explicit, documented relationships.
- **Deterministic and reproducible.** Same seed + same player inputs = same history.
- **Explainable.** Every major indicator can be traced back to its drivers.
- **Rich reporting.** Census-style tables, time series, league tables, election results,
  and annual yearbooks are first-class output, not afterthoughts.
- **Moddable data.** Event definitions, name lists, sports, party ideologies, and tuning
  constants live in data files, not code.
- **Fictional but grounded.** Every nation in the world is procedurally generated, and
  its statistics are sampled from real-world country data (factbook.json). A generated
  world should be statistically indistinguishable from the real one at the start year,
  and simulated outcomes are checked against the same data.
- **Efficient.** The simulation should scale smoothly with world size and model detail.
  There is **no fixed hardware or timing target** at this stage (D19). Performance is
  measured and reported from M0 onward so targets can be set later from real numbers.

### 1.2 Non-goals (for v1)

- Multiplayer or online features.
- Real-time gameplay or **tactical** warfare (individual battles, unit micromanagement).
  Wars *are* simulated in depth, at the operational level, in monthly steps (§4.11).
- Tile/hex-based movement or map-level unit control. The v1 map (D4) is a generated
  geography and an information display, not a game board.
- Historical start dates or era-based technology gating (D7).
- Simulating individual citizens (agent-based). The model is aggregate/cohort-based,
  with named individuals only where they matter (politicians, athletes, notable figures).
- Full-depth *domestic* simulation of foreign countries (cohorts, cities, leagues,
  education pipelines). They get a mid-depth model: full politics, diplomacy, and
  military, but reduced-form demography and economy (§4.10).
- Real countries, real people, or real-world geopolitics. Real data shapes the
  *distributions* nations are drawn from (D12), never their identities.

---

## 2. Core Concepts

| Concept | Description |
|---|---|
| **Nation** | The player's country. The main aggregate in a save. |
| **World** | The root aggregate: the player's nation plus all foreign countries and global conditions. |
| **Foreign country** | A procedurally generated fictional country (§4.12). It has its own government, diplomacy, and military, and reduced-form demography and economy (§4.10). |
| **Guiding variables** | The statistical model fitted to factbook.json data (marginal distributions, correlations, category frequencies) that the world generator samples from (§4.12, §10.1). |
| **World seed** | A random 64-bit value, stored as 11 characters of base64url (e.g. `q3Zk1d0XbAc`), that determines the generated world and all simulation randomness (§3.3). Internal only: the player never sees it (D23). |
| **Province** | A war-relevant subdivision of a foreign country (border zones, heartland, capital) used for fronts and occupation (§4.11). The player's regions play the same role at home. |
| **Front** | An active line of conflict between two belligerents across adjacent regions/provinces (§4.11). |
| **Region** | Administrative subdivision (state/province). Contains cities and rural population. Every nation has at least one. |
| **City** | A settlement with its own population, economy share, infrastructure, and institutions (e.g. universities, sports teams). |
| **Cohort** | A population bucket keyed by region × urban/rural × age band × sex × education level, carrying ethnicity, language, and religion shares. The unit of demographic simulation. |
| **Reference snapshot** | A versioned copy of the factbook.json data projected to the start year. Used to fit the guiding variables and validation bands, never placed in the world directly (§10.1). |
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
  - Reference values older than the start year are **projected forward** to it (D11,
    §10.1), so the world always starts at the current year.
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
 4. World             foreign countries' economies, demography, politics, elections;
                      global prices and demand
 5. Intelligence      collection coverage, covert operations and exposure,
                      refreshed estimates of every observed country
 6. Diplomacy         AI foreign-policy decisions, pairwise relations, treaties,
                      sanctions, alliance calls, war declarations and peace deals
 7. War               resolve every active front: combat, supply, occupation,
                      casualties, damage, displacement, war score
 8. Demography        births, deaths (incl. war casualties), aging, migration
                      (internal, international, refugees)
 9. Education         enrollment, graduation, attainment shifts in cohorts
10. Economy           labor supply → output → incomes → prices → trade → public finance
11. Defense           recruitment, conscription, procurement, readiness, force upkeep
12. Infrastructure    capacity, utilization, construction/repair, decay, war damage
13. Cities            urbanization, city growth, service levels
14. Politics          approval, war weariness, party support, stability, legislation
15. Elections         run any elections scheduled for this tick
16. Sports            fixtures, results, standings, season transitions
17. Events (post)     evaluate condition-triggered events from new state
18. Indicators        record time series for this tick
19. Validation        (debug/test builds) check indicators against reference bands
20. Chronicle         append notable changes and events
```

Ordering rationale: the world and diplomacy update first, so foreign conditions and the
set of active wars are fixed for the tick. Intelligence runs between them, so every
government's diplomatic decisions use estimates of the world as it stands this tick. War resolves next, so its casualties,
displacement, and damage feed straight into demography, the economy, and
infrastructure. Demography produces the people that education and the economy then use.
The economy funds defense, infrastructure, and politics. Politics reacts to the outcomes
of everything before it, including war weariness.

### 3.3 Determinism

#### World seed (D13)

- Every world is based on one **64-bit seed**, drawn from a cryptographically secure
  source (`crypto.getRandomValues`) when a new world is created. It is the only
  randomness input to the engine.
- **Encoding:** the seed's 8 bytes (big-endian) are written as **unpadded base64url**
  (RFC 4648 §5): 11 characters from `A–Z a–z 0–9 - _`, e.g. `q3Zk1d0XbAc`. This form is
  safe in file names and save metadata.
  - 11 characters carry 66 bits, so the last character holds only 4 seed bits. Its low
    2 bits must be zero: it must be one of `AEIMQUYcgkosw048`. The parser **rejects**
    non-canonical strings instead of silently normalizing them, so every seed has
    exactly one spelling.
  - The parser also accepts standard base64 (`+` `/`) and a trailing `=`, and converts
    them to the canonical base64url form before validation.
  - Internally the seed is held as a `bigint` (or two `uint32` halves in hot code) and
    stored in SQLite as an 8-byte BLOB, with the canonical string alongside.
- **Not player-facing (D23):** no screen, report, CLI command, or export shows the seed,
  and "New world" has no seed field: every new world is random. A world is shared by
  sharing its save file, which stores the generated world itself (§8), so it opens the
  same on any version.
- **Reproducibility contract (internal):** seed + generator version + guiding-variables
  version + generator settings (§4.12) ⇒ an identical world. A save records all four.
  Tests, the validation script, replay, and branching rely on it.

#### PRNG and streams

- Generator: **xoshiro256\*\*** with its 256-bit state expanded from the 64-bit seed
  by **SplitMix64**, the expansion the algorithm's authors recommend. It is implemented
  with 32-bit integer operations for speed; `bigint` is used only at the boundaries.
- **Domain separation:** each consumer derives its own stream as
  `SplitMix64(seed ⊕ hash(domain)) → xoshiro state`, where `domain` is a string such as
  `worldgen/elevation`, `worldgen/countries`, `sim/demography@tick:123`,
  `sim/war/front:45@tick:123`, or `sim/intel/estimate:12>34/military@period:7`
  (§4.13). `hash` is a fixed 64-bit string hash (e.g. FNV-1a 64), pinned in the spec.
  - Adding randomness to one system therefore never shifts outcomes in another.
  - Changing the war model never changes the generated map.
- No wall-clock time, unordered map iteration, or floating-point non-determinism in the
  engine (avoid parallel reductions whose order can vary).
- A save stores the world seed plus a log of player inputs, which enables **replay** and
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
| Ethnicity × Religion × Language | generated/player-defined groups (religion incl. none) | **joint** distribution per cohort cell |

- The key dimensions form a dense array: R × 2 × 21 × 2 × 5 = **420 cells per region**
  (8,400 for 20 regions). That is small enough to update every tick.
- **Ethnicity, religion, and language are tracked jointly (D14).** Each cell carries an
  E × R × L joint distribution, so questions like "how many Arvani-speaking members of
  ethnic group A practise religion B, aged 20–24, in region 3, with tertiary education"
  always have an answer.
  - **Sparse storage.** A dense E × R × L tensor (e.g. 8 × 6 × 6 = 288 shares) in every
    cell would be large. Instead, each nation keeps a **combination table**: the
    (ethnicity, religion, language) triples that actually occur, typically a few dozen.
    Each cell stores shares only over that table (`Float32Array`, cells × combinations).
    Triples that fall below a population threshold are pruned and folded into their
    nearest neighbor. New triples are added when conversion, language shift, or
    migration creates them.
  - **Updates:**
    - births: children inherit their parents' triple, blended by intermarriage rates,
      with language inherited mostly from the household;
    - conversion and secularization: mass moves along the religion axis, at rates set by
      education, urbanization, and age;
    - language shift: mass moves along the language axis toward the dominant or
      official language, faster with schooling and urbanization and slower in
      concentrated communities;
    - migration: migrants arrive with the origin country's joint distribution.
  - Party affinity (§4.4), unrest, and conflict read the joint distribution, so
    ethnic, religious, and linguistic cleavages, and their overlaps, can drive politics
    and war (co-ethnic, co-religionist, or co-linguistic claims, §4.11.2).
  - **Initial associations are randomized (§4.12.3).** The world seed decides how
    strongly each ethnicity lines up with each religion and language in each country.
    In some countries the three nearly coincide; in others they cut across each other.
    Only the numbers of groups and their overall shares are guided by the Factbook.
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
- **Cultural change:** operates on the joint distribution described above (language
  shift, religious drift, and intermarriage).

**Implementation (M2, in progress):** the engine's `demography/` module. Mortality is a
Siler hazard calibrated to life expectancy (by sex) and infant mortality; fertility blends
an early and a late age schedule, scaled to the TFR; the starting age structure is a
stable population rescaled to the 0–14 and 65+ shares; education comes from expected
years of schooling, with an age gradient fitted to literacy. Settlement and education
multipliers are normalized so the starting national rates equal the country's
statistics. Cohort counts are real numbers. Until the creation wizard (M9), the player's
country is drawn at random, and net international migration runs at the country's
sampled rate until the bilateral model (M3). Other systems adjust demography through the
modifier targets `demography.fertility_multiplier`, `mortality_multiplier`,
`schooling_years`, `urbanization_rate`, `net_migration_rate`,
`secularization_multiplier`, and `language_shift_multiplier`.

The joint culture distribution is stored as people per combination per cohort cell
(`culture[k][cell]`, summing to the cohort count), so every flow moves culture with the
people; religion −1 means none. At the start, each combination is concentrated in some
regions (random log-normal weights, balanced by iterative proportional fitting against
regional populations and national shares). Monthly: a share of births (8% urban, 4%
rural) take their ethnicity from local men aged 20–44; people 15+ secularize at a
rate that rises with education and in cities; speakers of other languages shift to the
most spoken one, fastest among the young and schooled, slowed by their language's
regional share. Combinations below 0.01% of the population are folded into their nearest
neighbour each December. Conversion between faiths is not modelled yet.

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

The player's nation sits inside a world of **fictional, procedurally generated
countries** (D5, D12). Section 4.12 describes how they are generated. They are not
background decoration: they constantly pull on the nation's economy, population,
politics, and sport.

**Placement:** the world generator builds continents, subregions, and a border graph
(§4.12.2). At creation the player picks a slot in that world: a continent/subregion and
a coastal or landlocked position. That slot fixes the player's neighbors. The player can
reroll the world or the slot. Proximity between any two countries comes from the
generated capital coordinates.

#### 4.10.1 Foreign country model (mid-depth, D10)

| Group | Fields | Depth |
|---|---|---|
| Demography | population, growth rate, TFR, life expectancy, median age, net migration, age structure (3 broad bands: 0–14, 15–64, 65+) | Reduced-form |
| Economy | GDP (PPP and nominal), GDP per capita, real growth, inflation, unemployment, sector shares, exports/imports, main export commodities, public debt, defense spending % GDP | Reduced-form |
| Government | government type, head of state and head of government (named, generated), ruling party/coalition ideology, legislature balance, term schedule, stability, legitimacy | **Full** |
| Elections | scheduled elections by government type; outcomes from economy, stability, incumbency, and war | **Full** (aggregate vote model, no districts) |
| Foreign policy | leader traits (aggression, risk tolerance, ruthlessness), strategic goals, threat perceptions, alliance commitments | **Full** |
| Military | see §4.11 | **Full** |
| Provinces | 3–6 generated provinces (capital, heartland, border zones facing each neighbor), each with population and economic share | For war only |
| Society | languages, religions, ethnic groups, literacy | Static shares with slow drift |
| Sport | popularity per sport (content data), national team strength (derived) | Reduced-form |

All fields are **generated** (§4.12). Numeric fields are sampled from the guiding
variables, and leaders, parties, and leader traits come from government type and the
country's culture pack. No real country or real person is depicted.

**Foreign government change:** elections, term limits, coups (low legitimacy +
military discontent), revolutions (low stability + economic crisis), or defeat in war.
A new government brings new ideology and goals, which reshapes that country's foreign
policy.

#### 4.10.2 Relations (full pairwise)

A **relations matrix** covers every pair of countries, the player's nation included:

| Field | Meaning |
|---|---|
| `score` | −100…+100 overall disposition |
| `trust` | Reliability memory: broken treaties and betrayals lower it slowly and recover slowly |
| `threat` | Perceived military threat (capability × hostility × proximity) |
| `trade_tier` | none, MFN, FTA, customs union, single market |
| `tariffs`, `sanctions` | By direction; sanctions can be targeted (sectors, finance, arms) |
| `visa_regime` | Closed, visa required, visa-free, free movement |
| `treaties[]` | Defense pact, non-aggression, arms control, basing rights, border treaty, intelligence sharing |
| `claims[]` | Territorial claims on specific regions/provinces, with origin and strength |
| `diaspora`, `trade_flows`, `fdi_stock` | Economic and human ties (both directions) |
| `intel` | Directed: the observer's collection effort, coverage, and active covert operations against the target (§4.13) |
| `history[]` | Log of wars, treaties, incidents: feeds `trust` and narrative |

**Score drift** each tick = f(ideological distance of governments, trade dependence,
shared bloc membership, shared rivals ("enemy of my enemy"), border disputes, recent
incidents, diaspora ties, trust) with mean reversion toward a structural baseline.

**Blocs & alliances:** data-defined organizations (military alliances, trade blocs,
a global assembly) with membership rules, obligations (mutual defense, common tariff,
free movement), and votes on resolutions (sanctions, condemnations, peacekeeping).
Blocs are generated with the world (§4.12.4). Membership follows proximity, ideology, and
development, and the number and size of blocs are guided by real-world bloc statistics.

#### 4.10.3 Foreign-policy AI

Each foreign government chooses actions monthly using **utility scoring**:

1. Evaluate state: threats, opportunities (weak neighbors with claims), economic needs,
   domestic pressure (approval, upcoming election), and alliance obligations. Everything
   about *other* countries is read from the government's own intelligence estimates
   (§4.13), so a poorly informed government can misjudge a rival and start, or avoid,
   the wrong war.
2. Generate candidate actions: improve/worsen relations, propose or leave treaties, set
   tariffs, impose or lift sanctions, arms buildup, join or leave blocs, issue
   ultimatums, declare war, offer or accept peace, send aid, host or boycott events, set
   intelligence priorities, launch covert operations, and set war policies (§4.11.3).
3. Score each action with the leader's traits and the government's goals; add seeded
   noise; take the best action above a threshold (at most K actions per month).

The same AI can play the **player's nation on autopilot** (§8.2), using the governing
coalition's ideology as its goals.

**Salience tiers (performance):** pairs involving neighbors, top-10 trade partners,
allies, rivals, great powers, or active disputes update **monthly**. All other pairs
update **annually**. That keeps the matrix cheap at the default world size (~19,000
pairs for 195 countries). The matrix grows with n², and salience tiers keep the monthly
work roughly linear in n.

**Channels of pull on the player's nation:**

| Channel | Mechanism | Affects |
|---|---|---|
| Trade | Gravity model per partner; partner recessions cut export demand | Economy §4.3 |
| Commodities | Global price indices driven by aggregate world demand and shocks | Economy, inflation, budget |
| Migration | Bilateral flows from wage and stability gaps, diaspora networks, refugee surges | Demography §4.1 |
| Capital | FDI and portfolio flows by relations and relative returns; sudden stops in crises | Economy, exchange rate |
| Ideas & culture | Neighbor/partner political alignment nudges party ideology preferences | Politics §4.4 |
| Security | Threat from hostile states raises defense spending pressure; alliance calls to war; invasion | Budget, stability, War §4.11 |
| Foreign wars | Wars between third countries disrupt trade and commodity prices, send refugees, and can drag in allies | Economy, demography, diplomacy |
| Sport | International fixtures and tournaments; boycotts and bans follow relations | Sports §4.8 |
| Intelligence | Foreign collection and covert operations against the nation; exposed operations become incidents | Relations, stability, economy |
| Diplomacy | Player actions (§8.3) and foreign AI actions | Relations → all above |

**Pull strength** is weighted by `partner size × proximity × trade intensity`. Large,
close, deeply connected partners dominate, as they do in reality. A per-save
**"world influence" slider** (0.5×–2×) lets players dial overall foreign pull up or down.

**Scope:** sovereign states are full actors. Generated dependencies (small
territories, at a frequency guided by the real ratio of dependencies to sovereign
states) inherit foreign policy and military from their administering country but keep
their own economic and demographic figures.

### 4.11 Military & War

Wars are simulated in depth (D10) at the **operational** level: armies, fronts, supply,
and occupation, resolved monthly. There are no individual battles to control.

#### 4.11.1 Armed forces

Every country (player's nation and foreign) has:

| Component | Fields |
|---|---|
| Personnel | active, reserve, paramilitary; conscription model (none, selective, universal) and service length |
| Branches | land, air, naval (each with strength, equipment quality, readiness) |
| Equipment | quality index (0–1) from procurement spending and technology level; stockpiles depleted by war |
| Defense industry | domestic production capacity; share imported (arms trade depends on relations) |
| Logistics | supply capacity, tied to transport infrastructure (§4.7) and ports |
| Doctrine | defensive, balanced, or expeditionary: modifies attack/defense and power projection |
| Morale | driven by legitimacy, war goals, casualties, and recent results |
| Command | named generated commanders with skill ratings; purges and coups affect them |

**Combat power** of a force = personnel × equipment quality × readiness × morale ×
doctrine modifier × supply factor. Starting values are generated from the guiding
variables (defense spending % GDP and personnel per capita, conditioned on GDP per
capita, government type, and threat environment), then derived from ongoing budgets.

**No nuclear weapons (D15).** Nuclear weapons do not exist in Nationwright's world. No
country has them, can build them, or can use them, and there is no deterrent mechanic.
Warfare is entirely conventional. Civilian nuclear *energy* remains an ordinary
infrastructure category (§4.7).

**Defense system (tick step 11):** the budget funds upkeep, procurement, and training.
Underfunding erodes readiness and equipment. Conscription draws from the
military-age cohorts (§4.1), which removes labor from the economy.

#### 4.11.2 Path to war

```
 rivalry/claims ─▶ tension ─▶ crisis ─▶ ultimatum ─▶ war ─▶ ceasefire ─▶ peace treaty
        ▲             │          │           │                 │              │
        └─ de-escalation, mediation, bloc pressure, deterrence ◀┘       post-war period
```

- **Casus belli:** territorial claims, protection of co-ethnics or co-religionists abroad, alliance
  obligation, regime hostility, resource disputes, or an unprovoked attack (which costs
  large amounts of legitimacy and trust worldwide).
- **War powers** follow each constitution: who can declare war (executive alone,
  legislature vote, referendum). For the player, a legislature that refuses to authorize
  war blocks the declaration, consistent with the overseer role (D2).
- **Alliance calls:** defense pacts trigger calls to arms. Refusing breaks the treaty and
  damages trust.
- **Escalation control:** AI weighs expected war score, costs, domestic support,
  alliance backing of the target, and the global reaction. Without a nuclear
  deterrent (D15), great powers are restrained by alliances, the cost of conventional
  war, and economic interdependence.

#### 4.11.3 War resolution (monthly)

**Theater graph:** nodes are the player's regions and foreign provinces, taken from the
map (§4.12.2). Edges are shared land borders and generated sea lanes between coastal
nodes. Terrain modifiers come from the map cells in each node (mountains, forest,
rivers, desert). A **front** exists on each edge between hostile nodes where at least one
side has forces. Fronts, occupation, and control are drawn on the map (§4.12.5).

Each tick, for each front:
1. **Force allocation:** each belligerent distributes land/air power across its fronts
   and home defense (AI or player posture: defend, hold, advance, all-out).
2. **Engagement:** Lanchester-style attrition with modifiers for terrain, fortification,
   air superiority, supply, weather/season, commander skill, and **battlefield
   intelligence** (§4.13): the side that knows the other's dispositions better fights
   with a bonus, and a well-concealed attack gains surprise in its first month.
   `losses_A = k · power_B · mod_B`, `losses_B = k · power_A · mod_A`, with seeded noise.
3. **Control shift:** a sustained power ratio above a threshold moves the node's
   **control** (0–100%). At 100% the node is occupied.
4. **Naval theater:** blockades cut the target's trade (§4.3) and sea supply; naval
   strength decides sea control.
5. **Air/strike campaigns:** damage infrastructure (§4.7), industry, and, depending on
   the belligerent's strike targeting policy (see below), population centers in
   reachable nodes.

**Consequences feed every system:**

| Effect | Target |
|---|---|
| Military deaths and wounded, by age and sex of the forces | Demography cohorts §4.1 |
| Civilian harm (casualties, injuries), both incidental and deliberate (D21; see below) | Demography |
| Displacement: internal (between regions) and refugees (to neighbors) | Demography, foreign countries |
| Infrastructure destruction in contested nodes | Infrastructure §4.7 |
| Mobilization pulls labor; war spending, debt, inflation; trade collapse with the enemy | Economy §4.3 |
| Occupied regions stop contributing taxes and labor to their owner | Economy, politics |
| War weariness (casualties, duration, occupation of home regions) lowers approval; rally-round-the-flag at the start | Politics §4.4 |
| Elections held in wartime; possible postponement per constitution | Elections §4.5 |
| Sports: suspended leagues, international bans | Sports §4.8 |
| Third-country reactions: sanctions, aid, arms supply, joining the war | Diplomacy §4.10 |

**Civilian harm and civilian targeting (D21).** Civilian harm comes from two sources,
and both are computed in aggregate per node and month, like every other war outcome:

- **Incidental harm** follows from combat intensity, population density and
  urbanization of the contested node, duration of fighting, strike campaigns on
  infrastructure, force discipline (derived from training, command quality, and
  legitimacy), and occupation/insurgency levels.
- **Deliberate targeting** follows from a belligerent's **war policies**. The player and
  every AI government set them per war, and there is no opt-in setting that disables
  them:

| War policy | Levels | Military/economic effect | Civilian effect |
|---|---|---|---|
| Strike targeting | military only · + dual-use infrastructure (power, fuel, transport) · + population centers | Cuts the enemy's war production, logistics, and morale | Rises steeply with each level |
| Blockade scope | contraband only · general trade · total, including food and medicine | Stronger economic pressure on the target | Shortages raise mortality, above all among the young and old |
| Occupation policy | standard administration · harsh (requisitions, collective punishment) · reprisals and forced displacement | Faster control and short-term suppression of insurgency | Casualties and displaced people in occupied nodes; insurgency grows back stronger |

The AI chooses war policies with the same utility scoring as other actions (§4.10.3).
A leader's **ruthlessness** trait, the government type, how the war is going, and
expected international reaction weigh the choice. Harm is reported as statistics in the
war report and the chronicle, never depicted graphically. Whatever its source, it has
consequences, and deliberate targeting multiplies them:
- world relations and trust toward the responsible belligerent fall, faster and further
  for deliberate targeting, which third countries attribute through their own
  intelligence (§4.13);
- bloc resolutions, sanctions, arms embargoes, and, after the war, international-tribunal
  events that name the leaders and commanders responsible;
- domestic legitimacy and approval shift by the governing coalition's ideology; own
  force morale and discipline fall, and commanders may refuse orders, which raises coup
  risk;
- the targeted population's war support may harden rather than break, and occupied
  nodes carry lasting insurgency and revanchist claims (§4.11.4);
- refugee flows and long-term demographic scars (lost cohorts, orphans, disability
  index).

The player can also **reduce** incidental harm through choices that make sense on their
own (force training and discipline budget, rules-of-engagement posture, protecting
infrastructure, humanitarian corridors in peace talks).

**War score** (−100…+100) summarizes occupation, casualties ratio, blockade, and war-goal
progress, and drives peace negotiations.

#### 4.11.4 Peace & aftermath

- **Ceasefire** when both sides' expected gain from continuing drops below cost, or when
  imposed by bloc pressure.
- **Peace terms** are bought with war score: territory transfer (regions/provinces with
  their cohorts, cities, and infrastructure), reparations, demilitarized zones, regime
  change, treaty obligations, or white peace.
- **Territory transfer** of a player region moves its population, cities, and teams to
  the foreign country (their data is kept in reduced form). Gained provinces are
  converted into new player regions with generated cities and cohorts derived from the
  province's population and the owner's demographics.
- **Aftermath:** demobilization, veterans, reconstruction projects, revanchist claims
  (claims persist with decaying strength), trust damage, and memorial events for the
  chronicle.
- **Occupation & insurgency:** occupied nodes with hostile populations generate
  insurgency that bleeds occupier strength and stability.
- **Civil wars:** severe instability can split a country (the player's included) into
  government and rebel factions that fight over regions with the same model.

### 4.12 World Generation & Map

Every country is fictional and procedurally generated (D12). The world has a real
geographic map in v1 (D4). Reference data is never shown as a country. It is
distilled into **guiding variables** that make the generated world statistically
realistic.

Generator inputs:
- the **world seed**: 64-bit, internal only (§3.3, D23);
- number of countries: **no hard limit (D17)**. The default ≈ the real number of
  sovereign states in the data (~195). The **recommended** range is 20–250. Outside it
  the wizard shows a realism note (how far the world departs from Earth-like
  proportions) and allows the choice. The map's cell
  budget, relation matrix (n² pairs), and war resolution scale with it;
- land fraction, climate bias, and optional archetype mix overrides.

Under the reproducibility contract in §3.3, the same inputs always produce the same
world. Players share worlds as save files, never as seeds (D23).

#### 4.12.1 Guiding variables

Built offline by the reference-data pipeline (§10.1) and shipped as a versioned
`guiding-variables.json` next to the snapshot:

| Component | What it captures | Method |
|---|---|---|
| Marginals | Distribution of each numeric variable (population, area, GDP per capita, TFR, life expectancy, urbanization, literacy, sector shares, debt, defense % GDP, …) | Empirical quantile functions; log transform for skewed variables |
| Dependence | How variables move together (rich ⇒ lower TFR, higher life expectancy, more urban, more services) | Gaussian **mixture** copula on normal scores `z = Φ⁻¹((rank − ½)/n)`. Nothing is imputed: every statistic uses only the states that report the variables involved (available-case) |
| Archetypes | Clusters of similar countries (e.g. "low-income, young and fast-growing", "high-income, industrial") | k-means++ (k = 6, fixed seed) in z-space. Each archetype has a weight and a mean vector; all share one within-cluster covariance, because ~30 states per cluster can't support a separate 33 × 33 covariance each. Clustering uses partial distances over reported values; each variable's archetype means are recentred and rescaled so the mixture reproduces the reporters' distribution, and the covariance is set so the mixture's total correlation equals the reporters-only (pairwise) correlation |
| Categorical tables | Government type, number of major languages/religions, ethnic fractionalization, landlocked share, island-nation share, dependency ratio to sovereign states | Frequencies conditioned on archetype |
| Structure | Distribution of country areas and populations (heavy-tailed), neighbor counts, coastline share | Fitted distributions used by the map generator |
| Spatial similarity | How similar neighbors are to each other | Share of bordering states in the same archetype (64% vs. 21% by chance) and per-variable correlation across borders. The generator copies the most common archetype among already-placed neighbours with probability 1.36 × (agreement − chance) / (1 − chance); the factor is calibrated by the validation script (§4.12.6) |

Only aggregated statistics are stored. No per-country records ship in
`guiding-variables.json`. The raw snapshot stays a development and validation asset.

The copula covers 33 variables. Geography that the map itself produces (coastline, land
neighbours, landlocked or island status) is not sampled; its real-world distributions
are kept as targets for the map generator. A real state that doesn't report a variable
is left out of every calculation involving it, so gaps never pull the model (literacy is
reported mostly by poorer states, school life expectancy mostly by richer ones; each
generated distribution matches its reporters). Every generated nation has every variable.
The one deliberate exception is railway density, where a missing value means no railway
and is read as 0.

#### 4.12.2 Map generation

A 2D world on a plane that wraps east–west:

1. **Cells:** a jittered hexagonal lattice (150 cells per country by default, ≈ 29k for
   196 countries) with Delaunay adjacency (`d3-delaunay`); ghost points across the seam
   make it wrap east–west. Voronoi polygons are only needed for drawing, so the UI
   computes them.
2. **Elevation:** *where* land is comes from 6–12 continent cores and archipelago seeds
   (≈ 2.5 per expected island nation), with noise-warped coastlines. The sea level is
   the exact quantile for the target land fraction (default ~29%). *How high* land is
   comes separately from ridged noise (mountain ranges), rolling detail, and a rise
   inland, ranked and curved so high ground is rare.
3. **Climate:** temperature from an Earth-like zonal table by latitude, minus height,
   plus noise and the climate bias; moisture from a latitude rain band, distance to the
   ocean, and noise → biomes (ice, tundra, boreal, temperate forest, grassland, desert,
   savanna, tropical forest, mountains).
4. **Hydrology:** priority-flood depression filling from the sea, rainfall accumulated
   downstream → rivers (wettest 7% of land cells) and lakes (filled depressions).
5. **Habitability:** per-cell score (biome, temperature, moisture, height, coast, river)
   → where people live and where capitals and cities go. Resource deposits are not yet
   placed (M3, with the economy).
6. **Countries:** first ≈ 20% of capitals go alone on small landmasses (island nations);
   the rest spread over the remaining land, weighted to habitable and coastal cells.
   Nearest-capital regions give a provisional neighbour graph, used to pick archetypes
   (island capitals favour island-prone archetypes) and sample nations; within each
   archetype the largest nations get the capitals with most room. Countries then grow
   by cost-weighted flood fill toward their sampled areas (mountains, deserts, ice,
   and river crossings cost more, so they tend to become borders). Tests hold island,
   landlocked, and one-neighbour shares near the real ones.
7. **Continents & subregions:** continents are landmasses with at least two countries
   or 2% of all land; island nations belong to the nearest. Subregions are clusters of
   about eight neighbouring countries.
8. **Provinces & regions:** each foreign country is split into provinces (count scales
   with area and population). The player's country is split into regions per the
   wizard setting, with borders editable by merging/splitting cells.
9. **Cities:** placed on high-habitability coastal and river cells; sizes follow the
   rank-size rule, scaled to the country's urban population.
10. **Sea lanes & distances:** a navigation graph over ocean cells gives shipping
    distances. Land and sea distance feed proximity for trade and migration (§4.10).
    (Deferred to M3, where trade first needs it.)

The finished map is **stored in the save** (cells, geometry, terrain, ownership), not
regenerated on load. Engine updates therefore never alter an existing world. During
play only ownership, control, and infrastructure overlays change.

#### 4.12.3 Nation statistics

For each country, including the player's defaults:

1. Choose an **archetype**, weighted by real frequency and smoothed across borders so
   neighbors resemble each other (guided by spatial similarity).
2. Sample a correlated vector from that archetype's copula and map it through the
   marginals.
3. Condition on geography: island capitals favour island-prone archetypes, and the
   largest nations of each archetype get the most room. Population keeps its sampled
   (real-world) distribution and is spread within the country by habitability², so
   deserts and ice stay empty. (Landlocked and resource effects on trade come with the
   economy in M3.)
4. **Derive consistent values:** GDP = population × GDP per capita; the age structure
   comes from TFR and life expectancy (stable-population model); sector shares
   normalized to 1; budget and debt consistent with GDP.
5. Categorical traits: government type, legislature, electoral system, the number of
   ethnic groups, languages, and religions, their overall shares, and fractionalization
   (all from the guiding variables).
6. **Culture pack:** generated names for the country, cities, people, parties,
   languages, ethnic groups, and religions: syllable generators over a per-family phoneme
   inventory, syllable shapes, and endings. Families (about one per 12 countries) are
   spread by farthest-point seeds with jittered nearest-seed assignment, so neighbours
   usually share one. Groups can span borders, e.g. a neighbour's people or language
   appearing as a local minority. Generated names are checked against a blocklist of
   hashed real country and capital names (from the reference pipeline) and an
   offensive-substring filter, and are unique within a world.
7. **Randomized culture associations (D14):** draw how ethnicity, religion, and
   language combine, using the stream `worldgen/culture/<country>`:
   - an **alignment** value in [0, 1] per pair of dimensions (E–R, E–L, R–L), where 0
     means the groups cut across each other independently and 1 means they coincide
     (each ethnicity has "its own" religion and language);
   - random pairing of which ethnicity leans toward which religion and language;
   - build a joint distribution that matches the three separate share vectors from
     step 5 and whose associations match the drawn alignments. Iterative proportional
     fitting starts from an aligned or independent seed table and rescales it to the
     given totals.
   - regional variation: minorities are concentrated in some regions, not spread evenly
     (the degree of concentration is drawn per group).

The player's nation goes through the same generator. The wizard's "randomize" and
archetype templates (§8.1) draw from it.

#### 4.12.4 Starting relations & backstory

- Initial relations, blocs, alliances, and rivalries are generated from proximity,
  ideology, culture-family similarity, and trade.
- **Burn-in (D18, kept):** a fast diplomacy-and-war pre-run of ~30 simulated years
  before the start date. It produces organic alliances, territorial claims, grudges, and
  a few past wars. Its events become the world's backstory in the chronicle. Its
  statistical drift is then discarded, so each country's statistics still match its
  sampled start values.

#### 4.12.5 The map in the UI

The map is a first-class screen, not decoration:

| Layer | Shows |
|---|---|
| Political | Countries, the player's regions, capitals, cities |
| Physical | Elevation, biomes, rivers, resources |
| Choropleth | Any indicator: the player's regions, or all countries on the world view |
| Infrastructure | Roads, rail, ports, airports, grid coverage |
| Flows | Trade, migration, and refugee arcs, weighted by volume |
| Diplomacy | Relations with a selected country, blocs, alliances, sanctions |
| War | Fronts, control/occupation shading, force positions (estimated, with uncertainty, for other countries' forces), blockades, civilian harm by node |
| Intelligence | The player's coverage of each country by category; detected foreign operations |
| Elections | Results by district or region, swing |
| Sport | Team locations, champions by city |

- Pan/zoom from the world view down to the player's regions and cities. Clicking any
  feature opens its profile. A time slider replays a layer over history.
- Rendering: Canvas 2D with precomputed polygon paths (WebGL via PixiJS if profiling
  requires it); SVG/PNG export for reports.

#### 4.12.6 Generator validation

Across many world seeds, the generated world must match the reference:
Kolmogorov–Smirnov tests per variable, correlation-matrix distance, category-frequency
differences, and neighbor-count distributions, all within tolerances (§10).

### 4.13 Intelligence & Fog of War

The engine always holds every country's true state, but no government sees it (D22).
Each government, the player's included, sees the rest of the world through
**estimates** produced by its own intelligence service. The player never sees another
country's true values in normal play; the UI shows the player's estimates, with their
uncertainty. What a government knows about its *own* country is exact.

#### 4.13.1 Intelligence services

Every country has an intelligence service, generated with the military (§4.11.1) and
funded from the budget:

| Field | Meaning |
|---|---|
| Budget | Share of spending; underfunding erodes capability over years |
| Collection | Capability (0–1) to gather information abroad: human sources, signals, imagery, open sources, in aggregate |
| Counterintelligence | Capability (0–1) to deny information to others and to detect foreign operations at home |
| Covert action | Capability (0–1) to run operations abroad |
| Priorities | Collection effort spread across target countries (AI or player) |

Starting capabilities are derived from GDP per capita, defense spending, government
type, and threat environment, like the armed forces. They then follow the budget
slowly: an agency takes years to build and years to decay.

#### 4.13.2 Knowledge model

For each ordered pair (observer, target), a **coverage** value (0–1) summarizes how
well the observer knows the target. Each month it moves toward a target level set by:

- the observer's collection capability and the effort it assigns to that target;
- **access:** embassy presence (relations above a threshold), trade and travel
  (`trade_flows`, `visa_regime`), diaspora ties, proximity, and shared borders;
- **intelligence-sharing treaties**, through which allies pool coverage (discounted by
  `trust`);
- the target's counterintelligence and its **openness** (press freedom and statistical
  transparency, from government type).

Coverage is **per category**, because some things are easier to learn than others:

| Category | Contents | Base visibility |
|---|---|---|
| Public | Population, GDP, trade, published statistics, government, leaders, election results | High: published figures, which closed or low-transparency governments may distort |
| Military | Force strengths, equipment, readiness, deployments, stockpiles | Medium |
| Political | Stability, legitimacy, coup and revolution risk, faction strength | Medium–low |
| Intentions | Leader traits, strategic goals, war plans, war policies (§4.11.3), covert operations | Low |

**Estimates.** For each category, an estimate of a true value `x` is
`x · (1 + σ · z)`. The error width `σ` falls as coverage rises. `z` is a standard normal
draw that is redrawn once per estimate period and carried over between periods as a
slow AR(1) process, so estimates drift instead of jittering. Each (observer, target,
category) triple uses its own domain-separated stream (§3.3), so adding an observer
never changes anyone else's estimates. Estimates are refreshed monthly for salient
pairs and annually for the rest, following the salience tiers (§4.10.3).
Low-transparency governments add a **reporting bias** to their published figures (for
example, overstated growth), which only coverage can see through.

Estimates are derived from the stored coverage values and the seeded stream rather than
stored, so the cost grows with the number of salient pairs, not with n² × fields.

#### 4.13.3 Covert operations

The player and AI governments can run operations against a target country. Each costs
covert-action capacity, succeeds or fails on capability versus the target's
counterintelligence (with seeded noise), and carries an **exposure** risk:

| Operation | Effect on success |
|---|---|
| Collection surge | Raises coverage of one category for a period |
| Counterintelligence sweep (at home) | Raises the chance of detecting foreign operations; expels foreign agents |
| Sabotage | Damages military or industrial assets and infrastructure (§4.7) |
| Political interference | Shifts party support, stability, or legitimacy; funds opposition or rebels |
| Disinformation | Lowers the target's coverage of the operator, or distorts its estimates |

**Exposure** creates an incident: `score` and `trust` fall, the target may expel
diplomats or impose sanctions, and the chronicle records it. An operation discovered
years later still counts.

#### 4.13.4 Fog of war in wars

- **Enemy forces** on each front are shown as estimates with ranges; the war map draws
  them with uncertainty (§4.12.5).
- **Battlefield intelligence** modifies engagements, and concealed offensives gain
  surprise (§4.11.3).
- **Mobilization and war plans** can be detected in advance with enough military and
  intentions coverage, which gives warning before an attack.
- **Attribution:** third countries judge a belligerent's conduct, including deliberate
  civilian targeting (D21), through their own coverage of it. Well-hidden conduct draws
  a weaker reaction until it comes to light.
- Casualty and war-score figures for foreign belligerents in the war report are
  estimates; the player's own figures are exact.

#### 4.13.5 What the player sees

- Every foreign figure in reports, profiles, and map layers is the player's estimate.
  Tables show a range or a confidence mark, and charts show a band.
- The **World Comparison** report ranks the nation against the player's estimates of
  other countries. Validation against reference bands (§10.1) always uses true values.
- **Sandbox mode** (§8.3) can reveal true values. Saves that use it are flagged, as with
  other sandbox edits.
- The engine process sends the renderer only the player's view of foreign countries.
  True foreign values do not cross the IPC boundary outside sandbox mode.
`npm run worldgen:validate` generates 200 worlds at the default settings (about a minute)
and writes `docs/validation/worldgen.md`. It checks island, landlocked, and
neighbour-archetype agreement shares against sampling ranges; the neighbour-count
histogram (total variation distance ≤ 0.12); every variable's pooled KS distance
(≤ 0.06; population growth and sector shares are rewritten by consistency rules and not
scored); and the largest correlation error (≤ 0.12). It runs outside CI; rerun it and
commit the report whenever the generator or the guiding model changes. Known deviations:
too many one-neighbour countries (about 14% vs. 8%) and a thin tail of countries with
more than 14 neighbours.

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
                 │ ideas · security · intelligence · sport           │
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
├── meta: world_seed (8 bytes + base64url string), generator_version,
│         guiding_variables_version, generator_settings, start_year, current_date,
│         ruleset_version, reference_snapshot_id
├── map: cells[] (site, polygon, elevation, biome, river flow, resources, owner,
│        province_id, control), continents[], subregions[], sea_lanes graph
├── global: commodity_prices{}, world_demand, reference_currency, blocs[]
├── countries[]: id, generated name, culture_family, archetype, capital_cell,
│               provinces[], government, military, intelligence service,
│               state (§4.10, §4.11, §4.13)
│               (the player's nation is also listed here, flagged is_player)
├── relations: pairwise matrix over countries (§4.10.2), including directed
│              intelligence coverage and covert operations (§4.13)
├── wars[]: belligerents, war goals, war policies per belligerent, fronts[],
│           war_score, start/end, peace terms
└── nation: Nation (full-depth state for the player's country)

Nation
├── meta: name, founding_date (flavor), culture_family
├── geography: regions[] (cell sets; adjacency derived from the map)
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
  - `meta` — schema_version, world_seed (BLOB, 8 bytes), world_seed_b64 (TEXT,
    canonical base64url), generator_version, guiding_variables_version,
    generator_settings (JSON), start_year, reference_snapshot_id, created_at
  - `map_layers` (typed-array layers as raw little-endian bytes: sites, adjacency,
    terrain, hydrology, ownership, provinces, population) and `worldgen` (everything else
    the generator decided, as JSON) — written once at world creation (schema v2).
    Ownership changes during play will live in the world slice, not these tables
  - `snapshot` — the latest full engine state, one row per part (`meta`, `modifiers`,
    `slice:<key>`). Stored as JSON for now; the `format` column allows a switch to
    MessagePack later if measurements show a need (D19)
  - `commands` — the append-only player command log (tick, type, payload) for replay and
    branching
  - `indicators` — `(indicator_id, tick, scope, value)` with an index on
    `(indicator_id, scope, tick)`; `scope` is `nation`, `region:N`, `city:N`, or
    `country:N`
  - `entities` — cities, parties, politicians, teams, universities, foreign countries
    (queryable columns + JSON detail)
  - `elections`, `election_results`, `matches`, `standings` — high-volume history
  - `chronicle` — dated event log with category and references
  - `wars`, `fronts`, `relations_history` — conflict and diplomacy history
  - `reference_bands` — a frozen copy of the validation bands and guiding-variables
    version used by this save, so validation stays reproducible if the bundled data is
    updated later
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
| **Election Report** | Results by district, seats, turnout, swing, results map | Per election |
| **Education Report** | Enrollment, attainment, literacy, university list | Annual |
| **Infrastructure Report** | Coverage, capacity vs. demand, projects | Annual |
| **Sports Almanac** | Standings, champions, records, team histories | Per season |
| **Foreign Relations** | Relations table, trade by partner, migration by origin/destination, treaties, diaspora | Annual + on demand |
| **World Comparison** | The nation ranked against all generated countries on any indicator, and its percentile against the real-world reference distribution | Always available |
| **War Report** | Belligerents, war policies, fronts and control over time, casualties (military/civilian, incidental/deliberate), displacement, costs, war score, peace terms; foreign figures are estimates | Monthly during war + final |
| **Intelligence Assessment** | Coverage by country and category, estimates with confidence, detected foreign operations, own operations and their outcomes, warnings of mobilization | Quarterly + on demand |
| **Defense Review** | Forces by branch, readiness, equipment, spending, threat assessment | Annual |
| **World Atlas** | Map layers (§4.12.5), country profiles, blocs, generator info | Always available |
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
2. **World:** a random world is generated (§3.3; the seed is never shown, D23). The
   player can reroll it or adjust generator settings (§4.12), and the world map previews
   live.
3. **Place in the world:** pick a slot on the map (a subregion; coastal, landlocked, or
   island). The slot fixes the neighbors, and the wizard shows their generated stats.
4. Geography: the number of regions (the map splits the territory, and borders can be
   edited by merging or splitting cells). Climate and resources come from the map.
5. **Starting profile:** population size and development level. Presets are the
   **archetypes** from the guiding variables (§4.12.1), e.g. "upper-middle-income
   service economy". The profile is sampled with the same copula as every other country,
   so values stay mutually consistent. Every starting value can be edited afterwards,
   and each shows its percentile against real-world data.
6. Society: ethnic, linguistic, and religious groups (fictional, from the culture pack)
   and their regional distribution. Counts and fractionalization are sampled from the
   guiding variables.
7. Cities: placed by the map generator, then editable (rename, move, resize).
8. Constitution: government type, legislature, electoral system.
9. Parties: generated from ideological spectrum or custom.
10. Sports: choose national sports and league structures (defaults suggested from
    subregion popularity).
11. **Plausibility review:** any starting indicator outside the real-world range is
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
  sanctions, defense pacts, border treaties, territorial claims, mediation offers,
  ultimatums, and ambassadorial stance (improve/worsen relations) per country.
- **Defense & war:** defense budget split (personnel, procurement, readiness), conscription
  model, doctrine, arms purchases, and basing agreements. Declaring war (subject to war
  powers, §4.11.2), front postures, war goals, war policies (strike targeting, blockade
  scope, occupation policy, §4.11.3), and accepting or offering peace terms.
- **Intelligence:** agency budget split (collection, counterintelligence, covert
  action), collection priorities per country, intelligence-sharing treaties, and covert
  operations (§4.13).
- **Projects:** infrastructure, new universities, stadiums, new cities.
- **Politics:** propose laws, call snap elections (if the constitution allows), propose
  constitutional amendments.
- **Events:** respond to choice events.
- **Sandbox mode (optional toggle):** directly edit any value and reveal true values of
  foreign countries (§4.13.5); saves are flagged as modified and excluded from
  validation statistics.

---

## 9. Technology

**TypeScript throughout (D1), Electron desktop app (D9).** The rows marked Settled are
fixed. The rest are recommended and can change without affecting the architecture.

| Layer | Choice | Status | Rationale |
|---|---|---|---|
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess` | Settled | One language for engine, app, UI, and tooling |
| Engine | Pure TS over plain data; typed arrays (`Float64Array`) for cohort grids | Settled | Deterministic, fast, serializable |
| Persistence | SQLite via `better-sqlite3` behind a storage interface | Settled | D3; see §6.3 |
| Runtime | Node.js (current LTS) for engine, CLI, and data tooling | Recommended | Native SQLite driver, headless batch runs |
| Desktop shell | **Electron** | Settled | D9; hosts Node, so `better-sqlite3` works unchanged |
| UI | React + Vite in the Electron renderer | Recommended | Charts/tables are the core UI |
| Charts | ECharts or Observable Plot | Recommended | Time series, pyramids, stacked bars |
| Map | `d3-delaunay` (Voronoi), `simplex-noise` (terrain), Canvas 2D rendering; PixiJS/WebGL if profiling requires it | Recommended | Deterministic geometry; fast polygon rendering for ~30k cells |
| Seed codec | Small in-house module: 8-byte ⇄ base64url with canonical check | Recommended | ~40 lines, no dependency; exhaustive round-trip tests |
| Content | YAML data packs validated with JSON Schema (via `zod` types) | Recommended | Moddability, typed at load |
| Tests | Vitest; golden-master and property-based tests (`fast-check`) | Recommended | Determinism and balance |
| License | GPLv3 or later (`GPL-3.0-or-later`); SPDX headers; CI dependency-license check | Settled | D20. Planned dependencies (Electron, React, `better-sqlite3`, d3, `simplex-noise`, ECharts, zod, Vitest) are under MIT/ISC/BSD/Apache-2.0 licenses, all GPLv3-compatible. Verify each at install time |
| Repo layout | Monorepo workspaces: `packages/engine`, `packages/app`, `packages/ui`, `packages/cli`, `packages/reference-data`, `content/` | Recommended | Enforces engine/UI separation |

Determinism notes for TypeScript:
- No `Math.random()` in the engine; lint rule bans it along with `Date.now()` and
  `new Date()` outside the application layer.
- Iterate over arrays or sorted keys, never over `Object.keys` of maps built in
  non-deterministic order.
- Integer-valued quantities (people, seats) are rounded with a documented rule
  (largest-remainder) so totals are conserved.

**Electron process layout:**

```
 main process ──── window lifecycle, menus, file dialogs, auto-update
     │
 utility process ─ engine + better-sqlite3 (simulation runs here, off the UI thread)
     │  typed IPC: commands / queries / progress events (via MessagePort)
 renderer ──────── React UI, charts, map (no Node access; contextIsolation on,
                   nodeIntegration off, strict CSP; a preload script exposes a
                   narrow typed API)
```

- Running the engine in a utility process keeps the UI responsive during multi-year
  runs, and progress streams back per tick.
- `better-sqlite3` 13 ships Node-API prebuilds, which load in Electron without a rebuild
  (verified by the end-to-end smoke test, including from a packaged build), so
  electron-builder runs with `npmRebuild: false`. It is the app's only runtime
  dependency; everything else is bundled into `packages/ui/out/`.
- The renderer talks to the engine through a typed protocol
  (`packages/ui/src/shared/protocol.ts`) over a MessagePort that the main process brokers.
  The main process owns only native dialogs and a fixed allowlist of external links.
- Packaging: electron-builder for Windows, macOS, and Linux installers. The reference
  snapshot and guiding variables ship as read-only app resources.
- The same engine package runs in plain Node for the CLI batch runner and tests.

Performance fallback: there is no performance target yet (D19). If measurements later
show a need, hot loops (cohort update,
war resolution, match simulation) can move to a Rust/WASM module behind the same
TypeScript interface.

---

## 10. Testing & Validation

- **Unit tests** for each system's formulas and each electoral system (seat allocation
  against known worked examples).
- **Determinism tests:** simulate 50 years twice with the same seed; states must be
  byte-identical.
- **Golden-master tests:** store summarized indicator outputs for fixed seeds; changes
  require an explicit update.
- **Plausibility checks:** automated assertions that indicators stay inside the
  real-world bands derived from factbook.json (§10.1) across many seeds.
- **Balance runs:** batch-simulate N seeds × M years headless and produce distribution
  reports, to catch runaway feedback loops (e.g. infinite growth or collapse).
- **Seed codec tests:** round-trip for random and edge seeds (`0`, `2^64−1`); rejection of
  non-canonical strings (wrong length, bad alphabet, non-zero trailing bits);
  acceptance of standard-base64 and padded input.
- **World-generation reproducibility:** a fixed list of seeds must produce
  byte-identical maps and country tables. These are golden masters, bumped only with
  `generator_version`.
- **Generator statistical tests (§4.12.6):** across ≥ 200 seeds, generated
  distributions match the reference (KS statistic below a tolerance per variable;
  Spearman correlation matrix within a max absolute difference; category frequencies
  within ±5 percentage points; neighbor-count and landlocked shares within tolerance).
- **Foreign-model drift:** generated countries should not leave the real-world bands
  within 20 simulated years unless an event explains it (war, collapse).
- **War model sanity:** in scripted scenarios (a strong vs. a weak neighbor; balanced
  alliances; a blockaded island), outcome distributions over many seeds match design
  expectations. Casualty rates, war duration, and the share of worlds with at least one
  war per decade are checked against tuning targets.
- **Save migration tests:** load fixtures from every past schema version.

### 10.1 Reference data: factbook.json (D8)

The reference source is **[factbook/factbook.json](https://github.com/factbook/factbook.json)**,
used directly (the World Factbook dataset behind OpenFactBook). Facts checked
against the repository on 2026-09-25:

| Fact | Value |
|---|---|
| License | Public domain: CC0 1.0 (`LICENSE.md`); the README says "no restrictions whatsoever" |
| Layout | `<region>/<code>.json`, e.g. `europe/au.json` (Austria). Codes are the Factbook's own two-letter codes, **not ISO** (e.g. South Africa is `sf`, Zambia is `za`) |
| Coverage | 262 JSON files: country entries across 10 regions plus `antarctica/`, `oceans/`, `world/`, and `meta/` |
| Sections per country | Introduction, Geography, People and Society, Environment, Government, Economy, Energy, Communications, Transportation, Military and Security, Space, Terrorism, Transnational Issues |
| Value format | Free text with estimate years, e.g. `"9,174,390 (2025 est.)"`, `"Roman Catholic 55.2%, Muslim 8.3%, … none 22.4% (2021 est.)"` |
| Short series | Some fields carry the last few years as keys, e.g. `"Real GDP per capita 2024"`, `"… 2023"`, `"… 2022"` |
| **Status** | **Frozen.** The last data auto-update commit is dated 2026-01-22. The README reports that the CIA took the World Factbook offline in February 2026, so no further data updates are expected |

Because the source is frozen, **forward projection (D11) is essential, not optional**.
Every start year from now on is later than the data.

**Uses in Nationwright:**

1. **Guiding variables for procedural generation** (D12, §4.12.1): the distributions,
   correlations, archetypes, and structure statistics that every fictional nation is
   sampled from. No real country is placed in the world.
2. **Validation bands** for all countries, at creation and during simulation.
3. **Parameter calibration:** fitting the relationships in §4 (e.g. TFR vs. income and
   female education, life expectancy vs. health spending, urbanization vs. GDP per
   capita) to the cross-section of real countries.

**Current year only (D7):** for each field, use the **most recent value**. Fields mix
estimate years (e.g. population "2025 est.", religions "2021 est."), so the ingest stores
each value's **estimate year**. The short multi-year series are used only to estimate
growth rates for projection. The game never replays historical data.

**Projection to the start year (D11):** every value whose estimate year is earlier than
the start year is projected forward before guiding variables and bands are computed:

| Kind of field | Projection rule |
|---|---|
| Population | Compound by the country's population growth rate: `v · (1 + g)^Δy` |
| Real output (real GDP, PPP) | Compound by trend real growth: the median of the latest three yearly rates, skipping 2020–2021 (pandemic shock and rebound), clamped to ±10%/yr |
| Nominal US-dollar values (GDP at exchange rates, exports, imports) | Real growth **plus world dollar inflation** (default 2.5%/yr), *not* local inflation: dollar values don't rise with local prices, because the currency depreciates |
| Per-capita output (GDP per capita, PPP) | The published value × `((1 + g_real) / (1 + g_pop))^Δy`. This equals total ÷ population when the source is self-consistent and keeps the published figure when it isn't. Mismatches over 25% are listed in the pipeline report |
| Rates and shares (TFR, birth/death rates, life expectancy, infant mortality, median age, urbanization, literacy, schooling, sector shares, electricity, internet) | Damped convergence toward the tier median (5% of the gap per year), capped per year (e.g. TFR 0.05, life expectancy 0.3, urbanization 0.5 pp, internet 2 pp); sector shares renormalized to their published sum |
| Year-specific rates (GDP growth, inflation, unemployment, debt, military spending, migration) and structural facts (area, borders, coastline, railways, age structure, government type, culture groups) | Carried forward unchanged |

Until M1 fits proper archetypes, the convergence "tier" is the country's GDP-per-capita
quartile among states.

- The pipeline projects to a **target year**. Each value keeps its published value,
  `estYear`, projection `method`, `projectionYears`, and a `lowConfidence` flag.
- A projection horizon above a threshold (default 5 years) marks the value as
  **low-confidence**. Low-confidence values are down-weighted when fitting and are listed
  in the pipeline report. As the frozen data ages, the whole dataset gradually drifts
  toward low-confidence. This is expected and reported, not an error.
- When the game's start year is later than the pipeline's target year, the same rules
  are applied once at world creation. The result is frozen into the save
  (`reference_bands`).

**Ingest pipeline (`packages/reference-data`):**

```
fetch   git clone of factbook/factbook.json, checked out at the pinned commit, into
        packages/reference-data/.cache/ (gitignored; never vendored)
  → parse     text → value + est_year (+ earlier years for series fields);
              percentage lists → {label, share}[]; borders → neighbors with lengths
  → classify  state (196) · territory (dependencies, Western Sahara, Gaza, West Bank) ·
              excluded (uninhabited, EU, Antarctica, Paracel/Spratly Islands)
  → validate  per-field ranges; unparsed values reported, never guessed
  → project   to the target year (see above); derived indicators added
  → bands     over states only
  → data/manifest.json, snapshot-<year>.json, validation-bands-<year>.json,
    report-<year>.md (coverage, bands, consistency warnings, unparsed values)
  → (M1) fit guiding variables → guiding-variables-<year>.json
```

The snapshot is committed as indented JSON rather than SQLite so that data changes
review as normal diffs. Commands: `npm run data:fetch`, `npm run data:build -- --target-year
<year>`.

- The pipeline runs **offline as a developer tool**, never at game runtime. The game
  ships only the fitted statistics and bands, so it works without network access.
- The source is pinned to a **commit hash**, so builds are reproducible even if the
  repository changes later.
- **Parsing is the main work.** Values are free text with inconsistent notes and
  qualifiers. The parser uses per-field extractors with a test fixture for every field it
  reads, and it logs unparsed values instead of guessing.
- **Ethnicity, religion, and language (§4.1):** the Factbook lists these separately,
  never cross-tabulated. The pipeline fits only their **separate** guiding variables:
  the number of groups, the share distributions, and fractionalization. How they
  associate within a country is **randomized** at world generation (§4.12.3), so no
  association data source is needed.

**Validation bands:** for each indicator mapped to a reference field, compute the
distribution across real countries. Optionally narrow it to the nation's archetype.

| Band | Definition | Meaning when outside |
|---|---|---|
| Typical | 10th–90th percentile | Normal |
| Plausible | min–max of real countries | Unusual: shown in yellow in reports |
| Implausible | outside real min–max by > 10% | Flagged: warning at creation; logged as a balance bug in test runs |

Initial mapped indicators: population, growth rate, birth/death rates, TFR, life
expectancy, infant mortality, median age, urbanization, GDP per capita, real GDP growth,
sector shares, unemployment, inflation, public debt % GDP, exports/imports % GDP,
military expenditure % GDP, electricity access, internet users, railway density,
ethnic/religious fractionalization, land-neighbour count, and active military personnel
(total and per 1,000 people): 43 bands in total; see
`packages/reference-data/data/report-<year>.md`. The Factbook has no roadways field.
Border references are resolved to Factbook codes, so neighbour relationships are available
for M1's spatial-similarity statistics.

**Nuclear data is deliberately not used.** The Factbook has no nuclear-weapons field
anyway (its only "nuclear" field is nuclear *energy*), and nuclear weapons are banned
from the game (D15). Nuclear energy shares feed the energy-mix guiding variables like
any other generation source.

**Licensing & attribution:** CC0, so no attribution is legally required. The credits
screen still acknowledges the CIA World Factbook and the factbook.json project.

---

## 11. Milestones

| Milestone | Scope |
|---|---|
| **M0 — Skeleton** | TS monorepo, Electron shell with utility-process engine, tick loop, world seed codec + xoshiro256\*\*/SplitMix64 streams, SQLite save/load, indicator store, CLI batch runner. **Reference-data pipeline:** factbook.json ingest and parser, first snapshot, forward projection, validation bands |
| **M1 — World Generation & Map** | Guiding-variable fitting (marginals, copulas, archetypes); map generator (cells, terrain, climate, rivers, countries, provinces, cities); culture/name packs; nation statistics sampling; generator statistical tests; map screen with political, physical, and choropleth layers |
| **M2 — People & Places** | Demography (full cohort grid + culture shares), regions from the map, cities, internal migration, census report, population pyramid, validation against bands. Performance measurements (world creation and simulation time by world size; reported, not gated) |
| **M3 — Economy & World** | Sectors, labor market, public finance; foreign country mid-depth model, trade/commodities/migration/capital channels; economic survey, budget, and world comparison reports; flows map layer |
| **M4 — Politics, Elections & Diplomacy** | Constitution, parties, approval, FPTP + list PR, government formation, election report; foreign governments and elections; pairwise relations, blocs, foreign-policy AI; intelligence services, coverage and estimates (the AI decides on estimates), intelligence-sharing treaties; foreign relations and intelligence assessment reports; intelligence map layer |
| **M5 — Military & War** | Armed forces, defense budget, path to war, theater graph and front resolution, occupation, casualties/displacement feeding demography, peace terms, territory transfer, civil wars, war policies and civilian harm (incidental and deliberate) with their consequences, covert operations, battlefield intelligence and surprise, burn-in backstory; war report, defense review, war map layer; war sanity tests |
| **M6 — Education & Infrastructure** | Education pipeline, human capital link, infrastructure assets and projects, war damage and repair; infrastructure map layer |
| **M7 — Events & Chronicle** | Data-driven event engine, choices, modifier registry with explanations, yearbook |
| **M8 — Sports** | Sports/leagues/teams data model, match engine, seasons, international competitions, almanac |
| **M9 — Creation Wizard & Polish** | Nation creation flow (world reroll with live map preview, slot placement, archetype profiles, plausibility review), overseer autopilot, dashboards, world atlas, exports, comparative views, attribution screen, installers, onboarding |
| **v1.x** | More electoral systems, named athletes, branching timelines UI, modding docs |

Each milestone ends with a playable build and updated golden-master tests.

---

## 12. Open Questions

Questions raised so far are resolved as D1–D23 (§0). New ones are added here as
implementation raises them.

- **Civilian targeting outside war:** D21 covers wars, including civil wars. Whether
  governments can also target civilians in peacetime (e.g. repressing protests) is not
  decided.

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
- **base64url** — the URL- and filename-safe base64 alphabet (RFC 4648 §5), using `-` and
  `_` instead of `+` and `/`.
- **xoshiro256\*\* / SplitMix64** — a fast, high-quality 64-bit PRNG, and the generator
  used to expand a 64-bit seed into its 256-bit state.
- **Gaussian copula** — a way to sample correlated variables with arbitrary individual
  distributions, by correlating normal variables and mapping them through each
  variable's quantile function.
- **Archetype** — a cluster of statistically similar real countries, used as a template
  for generating fictional ones.
- **Coverage** — how well one government knows another country, per category (0–1);
  it sets the error of that government's estimates (§4.13).
- **Lanchester model** — attrition equations in which each side's losses scale with the
  opponent's combat power.
- **Voronoi cell** — the region of the plane closer to one seed point than to any
  other; the map's basic unit.
