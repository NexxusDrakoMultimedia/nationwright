// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Player commands (DESIGN.md §3.4). Commands are validated when submitted, queued, and
 * applied at the `policy` step of the next tick. Every applied command is logged with
 * its tick so a world can be replayed exactly from its seed and log.
 */

import type { DeepReadonly } from './readonly.ts';
import type { WorldState } from './state.ts';

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type Validation<P> =
  { readonly ok: true; readonly payload: P } | { readonly ok: false; readonly reason: string };

export interface CommandSpec<P extends JsonValue = JsonValue> {
  /** Unique name, e.g. `economy/set-tax-rate`. */
  readonly type: string;
  validate(payload: JsonValue, world: DeepReadonly<WorldState>): Validation<P>;
  apply(world: WorldState, payload: P, tick: number): void;
}

export interface CommandLogEntry {
  /** Submission order, starting at 1. */
  readonly seq: number;
  /** The tick whose policy step applied the command. */
  readonly tick: number;
  readonly type: string;
  readonly payload: JsonValue;
}

export type SubmitResult =
  { readonly ok: true; readonly seq: number } | { readonly ok: false; readonly reason: string };

/** Deep-copies a payload through JSON, rejecting anything JSON can't represent. */
export function toJsonPayload(value: unknown): JsonValue {
  const text = JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new TypeError('Command payloads must not contain NaN or Infinity.');
    }
    if (typeof v === 'bigint' || typeof v === 'function' || typeof v === 'symbol') {
      throw new TypeError(`Command payloads must be JSON data; found a ${typeof v}.`);
    }
    return v;
  });
  if (text === undefined) throw new TypeError('Command payload must be JSON data.');
  return JSON.parse(text) as JsonValue;
}
