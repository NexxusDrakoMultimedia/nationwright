# Nationwright — Goals

This file states *why* Nationwright exists and *what* it must achieve.
[DESIGN.md](DESIGN.md) describes *how*. If they conflict, raise it; don't silently
pick one.

## Vision

A "living almanac" of a nation you created. The player founds a fictional country in a
procedurally generated world, sets its direction, and watches decades unfold through
statistics that are plausible, inspectable, and explainable. The reward is
understanding: seeing why the population aged, why the coalition fell, why the war
began, and reading it all back in census tables, yearbooks, and maps.

## Player experience goals

1. **Every number has a story.** Any major indicator can be traced to the drivers and
   events behind it ("Life expectancy −1.2 years: Epidemic (2041)").
2. **Worlds feel real without being real.** Generated nations match real-world
   statistical patterns, but no real country, person, or place appears.
3. **Consequences reach everywhere.** Education shapes the economy, the economy shapes
   politics, politics shapes war, and war reshapes the population.
4. **Influence, not control.** The player is an overseer. Institutions, elections, and
   foreign powers push back, but the player never loses the save.
5. **Worlds are shareable.** One 11-character seed reproduces a world.
6. **Reports are the core product.** Tables, charts, maps, and narrative yearbooks are
   first-class, and all of them can be exported.

## Engineering goals

1. **Deterministic:** same seed + same generator/data versions + same player inputs =
   byte-identical history.
2. **Grounded:** starting worlds and simulated outcomes stay within real-world bands
   derived from factbook.json, projected to the current year.
3. **Explainable by construction:** cross-system effects flow through a modifier
   registry that records source, target, value, and expiry.
4. **Moddable:** events, sports, culture/name packs, and tuning live in validated data
   files, not code.
5. **Testable headless:** the engine is a pure library that runs identically in the CLI,
   in tests, and in the desktop app.
6. **Measured performance:** there are no fixed hardware or timing targets yet (D19).
   Performance is measured and reported so targets can be set from real data.

## Non-goals (v1)

- Multiplayer or online features.
- Real-time play, tactical battles, or unit micromanagement.
- Real countries, real people, or real-world geopolitics.
- Historical start dates or era systems. Every game starts in the current year.
- Agent-based simulation of individual citizens.
- **Nuclear weapons.** They do not exist in the game's world.

## Success criteria for v1

- **Generator realism:** across ≥ 200 seeds, generated worlds pass the statistical
  tests in DESIGN.md §10 (distributions, correlations, category frequencies within
  tolerance).
- **Stability:** 100-year balance runs across many seeds show no runaway growth or
  collapse unless an event explains it.
- **Determinism:** replaying a save from its seed and command log reproduces it
  exactly.
- **Explainability:** every headline indicator on the dashboard has a working "why did
  this change?" breakdown.
- **Coverage:** all ten domains (population, cities, institutions, economy,
  demographics, sports, education, infrastructure, elections, events) plus foreign
  relations, intelligence, and war are playable, and each produces at least one report.
