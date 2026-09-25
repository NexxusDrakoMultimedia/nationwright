# CLAUDE.md

Guidance for Claude (and other AI assistants) working in this repository.

## Project state

Nationwright is in the **design phase**: there is no code, build, or test command yet.
When scaffolding starts (TODO.md, M0), update the **Commands** section below.

## Source of truth

- **DESIGN.md** is authoritative for how things work. Its **§0 Decisions Log (D1–D19)**
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
  - All randomness comes from the **world seed**: 64 bits, shown as 11-character
    unpadded **base64url**. The last character must be one of `AEIMQUYcgkosw048`, and
    the parser rejects non-canonical input. Standard base64 and `=` padding are
    converted before validation.
  - PRNG: xoshiro256\*\* seeded via SplitMix64. Every consumer uses its own
    domain-separated stream (e.g. `worldgen/elevation`, `sim/demography@tick:N`). Never
    share or reorder streams across systems.
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
- **Civilian harm is an outcome only (D16).** Never add a player or AI action that
  targets civilians.
- **Current year only (D7):** no historical start dates and no era system.
- **Culture tracking (D14):** ethnicity × religion × language is one joint
  distribution per cohort cell, stored sparsely. Associations are randomized per
  country from the seed.

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

- Planned layout: `packages/{engine,app,ui,cli,reference-data}` plus `content/` (YAML
  validated with zod/JSON Schema).
- Tests: Vitest; golden-master and property-based (`fast-check`) tests for
  determinism, the seed codec, world generation, and balance.
- Changing generator output requires bumping `generator_version` and updating golden
  masters in the same change.
- Performance: no targets yet (D19). Measure and report; don't optimize speculatively.
- Keep commits focused, with clear messages. Don't create pull requests unless asked.

## Commands

_None yet. Fill in once M0 scaffolding lands (install, build, test, lint, run the
Electron app, run the CLI, run the reference-data pipeline)._
