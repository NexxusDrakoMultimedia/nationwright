// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { useEffect, useMemo, useState } from 'react';
import type { MapCountry, MapData } from '../../shared/protocol.ts';
import {
  BIOME_COLORS,
  BIOME_NAMES,
  NO_DATA,
  politicalColors,
  sequentialFor,
  WATER_NEUTRAL_DARK,
  WATER_NEUTRAL_LIGHT,
  type RGB,
} from './colors.ts';
import { binOf, compact, INDICATORS, quantileBreaks, whole, type Indicator } from './indicators.ts';
import { MapView, type HoverInfo } from './MapView.tsx';
import type { Layer, PaintOptions } from './paint.ts';
import { buildRaster } from './raster.ts';

const RASTER_WIDTH = 2400;

function usePrefersDark(): boolean {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => setDark(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  return dark;
}

const css = (c: RGB) => `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;

export function MapScreen({ map }: { readonly map: MapData }) {
  const raster = useMemo(() => buildRaster(map, RASTER_WIDTH), [map]);
  const [layer, setLayer] = useState<Layer>('political');
  const [indicatorId, setIndicatorId] = useState(INDICATORS[0]?.id ?? 'density');
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [showTable, setShowTable] = useState(false);
  const dark = usePrefersDark();
  const indicator = INDICATORS.find((i) => i.id === indicatorId) as Indicator;
  const ramp = sequentialFor(dark);

  const political = useMemo(() => politicalColors(map.countries.map((c) => c.neighbors)), [map]);
  const breaks = useMemo(() => {
    if (indicator.perCell) {
      const values: number[] = [];
      // Inhabited cells only: empty ice and desert would collapse the lowest bins to zero.
      for (let c = 0; c < map.count; c++) {
        if (map.land[c] !== 1) continue;
        const v = indicator.perCell(map, c);
        if (v > 0.01) values.push(v);
      }
      return quantileBreaks(values);
    }
    return quantileBreaks(map.countries.map((c) => indicator.value?.(c) ?? Number.NaN));
  }, [map, indicator]);

  const paintOptions: PaintOptions = useMemo(() => {
    const colorFor = (v: number) => {
      const bin = binOf(breaks, v);
      return bin < 0 ? null : (ramp[bin] ?? null);
    };
    return {
      layer,
      politicalColor: political,
      selected,
      ...(layer === 'data' ? { water: dark ? WATER_NEUTRAL_DARK : WATER_NEUTRAL_LIGHT } : {}),
      ...(indicator.perCell
        ? { cellColor: (cell: number) => colorFor(indicator.perCell?.(map, cell) ?? Number.NaN) }
        : { countryColor: map.countries.map((c) => colorFor(indicator.value?.(c) ?? Number.NaN)) }),
    };
  }, [layer, political, selected, indicator, breaks, ramp, map, dark]);

  const hovered =
    hover?.country === null || hover === null ? null : (map.countries[hover.country] ?? null);
  const hoverValue =
    hover === null
      ? null
      : indicator.perCell
        ? indicator.perCell(map, hover.cell)
        : hovered !== null
          ? (indicator.value?.(hovered) ?? Number.NaN)
          : null;
  const selectedCountry = selected === null ? null : (map.countries[selected] ?? null);
  const biomesPresent = useMemo(() => {
    const seen = new Set<number>();
    for (let c = 0; c < map.count; c++) if (map.land[c] === 1) seen.add(map.biome[c] as number);
    return seen;
  }, [map]);

  return (
    <div className="map-screen">
      <div className="map-toolbar" role="toolbar" aria-label="Map layers">
        <div className="segmented" role="radiogroup" aria-label="Layer">
          {(['political', 'physical', 'data'] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={layer === l}
              className={layer === l ? 'on' : ''}
              onClick={() => setLayer(l)}
            >
              {l === 'political' ? 'Political' : l === 'physical' ? 'Physical' : 'Statistics'}
            </button>
          ))}
        </div>
        {layer === 'data' && (
          <label className="indicator">
            <span className="visually-hidden">Indicator</span>
            <select value={indicatorId} onChange={(e) => setIndicatorId(e.target.value)}>
              {INDICATORS.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? 'Hide table' : 'Table'}
        </button>
      </div>

      <div className="map-body">
        <div className="map-stage">
          <MapView
            map={map}
            raster={raster}
            paintOptions={paintOptions}
            onSelect={setSelected}
            onHover={setHover}
            label={`World map, ${layer === 'data' ? indicator.label : layer} layer, ${map.countries.length} countries. Drag to pan, scroll or +/− to zoom, click a country for details.`}
          />
          {hover !== null && (hovered !== null || layer === 'data') && (
            <div className="map-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
              {hovered !== null && <strong>{hovered.name}</strong>}
              {layer === 'data' && hoverValue !== null && (
                <span>
                  {indicator.label}:{' '}
                  {Number.isFinite(hoverValue) ? indicator.format(hoverValue) : 'no data'}
                </span>
              )}
            </div>
          )}
          <Legend
            layer={layer}
            indicator={indicator}
            breaks={breaks}
            ramp={ramp}
            biomes={biomesPresent}
          />
        </div>
        {selectedCountry !== null && (
          <CountryPanel
            country={selectedCountry}
            map={map}
            onClose={() => setSelected(null)}
            onSelect={setSelected}
          />
        )}
      </div>

      {showTable && (
        <CountryTable map={map} indicator={indicator} selected={selected} onSelect={setSelected} />
      )}
    </div>
  );
}

function Legend({
  layer,
  indicator,
  breaks,
  ramp,
  biomes,
}: {
  layer: Layer;
  indicator: Indicator;
  breaks: readonly number[];
  ramp: readonly RGB[];
  biomes: ReadonlySet<number>;
}) {
  if (layer === 'political') {
    return (
      <div className="map-legend">
        <p className="legend-note">
          Colours only separate neighbours. Hover or click a country for its name and details.
        </p>
      </div>
    );
  }
  if (layer === 'physical') {
    return (
      <div className="map-legend">
        <ul className="legend-swatches">
          {BIOME_NAMES.map((name, i) =>
            i === 0 || !biomes.has(i) ? null : (
              <li key={name}>
                <span className="swatch" style={{ background: css(BIOME_COLORS[i] as RGB) }} />
                {name}
              </li>
            ),
          )}
        </ul>
      </div>
    );
  }
  const bounds = ['', ...breaks.map((b) => indicator.format(b)), ''];
  return (
    <div className="map-legend">
      <p className="legend-title">
        {indicator.label}{' '}
        <span className="legend-unit">({indicator.unit}, 7 equal-count groups)</span>
      </p>
      <ol className="legend-ramp">
        {ramp.map((c, i) => (
          <li key={i}>
            <span className="swatch" style={{ background: css(c) }} />
            <span className="legend-range">
              {i === 0
                ? `< ${bounds[1]}`
                : i === ramp.length - 1
                  ? `≥ ${bounds[i]}`
                  : `${bounds[i]}–${bounds[i + 1]}`}
            </span>
          </li>
        ))}
        <li>
          <span className="swatch" style={{ background: css(NO_DATA) }} />
          <span className="legend-range">No data</span>
        </li>
      </ol>
    </div>
  );
}

function share(groups: readonly (readonly [string, number])[]): string {
  return groups.map(([name, s]) => `${name} ${whole.format(s * 100)}%`).join(', ');
}

function CountryPanel({
  country,
  map,
  onClose,
  onSelect,
}: {
  country: MapCountry;
  map: MapData;
  onClose: () => void;
  onSelect: (id: number) => void;
}) {
  const s = country.stats;
  const f = (id: string, format: (v: number) => string) => {
    const v = s[id];
    return v === undefined || !Number.isFinite(v) ? '—' : format(v);
  };
  return (
    <aside className="country-panel" aria-label={`${country.name} profile`}>
      <header>
        <h3>{country.name}</h3>
        <button type="button" onClick={onClose} aria-label="Close profile">
          ×
        </button>
      </header>
      <p className="hint">
        {country.archetype}
        {country.island ? ' · island nation' : country.landlocked ? ' · landlocked' : ''}
      </p>
      <dl className="facts">
        <dt>Capital</dt>
        <dd>{country.capital}</dd>
        <dt>Government</dt>
        <dd>{country.government}</dd>
        <dt>Population</dt>
        <dd>{f('population.total', (v) => compact.format(v))}</dd>
        <dt>Area</dt>
        <dd>{compact.format(country.areaKm2)} km²</dd>
        <dt>GDP per capita</dt>
        <dd>{f('economy.gdp_per_capita_ppp', (v) => `$${compact.format(v)}`)}</dd>
        <dt>Life expectancy</dt>
        <dd>{f('population.life_expectancy', (v) => `${v.toFixed(1)} years`)}</dd>
        <dt>Fertility</dt>
        <dd>{f('population.tfr', (v) => v.toFixed(2))}</dd>
        <dt>Urban</dt>
        <dd>{f('population.urban_share', (v) => `${whole.format(v)}%`)}</dd>
        <dt>People</dt>
        <dd>{share(country.ethnicGroups)}</dd>
        <dt>Faiths</dt>
        <dd>{share(country.religions)}</dd>
        <dt>Languages</dt>
        <dd>{share(country.languages)}</dd>
        <dt>Neighbours</dt>
        <dd>
          {country.neighbors.length === 0
            ? 'none (island)'
            : country.neighbors.map((id, i) => (
                <span key={id}>
                  {i > 0 && ', '}
                  <button type="button" className="link" onClick={() => onSelect(id)}>
                    {map.countries[id]?.name ?? id}
                  </button>
                </span>
              ))}
        </dd>
      </dl>
    </aside>
  );
}

function CountryTable({
  map,
  indicator,
  selected,
  onSelect,
}: {
  map: MapData;
  indicator: Indicator;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const [sort, setSort] = useState<'name' | 'value'>('value');
  const column: Indicator = indicator.value
    ? indicator
    : (INDICATORS.find((i) => i.id === 'population.total') as Indicator);
  const rows = [...map.countries].sort((a, b) =>
    sort === 'name'
      ? a.name.localeCompare(b.name)
      : (column.value?.(b) ?? -Infinity) - (column.value?.(a) ?? -Infinity) || a.id - b.id,
  );
  return (
    <div className="country-table">
      <table>
        <caption>
          {map.countries.length} countries by {column.label.toLowerCase()} ({column.unit})
        </caption>
        <thead>
          <tr>
            <th scope="col" aria-sort={sort === 'name' ? 'ascending' : 'none'}>
              <button type="button" className="link" onClick={() => setSort('name')}>
                Country
              </button>
            </th>
            <th scope="col">Type</th>
            <th scope="col" className="num" aria-sort={sort === 'value' ? 'descending' : 'none'}>
              <button type="button" className="link" onClick={() => setSort('value')}>
                {column.label}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const v = column.value?.(c) ?? Number.NaN;
            return (
              <tr key={c.id} className={c.id === selected ? 'selected' : ''}>
                <td>
                  <button type="button" className="link" onClick={() => onSelect(c.id)}>
                    {c.name}
                  </button>
                </td>
                <td>{c.archetype}</td>
                <td className="num">{Number.isFinite(v) ? column.format(v) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
