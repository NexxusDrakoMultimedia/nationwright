// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapData } from '../../shared/protocol.ts';
import { paint, type PaintOptions } from './paint.ts';
import type { CellRaster } from './raster.ts';

export interface HoverInfo {
  readonly country: number | null;
  readonly cell: number;
  readonly x: number;
  readonly y: number;
}

interface Props {
  readonly map: MapData;
  readonly raster: CellRaster;
  readonly paintOptions: PaintOptions;
  readonly onSelect: (country: number | null) => void;
  readonly onHover: (info: HoverInfo | null) => void;
  /** Screen-reader description of what the map shows. */
  readonly label: string;
}

interface View {
  cx: number;
  cy: number;
  zoom: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 24;

export function MapView({ map, raster, paintOptions, onSelect, onHover, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 400, dpr: 1 });
  const [view, setView] = useState<View>({ cx: raster.width / 2, cy: raster.height / 2, zoom: 1 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(
    null,
  );

  // Base image for the current layer.
  const base = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = raster.width;
    canvas.height = raster.height;
    canvas.getContext('2d')?.putImageData(paint(map, raster, paintOptions), 0, 0);
    return canvas;
  }, [map, raster, paintOptions]);

  // Pixel counts per country, for deciding which labels fit.
  const countryPixels = useMemo(() => {
    const counts = new Array<number>(map.countries.length).fill(0);
    for (const cell of raster.cells) {
      const owner = map.owner[cell] as number;
      if (owner >= 0 && map.land[cell] === 1) counts[owner] = (counts[owner] ?? 0) + 1;
    }
    return counts;
  }, [map, raster]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const dpr = window.devicePixelRatio || 1;
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height, dpr });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const scale = (size.w / raster.width) * view.zoom;
  const clampView = useCallback(
    (v: View): View => {
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom));
      const s = (size.w / raster.width) * zoom;
      const halfH = size.h / 2 / s;
      const cy =
        raster.height <= 2 * halfH
          ? raster.height / 2
          : Math.max(halfH, Math.min(raster.height - halfH, v.cy));
      const cx = ((v.cx % raster.width) + raster.width) % raster.width;
      return { cx, cy, zoom };
    },
    [size, raster],
  );

  const toBase = useCallback(
    (sx: number, sy: number) => ({
      bx: (sx - size.w / 2) / scale + view.cx,
      by: (sy - size.h / 2) / scale + view.cy,
    }),
    [size, scale, view],
  );

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = Math.round(size.w * size.dpr);
    canvas.height = Math.round(size.h * size.dpr);
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.imageSmoothingEnabled = scale < 2;
    const styles = getComputedStyle(canvas);
    ctx.fillStyle = styles.getPropertyValue('--map-ocean').trim() || '#3f6f9a';
    ctx.fillRect(0, 0, size.w, size.h);
    const originX = size.w / 2 - view.cx * scale;
    const originY = size.h / 2 - view.cy * scale;
    const tile = raster.width * scale;
    const first = Math.floor(-originX / tile) - 1;
    for (let k = first; originX + k * tile < size.w; k++) {
      ctx.drawImage(base, originX + k * tile, originY, tile, raster.height * scale);
    }

    // Place a base-image point on screen, using the copy nearest the view centre.
    const toScreen = (cell: number) => {
      let bx = ((map.x[cell] as number) / map.width) * raster.width;
      const by = ((map.y[cell] as number) / map.height) * raster.height;
      bx += Math.round((view.cx - bx) / raster.width) * raster.width;
      return { sx: originX + bx * scale, sy: originY + by * scale };
    };
    const ink = styles.getPropertyValue('--text').trim() || '#1d1d1b';
    const halo = styles.getPropertyValue('--panel').trim() || '#ffffff';
    const text = (value: string, sx: number, sy: number, font: string) => {
      ctx.font = font;
      ctx.lineWidth = 3;
      ctx.strokeStyle = halo;
      ctx.strokeText(value, sx, sy);
      ctx.fillStyle = ink;
      ctx.fillText(value, sx, sy);
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Cities: capitals always; other cities from zoom 3; names when there's room.
    for (const city of map.cities) {
      if (!city.capital && view.zoom < 3) continue;
      const { sx, sy } = toScreen(city.cell);
      if (sx < -40 || sx > size.w + 40 || sy < -20 || sy > size.h + 20) continue;
      ctx.fillStyle = city.capital ? '#b3261e' : ink;
      const r = city.capital ? 3 : 2;
      ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r);
      if ((city.capital && view.zoom >= 4) || view.zoom >= 8)
        text(city.name, sx, sy + 11, '11px system-ui, sans-serif');
    }
    // Country names where the country is big enough on screen.
    for (const country of map.countries) {
      const area = (countryPixels[country.id] ?? 0) * scale * scale;
      if (area < 2500) continue;
      const { sx, sy } = toScreen(country.capitalCell);
      if (sx < -80 || sx > size.w + 80 || sy < -20 || sy > size.h + 20) continue;
      text(country.name, sx, sy - 12, `600 ${area > 20000 ? 14 : 12}px system-ui, sans-serif`);
    }
  }, [base, size, view, scale, raster, map, countryPixels]);

  const hitTest = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const { bx, by } = toBase(clientX - rect.left, clientY - rect.top);
    if (by < 0 || by > raster.height) return null;
    const cell = raster.find((bx / raster.width) * map.width, (by / raster.height) * map.height);
    const owner = map.land[cell] === 1 ? (map.owner[cell] as number) : -1;
    return {
      cell,
      country: owner >= 0 ? owner : null,
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  return (
    <canvas
      ref={canvasRef}
      className="map-canvas"
      role="img"
      aria-label={label}
      tabIndex={0}
      onPointerDown={(e) => {
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d !== null) {
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
          if (d.moved)
            setView(clampView({ cx: d.cx - dx / scale, cy: d.cy - dy / scale, zoom: view.zoom }));
          return;
        }
        onHover(hitTest(e.clientX, e.clientY));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d !== null && !d.moved) onSelect(hitTest(e.clientX, e.clientY)?.country ?? null);
      }}
      onPointerLeave={() => onHover(null)}
      onWheel={(e) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const { bx, by } = toBase(sx, sy);
        const zoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, view.zoom * Math.exp(-e.deltaY * 0.0015)),
        );
        const s = (size.w / raster.width) * zoom;
        setView(
          clampView({ cx: bx - (sx - size.w / 2) / s, cy: by - (sy - size.h / 2) / s, zoom }),
        );
      }}
      onKeyDown={(e) => {
        const step = 80 / scale;
        const moves: Record<string, Partial<View>> = {
          ArrowLeft: { cx: view.cx - step },
          ArrowRight: { cx: view.cx + step },
          ArrowUp: { cy: view.cy - step },
          ArrowDown: { cy: view.cy + step },
          '+': { zoom: view.zoom * 1.5 },
          '=': { zoom: view.zoom * 1.5 },
          '-': { zoom: view.zoom / 1.5 },
          '0': { zoom: 1 },
        };
        const move = moves[e.key];
        if (move === undefined) return;
        e.preventDefault();
        setView(clampView({ ...view, ...move }));
      }}
    />
  );
}
