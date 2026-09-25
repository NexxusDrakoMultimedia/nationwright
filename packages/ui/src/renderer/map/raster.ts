// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The map is drawn from a one-time raster of cell ids (nearest site per pixel, wrapping
 * east–west), so switching layers only recolours pixels.
 */

import { Delaunay } from 'd3-delaunay';
import type { MapData } from '../../shared/protocol.ts';

export interface CellRaster {
  readonly width: number;
  readonly height: number;
  /** Cell id for each pixel, row-major. */
  readonly cells: Int32Array;
  readonly find: (x: number, y: number) => number;
}

export function buildRaster(map: MapData, width: number): CellRaster {
  const height = Math.round((width * map.height) / map.width);
  // Ghost copies of sites near the seam so lookups wrap.
  const margin = map.width * 0.05;
  const points: number[] = [];
  const owner: number[] = [];
  for (let i = 0; i < map.count; i++) {
    points.push(map.x[i] as number, map.y[i] as number);
    owner.push(i);
  }
  for (let i = 0; i < map.count; i++) {
    const x = map.x[i] as number;
    if (x < margin) {
      points.push(x + map.width, map.y[i] as number);
      owner.push(i);
    } else if (x > map.width - margin) {
      points.push(x - map.width, map.y[i] as number);
      owner.push(i);
    }
  }
  const delaunay = new Delaunay(Float64Array.from(points));
  const cells = new Int32Array(width * height);
  let hint = 0;
  for (let py = 0; py < height; py++) {
    const y = ((py + 0.5) / height) * map.height;
    for (let px = 0; px < width; px++) {
      const x = ((px + 0.5) / width) * map.width;
      hint = delaunay.find(x, y, hint);
      cells[py * width + px] = owner[hint] as number;
    }
  }
  const find = (x: number, y: number) => {
    const wrapped = ((x % map.width) + map.width) % map.width;
    return owner[delaunay.find(wrapped, Math.max(0, Math.min(map.height, y)))] as number;
  };
  return { width, height, cells, find };
}
