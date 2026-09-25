// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/** The chronicle: the ordered, dated history of a world (DESIGN.md §2, §7). */

import type { Scope } from './scope.ts';

export interface ChronicleEntry {
  readonly tick: number;
  /** e.g. 'politics', 'war', 'sport', 'milestone'. */
  readonly category: string;
  readonly text: string;
  /** Entities or places the entry refers to. */
  readonly refs: readonly Scope[];
}
