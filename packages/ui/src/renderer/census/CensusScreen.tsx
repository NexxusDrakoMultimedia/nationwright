// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The census report (TODO M2): headline figures against the real-world range of states,
 * the population pyramid, education, culture, regions, and cities.
 */

import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import type { Census, CensusGroup, CensusStat } from '../../shared/protocol.ts';
import { people, percent, statValue } from './format.ts';
import { Pyramid } from './Pyramid.tsx';

const POSITION: Readonly<Record<NonNullable<CensusStat['position']>, string>> = {
  below: 'Below every real state',
  low: 'Low for a real state',
  typical: 'Typical',
  high: 'High for a real state',
  above: 'Above every real state',
};

/**
 * Where the value sits among real states: the full range (min–max) as a light track, the
 * middle 80% (10th–90th percentile) darker, the median as a tick, and the value as a dot.
 */
function RangeStrip({ stat }: { readonly stat: CensusStat }) {
  const band = stat.band;
  if (band === null || stat.value === null) return null;
  // Population spans six orders of magnitude: place it on a log scale.
  const log = stat.id === 'population.total';
  const t = (v: number) => (log ? Math.log10(Math.max(1, v)) : v);
  const lo = Math.min(t(band.min), t(stat.value));
  const hi = Math.max(t(band.max), t(stat.value));
  const x = (v: number) => (hi > lo ? (100 * (t(v) - lo)) / (hi - lo) : 50);
  return (
    <svg className="range-strip" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
      <rect
        className="track"
        x={x(band.min)}
        y={5}
        width={Math.max(0.5, x(band.max) - x(band.min))}
        height={2}
        rx={1}
      />
      <rect
        className="middle"
        x={x(band.p10)}
        y={4}
        width={Math.max(0.5, x(band.p90) - x(band.p10))}
        height={4}
        rx={2}
      />
      <rect className="median" x={x(band.p50) - 0.3} y={2} width={0.6} height={8} />
      <circle className="marker" cx={x(stat.value)} cy={6} r={3.2} />
    </svg>
  );
}

function StatTile({ stat }: { readonly stat: CensusStat }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{stat.label}</div>
      <div className="stat-value">
        {stat.value === null ? '—' : statValue(stat.id, stat.value)}
        <span className="stat-unit"> {stat.unit}</span>
      </div>
      <RangeStrip stat={stat} />
      <div className="stat-note">
        {stat.value === null
          ? 'After the first full year'
          : stat.position === null
            ? ''
            : `${POSITION[stat.position]}${
                stat.band === null
                  ? ''
                  : ` · real states ${statValue(stat.id, stat.band.p10)}–${statValue(stat.id, stat.band.p90)}`
              }`}
      </div>
    </div>
  );
}

function Groups({
  title,
  groups,
}: {
  readonly title: string;
  readonly groups: readonly CensusGroup[];
}) {
  const shown = groups.slice(0, 6);
  const rest = groups.slice(6);
  const other = rest.reduce((s, g) => s + g.people, 0);
  const otherShare = rest.reduce((s, g) => s + g.share, 0);
  return (
    <table className="data">
      <thead>
        <tr>
          <th>{title}</th>
          <th>People</th>
          <th>Share</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((g) => (
          <tr key={g.name}>
            <td>{g.name}</td>
            <td>{people(g.people)}</td>
            <td>{percent(g.share)}</td>
          </tr>
        ))}
        {rest.length > 0 && (
          <tr>
            <td>Other ({rest.length})</td>
            <td>{people(other)}</td>
            <td>{percent(otherShare)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function CensusScreen({ month }: { readonly month: number }) {
  const [census, setCensus] = useState<Census | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .request('world.census', null)
      .then((c) => {
        if (!cancelled) setCensus(c);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  if (error !== null) return <p className="error">{error}</p>;
  if (census === null) return <p className="busy">Counting everyone…</p>;
  return (
    <div className="census">
      <h3>
        Census of {census.country} · {census.date}
      </h3>
      <div className="stat-grid">
        {census.stats.map((s) => (
          <StatTile key={s.id} stat={s} />
        ))}
      </div>
      <p className="hint">
        Strips show real states in 2026: full range, middle 80% (darker), median (tick), and this
        nation (dot).
      </p>
      <div className="census-columns">
        <Pyramid pyramid={census.pyramid} />
        <div>
          <table className="data">
            <thead>
              <tr>
                <th>Education</th>
                <th>Aged 15+</th>
                <th>Aged 25+</th>
              </tr>
            </thead>
            <tbody>
              {census.education.map((e) => (
                <tr key={e.level}>
                  <td className="capitalize">{e.level}</td>
                  <td>{percent(e.age15)}</td>
                  <td>{percent(e.age25)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Groups title="Ethnic group" groups={census.ethnicGroups} />
          <Groups title="Religion" groups={census.religions} />
          <Groups title="Language" groups={census.languages} />
        </div>
      </div>
      <table className="data wide">
        <thead>
          <tr>
            <th>Region</th>
            <th>People</th>
            <th>Urban</th>
            <th>Median age</th>
            <th>Schooled 15+</th>
            <th>Net moves, last 12 months</th>
          </tr>
        </thead>
        <tbody>
          {census.regions.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{people(r.population)}</td>
              <td>{percent(r.urbanShare)}</td>
              <td>{r.medianAge.toFixed(1)}</td>
              <td>{percent(r.schooling)}</td>
              <td>{people(r.netInternalMigration)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="data wide">
        <thead>
          <tr>
            <th>City</th>
            <th>Region</th>
            <th>People</th>
          </tr>
        </thead>
        <tbody>
          {census.cities.slice(0, 20).map((c) => (
            <tr key={c.name}>
              <td>
                {c.name}
                {c.capital ? ' (capital)' : ''}
              </td>
              <td>{c.region}</td>
              <td>{people(c.population)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
