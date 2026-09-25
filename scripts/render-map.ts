// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Developer tool: renders a generated world to PNG for eyeballing the generator.
 *
 *   node scripts/render-map.ts <seed> <out.png> [--layer political|physical] [--width 1600]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { deflateSync } from 'node:zlib';
import {
  BIOME,
  defaultSettings,
  generateWorld,
  parseSeed,
  type GeneratedWorld,
  type GuidingVariables,
} from '../packages/engine/src/index.ts';

const BIOME_COLORS: Record<number, [number, number, number]> = {
  [BIOME.ocean]: [40, 80, 140],
  [BIOME.ice]: [235, 240, 245],
  [BIOME.tundra]: [170, 175, 150],
  [BIOME['boreal forest']]: [70, 110, 80],
  [BIOME['temperate forest']]: [80, 140, 70],
  [BIOME.grassland]: [160, 190, 100],
  [BIOME.desert]: [220, 200, 140],
  [BIOME.savanna]: [190, 180, 90],
  [BIOME['tropical forest']]: [40, 120, 50],
  [BIOME.mountains]: [130, 115, 100],
  [BIOME.wetlands]: [90, 130, 120],
};

export function renderWorld(world: GeneratedWorld, width: number, layer: string): Buffer {
  const { grid, terrain, owner, hydrology } = world.map;
  const height = Math.round(width / 2);
  // Nearest cell per pixel via a bucket grid over sites.
  const bx = 128;
  const by = 64;
  const buckets: number[][] = Array.from({ length: bx * by }, () => []);
  for (let i = 0; i < grid.count; i++) {
    const cx = Math.min(bx - 1, Math.floor((grid.x[i]! / grid.width) * bx));
    const cy = Math.min(by - 1, Math.floor((grid.y[i]! / grid.height) * by));
    buckets[cy * bx + cx]!.push(i);
  }
  const cellAt = new Int32Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x = ((px + 0.5) / width) * grid.width;
      const y = ((py + 0.5) / height) * grid.height;
      const cx = Math.floor((x / grid.width) * bx);
      const cy = Math.floor((y / grid.height) * by);
      let best = 0;
      let bestD = Infinity;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = cy + dy;
        if (yy < 0 || yy >= by) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = (cx + dx + bx) % bx;
          for (const i of buckets[yy * bx + xx]!) {
            let ddx = Math.abs(grid.x[i]! - x);
            if (ddx > grid.width / 2) ddx = grid.width - ddx;
            const d = ddx * ddx + (grid.y[i]! - y) * (grid.y[i]! - y);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
      cellAt[py * width + px] = best;
    }
  }
  const palette = world.countries.map((c) => {
    const h = (c.id * 0.61803398875) % 1;
    const base = [0, 1, 2].map((k) =>
      Math.round(150 + (90 * Math.abs(((h * 6 + k * 2) % 6) - 3)) / 3 - 20),
    );
    return base as [number, number, number];
  });
  const rgb = Buffer.alloc(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    const i = cellAt[p]!;
    let color: [number, number, number];
    if (terrain.land[i] === 0) {
      const depth = -terrain.elevation[i]!;
      color = [
        Math.round(40 - 20 * depth),
        Math.round(90 - 40 * depth),
        Math.round(160 - 50 * depth),
      ];
    } else if (layer === 'physical') {
      color = BIOME_COLORS[terrain.biome[i]!]!;
      if (hydrology.river[i] === 1) color = [60, 110, 200];
    } else {
      color = palette[owner[i]!]!;
      if (hydrology.river[i] === 1) color = [70, 120, 200];
    }
    // Borders: a pixel whose right or lower neighbour belongs to another country.
    const right = cellAt[p + 1];
    const down = cellAt[p + width];
    if (
      terrain.land[i] === 1 &&
      ((right !== undefined && owner[right] !== owner[i] && terrain.land[right] === 1) ||
        (down !== undefined && owner[down] !== owner[i] && terrain.land[down] === 1))
    ) {
      color = [30, 30, 30];
    }
    rgb.set(color, p * 3);
  }
  // Capitals and cities.
  for (const city of world.cities) {
    const px = Math.floor((grid.x[city.cell]! / grid.width) * width);
    const py = Math.floor((grid.y[city.cell]! / grid.height) * height);
    const r = city.capital ? 2 : 1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = (px + dx + width) % width;
        const y = py + dy;
        if (y >= 0 && y < height)
          rgb.set(city.capital ? [200, 20, 20] : [20, 20, 20], (y * width + x) * 3);
      }
    }
  }
  return png(width, height, rgb);
}

function png(width: number, height: number, rgb: Buffer): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { layer: { type: 'string' }, width: { type: 'string' } },
  });
  const [seedText, out] = positionals;
  if (seedText === undefined || out === undefined)
    throw new Error('usage: render-map.ts <seed> <out.png>');
  const parsed = parseSeed(seedText);
  if (!parsed.ok) throw new Error('invalid seed');
  const guiding = JSON.parse(
    readFileSync(
      new URL('../packages/reference-data/data/guiding-variables-2026.json', import.meta.url),
      'utf8',
    ),
  ) as GuidingVariables;
  const world = generateWorld(parsed.seed, defaultSettings(), guiding);
  writeFileSync(out, renderWorld(world, Number(values.width ?? 1600), values.layer ?? 'political'));
  console.log(`wrote ${out}`);
}
