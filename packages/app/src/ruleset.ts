// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * The ruleset: every system and command the game runs with. Saves record its version,
 * and a save only resumes under the same ruleset version (migrate otherwise).
 * Systems are added here as they are built.
 */

import { RULESET_VERSION, type AnySystem, type CommandSpec } from '@nationwright/engine';
import { demographySystem } from './systems/demography.ts';
import { worldSystem } from './systems/world.ts';

export interface Ruleset {
  readonly version: number;
  readonly systems: readonly AnySystem[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly commands: readonly CommandSpec<any>[];
}

export const DEFAULT_RULESET: Ruleset = {
  version: RULESET_VERSION,
  systems: [worldSystem, demographySystem],
  commands: [],
};
