// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Indicator registry and in-memory time-series store (DESIGN.md §6.2). Persistence to
 * SQLite lives in the application layer; the engine only records and serves series.
 */

import type { SystemId } from './pipeline.ts';
import { assertScope, type Scope } from './scope.ts';

export type Aggregation = 'sum' | 'mean' | 'last';

export interface IndicatorDefinition {
  /** Dotted id, e.g. `population.total`. */
  readonly id: string;
  readonly unit: string;
  readonly description: string;
  /** How to combine monthly values into coarser periods. */
  readonly aggregation: Aggregation;
  readonly owner: SystemId;
}

export interface IndicatorSeriesDump {
  readonly id: string;
  readonly scope: Scope;
  readonly ticks: readonly number[];
  readonly values: readonly number[];
}

export interface Series {
  readonly ticks: readonly number[];
  readonly values: readonly number[];
}

const ID_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

export class IndicatorStore {
  readonly #definitions = new Map<string, IndicatorDefinition>();
  readonly #series = new Map<string, { ticks: number[]; values: number[] }>();

  register(definition: IndicatorDefinition): void {
    if (!ID_PATTERN.test(definition.id)) {
      throw new RangeError(`Invalid indicator id "${definition.id}".`);
    }
    if (this.#definitions.has(definition.id)) {
      throw new Error(`Indicator "${definition.id}" is already registered.`);
    }
    this.#definitions.set(definition.id, definition);
  }

  definition(id: string): IndicatorDefinition | undefined {
    return this.#definitions.get(id);
  }

  /** All definitions, sorted by id. */
  definitions(): IndicatorDefinition[] {
    return [...this.#definitions.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  record(id: string, scope: Scope, tick: number, value: number, recorder?: SystemId): void {
    const definition = this.#definitions.get(id);
    if (definition === undefined) throw new Error(`Indicator "${id}" is not registered.`);
    if (recorder !== undefined && recorder !== definition.owner) {
      throw new Error(`Indicator "${id}" is owned by ${definition.owner}, not ${recorder}.`);
    }
    assertScope(scope);
    if (!Number.isFinite(value)) {
      throw new RangeError(`Indicator "${id}" (${scope}) got a non-finite value: ${value}.`);
    }
    const key = seriesKey(id, scope);
    let series = this.#series.get(key);
    if (series === undefined) {
      series = { ticks: [], values: [] };
      this.#series.set(key, series);
    }
    const last = series.ticks.at(-1);
    if (last !== undefined && tick <= last) {
      throw new Error(`Indicator "${id}" (${scope}) already has a value at or after tick ${tick}.`);
    }
    series.ticks.push(tick);
    series.values.push(value);
  }

  /** Loads saved series into an empty store. Every indicator must already be registered. */
  restore(series: readonly IndicatorSeriesDump[]): void {
    if (this.#series.size > 0) throw new Error('Can only restore into an empty indicator store.');
    for (const s of series) {
      if (!this.#definitions.has(s.id)) {
        throw new Error(`Saved indicator "${s.id}" is not registered by any system.`);
      }
      assertScope(s.scope);
      if (s.ticks.length !== s.values.length) {
        throw new Error(`Saved indicator "${s.id}" (${s.scope}) has mismatched ticks and values.`);
      }
      this.#series.set(seriesKey(s.id, s.scope), { ticks: [...s.ticks], values: [...s.values] });
    }
  }

  series(id: string, scope: Scope): Series {
    return this.#series.get(seriesKey(id, scope)) ?? { ticks: [], values: [] };
  }

  latest(id: string, scope: Scope): number | undefined {
    return this.#series.get(seriesKey(id, scope))?.values.at(-1);
  }

  /** Every recorded series as plain data, sorted by key, for snapshots and comparisons. */
  dump(): IndicatorSeriesDump[] {
    return [...this.#series.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, s]) => {
        const [id = '', scope = 'nation'] = key.split('|');
        return { id, scope: scope as Scope, ticks: [...s.ticks], values: [...s.values] };
      });
  }
}

function seriesKey(id: string, scope: Scope): string {
  return `${id}|${scope}`;
}
