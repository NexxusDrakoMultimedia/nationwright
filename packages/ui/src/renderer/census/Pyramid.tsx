// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Population pyramid: women left, men right, by 5-year age band. Hover a row for exact
 * numbers; the table view shows every value.
 */

import { useState } from 'react';
import type { Census } from '../../shared/protocol.ts';
import { compact, people, percent } from './format.ts';

const ROW = 18;
const GAP = 2;
const LABEL = 56;
const SIDE = 260;
const TOP = 28;
const AXIS = 24;
/** Side padding so the outermost tick labels fit. */
const PAD = 22;
const RADIUS = 4;

/** A bar with its outer end rounded (the end away from the centre axis). */
function bar(x: number, y: number, width: number, height: number, outerLeft: boolean): string {
  const r = Math.min(RADIUS, width, height / 2);
  if (width <= 0) return '';
  if (outerLeft) {
    return `M${x + width},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + height - r}Q${x},${y + height} ${x + r},${y + height}H${x + width}Z`;
  }
  return `M${x},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height - r}Q${x + width},${y + height} ${x + width - r},${y + height}H${x}Z`;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function Pyramid({ pyramid }: { readonly pyramid: Census['pyramid'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const total = pyramid.reduce((s, b) => s + b.female + b.male, 0);
  const max = niceMax(Math.max(1, ...pyramid.map((b) => Math.max(b.female, b.male))));
  const rows = [...pyramid].reverse();
  const width = 2 * SIDE + LABEL + 2 * PAD;
  const height = TOP + rows.length * ROW + AXIS;
  const cx = PAD + SIDE + LABEL / 2;
  const scale = (n: number) => (SIDE * n) / max;
  const ticks = [0, max / 2, max];
  const hovered = hover === null ? null : rows[hover];

  return (
    <figure className="pyramid viz-root">
      <div className="viz-head">
        <figcaption>Population by age and sex</figcaption>
        <div className="legend" aria-hidden="true">
          <span className="key female" /> Women <span className="key male" /> Men
        </div>
        <button type="button" className="link" onClick={() => setTable((t) => !t)}>
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <table className="data">
          <thead>
            <tr>
              <th>Age</th>
              <th>Women</th>
              <th>Men</th>
              <th>Share of all</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.band}>
                <td>{b.band}</td>
                <td>{people(b.female)}</td>
                <td>{people(b.male)}</td>
                <td>{percent(total > 0 ? (b.female + b.male) / total : 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="viz-frame">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Population pyramid: women left, men right, by five-year age band"
            onMouseLeave={() => setHover(null)}
          >
            <text className="side-label" x={cx - LABEL / 2 - 4} y={16} textAnchor="end">
              Women
            </text>
            <text className="side-label" x={cx + LABEL / 2 + 4} y={16}>
              Men
            </text>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  className="grid"
                  x1={cx - LABEL / 2 - scale(t)}
                  x2={cx - LABEL / 2 - scale(t)}
                  y1={TOP}
                  y2={height - AXIS}
                />
                <line
                  className="grid"
                  x1={cx + LABEL / 2 + scale(t)}
                  x2={cx + LABEL / 2 + scale(t)}
                  y1={TOP}
                  y2={height - AXIS}
                />
                <text
                  className="tick"
                  x={cx - LABEL / 2 - scale(t)}
                  y={height - 8}
                  textAnchor="middle"
                >
                  {compact(t)}
                </text>
                <text
                  className="tick"
                  x={cx + LABEL / 2 + scale(t)}
                  y={height - 8}
                  textAnchor="middle"
                >
                  {compact(t)}
                </text>
              </g>
            ))}
            {rows.map((b, i) => {
              const y = TOP + i * ROW + GAP / 2;
              const h = ROW - GAP;
              const f = scale(b.female);
              const m = scale(b.male);
              return (
                <g key={b.band} className={hover === i ? 'row hovered' : 'row'}>
                  <rect
                    className="hit"
                    x={0}
                    y={TOP + i * ROW}
                    width={width}
                    height={ROW}
                    onMouseEnter={() => setHover(i)}
                  />
                  <path className="female" d={bar(cx - LABEL / 2 - f, y, f, h, true)} />
                  <path className="male" d={bar(cx + LABEL / 2, y, m, h, false)} />
                  <text className="band" x={cx} y={y + h / 2 + 4} textAnchor="middle">
                    {b.band}
                  </text>
                </g>
              );
            })}
          </svg>
          {hovered !== null && hovered !== undefined && hover !== null && (
            <div
              className="tooltip"
              style={{ top: `${((TOP + hover * ROW) / height) * 100}%`, left: '84%' }}
              role="status"
            >
              <strong>Aged {hovered.band}</strong>
              <span>Women {people(hovered.female)}</span>
              <span>Men {people(hovered.male)}</span>
              <span>
                {percent(total > 0 ? (hovered.female + hovered.male) / total : 0)} of everyone
              </span>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
