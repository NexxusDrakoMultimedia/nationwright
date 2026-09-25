// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

import type { MapData } from '../../shared/protocol.ts';
import {
  BIOME_COLORS,
  BORDER,
  mix,
  NO_DATA,
  OCEAN_DEEP,
  OCEAN_SHALLOW,
  POLITICAL,
  RIVER,
  SELECTED_BORDER,
  type RGB,
} from './colors.ts';
import type { CellRaster } from './raster.ts';

export type Layer = 'political' | 'physical' | 'data';

export interface PaintOptions {
  readonly layer: Layer;
  readonly politicalColor: readonly number[];
  /** For the data layer: colour of each country (or, per cell, via cellColor). */
  readonly countryColor?: readonly (RGB | null)[];
  readonly cellColor?: (cell: number) => RGB | null;
  readonly selected: number | null;
  /** Water colour override: the statistics layer uses a neutral surface so data stands out. */
  readonly water?: RGB;
}

const WHITE: RGB = [255, 255, 255];

/** Paints the base image for one layer onto an RGBA buffer. */
export function paint(map: MapData, raster: CellRaster, options: PaintOptions): ImageData {
  const { width, height, cells } = raster;
  const image = new ImageData(width, height);
  const data = image.data;
  const ownerAt = (p: number) => {
    const c = cells[p] as number;
    return map.land[c] === 1 ? (map.owner[c] as number) : -1;
  };
  for (let p = 0; p < width * height; p++) {
    const cell = cells[p] as number;
    let color: RGB;
    const owner = map.owner[cell] as number;
    if (map.land[cell] === 0 || map.lake[cell] === 1) {
      const depth =
        map.land[cell] === 0 ? Math.min(1, -(map.elevation[cell] as number) * 1.6) : 0.1;
      color = options.water ?? mix(OCEAN_SHALLOW, OCEAN_DEEP, depth);
    } else {
      if (options.layer === 'physical') {
        color = BIOME_COLORS[map.biome[cell] as number] ?? NO_DATA;
        color = mix(color, [60, 50, 40], Math.min(0.35, (map.elevation[cell] as number) * 0.4));
      } else if (options.layer === 'data') {
        color =
          (options.cellColor ? options.cellColor(cell) : options.countryColor?.[owner]) ?? NO_DATA;
      } else {
        color = POLITICAL[options.politicalColor[owner] ?? 0] ?? NO_DATA;
        if (owner === options.selected) color = mix(color, WHITE, 0.35);
      }
      if (map.river[cell] === 1 && options.layer !== 'data') color = RIVER;
      // Borders between countries (checked against the right and lower pixels).
      const x = p % width;
      const right = x + 1 < width ? ownerAt(p + 1) : -1;
      const down = p + width < width * height ? ownerAt(p + width) : -1;
      const left = x > 0 ? ownerAt(p - 1) : -1;
      const up = p >= width ? ownerAt(p - width) : -1;
      const borders = [right, down].some((o) => o >= 0 && o !== owner);
      const selectedEdge =
        options.selected !== null &&
        (owner === options.selected
          ? [right, down, left, up].some((o) => o !== owner)
          : [right, down, left, up].some((o) => o === options.selected));
      if (selectedEdge) color = SELECTED_BORDER;
      else if (borders) color = BORDER;
    }
    const k = p * 4;
    data[k] = color[0];
    data[k + 1] = color[1];
    data[k + 2] = color[2];
    data[k + 3] = 255;
  }
  return image;
}
