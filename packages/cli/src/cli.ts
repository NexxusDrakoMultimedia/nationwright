// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Headless runner (TODO.md M0). Every command takes its output stream and clock as
 * parameters so tests can run it in-process.
 */

import { parseArgs } from 'node:util';
import { SaveFile, WorldSession, type Ruleset } from '@nationwright/app';
import { dateOfTick, formatDate, isScope } from '@nationwright/engine';

export interface CliContext {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly now?: () => Date;
  readonly ruleset?: Ruleset;
}

export const USAGE = `Usage: nationwright <command> [options]

Commands:
  new <file> [--start-year Y] [--years N]
                                     Create a new random world (current year by default)
  run <file> --years N | --months N  Advance a saved world
  info <file>                        Show dates and contents of a save
  indicators <file> [--id ID] [--scope SCOPE]
                                     Print indicator series as CSV
  branch <file> <new-file> [--at-month N]
                                     Copy a world, optionally rewound to month N (0-based)
`;

export function runCli(argv: readonly string[], ctx: CliContext): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        'start-year': { type: 'string' },
        years: { type: 'string' },
        months: { type: 'string' },
        id: { type: 'string' },
        scope: { type: 'string' },
        'at-month': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    ctx.err(error instanceof Error ? error.message : String(error));
    ctx.err(USAGE);
    return 2;
  }
  const { positionals, values } = parsed;
  const [command, ...args] = positionals;
  if (values.help === true || command === undefined) {
    ctx.out(USAGE);
    return command === undefined && values.help !== true ? 2 : 0;
  }

  try {
    switch (command) {
      case 'new':
        return cmdNew(requireArg(args, 0, 'file'), values, ctx);
      case 'run':
        return cmdRun(requireArg(args, 0, 'file'), values, ctx);
      case 'info':
        return cmdInfo(requireArg(args, 0, 'file'), ctx);
      case 'indicators':
        return cmdIndicators(requireArg(args, 0, 'file'), values, ctx);
      case 'branch':
        return cmdBranch(requireArg(args, 0, 'file'), requireArg(args, 1, 'new-file'), values, ctx);
      default:
        ctx.err(`Unknown command "${command}".`);
        ctx.err(USAGE);
        return 2;
    }
  } catch (error) {
    ctx.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

type Values = Record<string, string | boolean | undefined>;

function cmdNew(path: string, values: Values, ctx: CliContext): number {
  const session = WorldSession.create({
    path,
    ...(values['start-year'] === undefined ? {} : { startYear: intOption(values, 'start-year') }),
    ...(ctx.ruleset === undefined ? {} : { ruleset: ctx.ruleset }),
    ...(ctx.now === undefined ? {} : { now: ctx.now }),
  });
  ctx.out(`Created ${path}`);
  const ticks = tickCount(values, false);
  if (ticks > 0) session.advance(ticks);
  session.close();
  ctx.out(
    `Now at ${formatDate(dateOfTick(session.engine.world.meta.startYear, session.engine.nextTick))}`,
  );
  return 0;
}

function cmdRun(path: string, values: Values, ctx: CliContext): number {
  const ticks = tickCount(values, true);
  const session = WorldSession.open(path, sessionOptions(ctx));
  session.advance(ticks);
  session.close();
  ctx.out(
    `Advanced ${ticks} months; now at ${formatDate(dateOfTick(session.engine.world.meta.startYear, session.engine.nextTick))}`,
  );
  return 0;
}

function cmdInfo(path: string, ctx: CliContext): number {
  const file = SaveFile.open(path);
  try {
    const info = file.info();
    const saved = file.read();
    ctx.out(`Start:          ${formatDate(dateOfTick(info.startYear, 0))}`);
    ctx.out(
      `Now:            ${formatDate(dateOfTick(info.startYear, info.nextTick))} (month ${info.nextTick})`,
    );
    ctx.out(`Ruleset:        v${info.rulesetVersion}`);
    ctx.out(`Save schema:    v${info.schemaVersion}`);
    ctx.out(`Created:        ${info.createdAt}`);
    ctx.out(`Saved:          ${info.savedAt}`);
    ctx.out(`Systems:        ${Object.keys(saved.world.slices).join(', ') || '(none yet)'}`);
    ctx.out(`Indicators:     ${saved.indicators.length} series`);
    ctx.out(`Commands:       ${saved.commandLog.length} applied, ${saved.pending.length} pending`);
    ctx.out(`Chronicle:      ${saved.world.chronicle.length} entries`);
  } finally {
    file.close();
  }
  return 0;
}

function cmdIndicators(path: string, values: Values, ctx: CliContext): number {
  const scope = values['scope'];
  if (typeof scope === 'string' && !isScope(scope)) {
    ctx.err(`Invalid scope "${scope}".`);
    return 2;
  }
  const file = SaveFile.open(path);
  try {
    const saved = file.read();
    const startYear = saved.world.meta.startYear;
    ctx.out('indicator,scope,tick,year,month,value');
    for (const series of saved.indicators) {
      if (typeof values['id'] === 'string' && series.id !== values['id']) continue;
      if (typeof scope === 'string' && series.scope !== scope) continue;
      series.ticks.forEach((tick, i) => {
        const date = dateOfTick(startYear, tick);
        ctx.out(
          `${series.id},${series.scope},${tick},${date.year},${date.month},${series.values[i]}`,
        );
      });
    }
  } finally {
    file.close();
  }
  return 0;
}

function cmdBranch(path: string, target: string, values: Values, ctx: CliContext): number {
  const session = WorldSession.open(path, sessionOptions(ctx));
  try {
    const at =
      values['at-month'] === undefined ? session.engine.nextTick : intOption(values, 'at-month');
    session.branch(target, at);
    ctx.out(`Branched ${path} at month ${at} into ${target}`);
  } finally {
    session.close();
  }
  return 0;
}

function sessionOptions(ctx: CliContext) {
  return {
    ...(ctx.ruleset === undefined ? {} : { ruleset: ctx.ruleset }),
    ...(ctx.now === undefined ? {} : { now: ctx.now }),
  };
}

function requireArg(args: readonly string[], index: number, name: string): string {
  const value = args[index];
  if (value === undefined) throw new Error(`Missing <${name}>.\n\n${USAGE}`);
  return value;
}

function intOption(values: Values, name: string): number {
  const raw = values[name];
  const n = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error(`--${name} must be a non-negative integer.`);
  return n;
}

function tickCount(values: Values, required: boolean): number {
  const years = values['years'] === undefined ? 0 : intOption(values, 'years');
  const months = values['months'] === undefined ? 0 : intOption(values, 'months');
  if (required && years === 0 && months === 0) throw new Error('Give --years or --months.');
  return years * 12 + months;
}
