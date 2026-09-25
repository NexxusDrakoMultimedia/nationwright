// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Nexxus Drako Multimedia

/**
 * Parsers for Factbook free text, e.g. "9,174,390 (2025 est.)", "$521.642 billion
 * (2024 est.)", "Roman Catholic 55.2%, Muslim 8.3%, none 22.4% (2021 est.)".
 * Every parser returns null instead of guessing; callers log what failed.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ocirc: 'ô',
  eacute: 'é',
  egrave: 'è',
  aacute: 'á',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  ccedil: 'ç',
  atilde: 'ã',
  otilde: 'õ',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
};

/** Strips HTML tags, decodes entities, and collapses whitespace. */
export function cleanText(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The estimate year: the first parenthesized year, e.g. "(2024 est.)", "(2023)",
 * "(2020-25 est.)" -> 2025 (the end of a range).
 */
export function parseEstYear(text: string): number | null {
  const match = /\((?:[^()]*?\b)?((?:19|20)\d{2})(?:\s*[-–]\s*(\d{2,4}))?(?:\s*est\.?)?\s*\)/.exec(
    text,
  );
  if (match === null) return null;
  const start = Number(match[1]);
  const end = match[2];
  if (end === undefined) return start;
  if (end.length === 4) return Number(end);
  const century = Math.floor(start / 100) * 100;
  const year = century + Number(end.slice(-2));
  return year >= start ? year : year + 100;
}

const MULTIPLIERS: Record<string, number> = {
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
};

/**
 * The first number in the text, with a trailing multiplier word applied:
 * "$521.642 billion" -> 521642000000. Returns null for "NA" and text with no number.
 */
export function parseNumber(text: string): number | null {
  text = withoutParentheses(text);
  const match =
    /(?<![\d.])((?<![\w%])[-−–]?)\s*\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(thousand|million|billion|trillion)?\b/i.exec(
      text,
    );
  if (match === null) return null;
  const sign = match[1] === '' ? 1 : -1;
  const value = Number((match[2] ?? '').replaceAll(',', ''));
  const multiplier = MULTIPLIERS[(match[3] ?? '').toLowerCase()] ?? 1;
  // toPrecision(15) removes binary noise such as 521.642e9 -> 521642000000.00006.
  return Number.isFinite(value) ? sign * Number((value * multiplier).toPrecision(15)) : null;
}

/**
 * The first percentage in the text: "-1.2% (2024 est.)" -> -1.2. A range such as
 * "20-30%" gives its midpoint; a dash between digits is never a minus sign.
 */
export function parsePercent(text: string): number | null {
  text = withoutParentheses(text);
  const match = /(?<![\w.])([-−–]?)\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*%/.exec(text);
  if (match === null) return null;
  const low = Number(match[2]);
  const value = match[3] === undefined ? low : (low + Number(match[3])) / 2;
  return match[1] === '' ? value : -value;
}

/**
 * Removes parenthesized groups, which hold years and notes rather than the value:
 * "(2017 est.) 77.9" -> " 77.9". Keeps the text if that would leave no digits.
 */
function withoutParentheses(text: string): string {
  let stripped = text;
  for (let previous = ''; previous !== stripped;) {
    previous = stripped;
    stripped = stripped.replace(/\([^()]*\)/g, ' ');
  }
  return /\d/.test(stripped) ? stripped : text;
}

/**
 * Head count of the first force named, e.g. "approximately 60,000 active ADF personnel".
 * Leading caveats without numbers ("information varies;") are skipped; ranges give their
 * midpoint. "40-50,000" means 40,000–50,000; "1.1-1.2 million" applies the multiplier to
 * both ends; "850,000-1 million" spells the low end out. Later clauses (other forces,
 * reserves) and parenthesized breakdowns are ignored.
 */
export function parseHeadcount(text: string): number | null {
  const clause = withoutParentheses(text)
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .split(';')
    .find((c) => /\d/.test(c));
  if (clause === undefined) return null;
  const match =
    /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?))?\s*(thousand|million)?\b/i.exec(
      clause,
    );
  if (match === null) return null;
  const multiplier = MULTIPLIERS[(match[3] ?? '').toLowerCase()] ?? 1;
  const toNumber = (s: string) => Number(s.replaceAll(',', ''));
  const lowText = match[1] ?? '';
  let low = toNumber(lowText);
  if (match[2] === undefined) return Number((low * multiplier).toPrecision(15));
  const high = toNumber(match[2]) * multiplier;
  if (multiplier > 1) {
    if (!lowText.includes(',')) low *= multiplier;
  } else {
    const missing = match[2].split(',').length - lowText.split(',').length;
    if (missing > 0 && low * 10 ** (3 * missing) <= high) low *= 10 ** (3 * missing);
  }
  return Number(((low + high) / 2).toPrecision(15));
}

export interface ShareItem {
  readonly label: string;
  /** Percentage (0–100), or null when the item has no percentage. */
  readonly share: number | null;
}

/**
 * Splits a list like "Roman Catholic 55.2%, Muslim 8.3%, other 5.4% (2021 est.)" into
 * items, ignoring commas and percentages inside parentheses.
 */
export function parseShareList(text: string): ShareItem[] {
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) {
      items.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  items.push(current);

  return items
    .map((raw) => {
      const outside = raw.replace(/\([^()]*\)/g, ' ');
      const pct = /(<\s*)?(\d+(?:\.\d+)?)\s*%/.exec(outside);
      const share =
        pct === null ? null : pct[1] !== undefined ? Number(pct[2]) / 2 : Number(pct[2]);
      const label = cleanText(outside.replace(/<?\s*\d+(?:\.\d+)?\s*%/g, ' ')).replace(/[.:]$/, '');
      return { label, share };
    })
    .filter((item) => item.label !== '' || item.share !== null);
}
