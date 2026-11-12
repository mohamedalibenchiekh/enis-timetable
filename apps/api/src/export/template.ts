import { CELL_TOKENS, CellToken, ExportOptions } from './options.js';

/**
 * Values available to the cell template tokens. All strings are already
 * display-formatted (teacher names resolved, subject truncated, …).
 */
export interface CellFields {
  teacher: string;
  group: string;
  subjectCode: string;
  subject: string;
  frequency: string;
}

// Punctuation separators that may dangle around an empty token. Whitespace is
// handled separately so a single meaningful separator (e.g. "—") survives.
const SEP_PUNCT = '\\-–—·•/,;:|';
const SEP_CLASS = `[${SEP_PUNCT}]`;

const SENTINEL_OPEN = '\u0001';
const SENTINEL_CLOSE = '\u0002';
const SENTINEL_RE = /\u0001(\d+)\u0002/g;

// Marks the position of an empty token so separator cleanup stays scoped to it.
const EMPTY_MARK = String.fromCharCode(3);

interface Part {
  text?: string;
  token?: CellToken;
}

function tokenize(line: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of line.matchAll(/\{([^{}]*)\}/g)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ text: line.slice(last, idx) });
    parts.push({ token: m[1] as CellToken });
    last = idx + m[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last) });
  return parts;
}

/**
 * Renders one template line. Token values are protected by sentinels so the
 * separator cleanup never touches user data (e.g. a subject ending in ")").
 */
function renderLine(line: string, fields: CellFields): string {
  const values: string[] = [];
  let out = '';
  for (const part of tokenize(line)) {
    if (part.text !== undefined) {
      out += part.text;
    } else if (part.token !== undefined) {
      const value = fields[part.token] ?? '';
      if (value) {
        values.push(value);
        out += `${SENTINEL_OPEN}${values.length - 1}${SENTINEL_CLOSE}`;
      } else {
        out += EMPTY_MARK;
      }
    }
  }
  // Collapse whitespace, then merge marks of consecutive empty tokens (joined by
  // spaces and/or separators only) into a single hole.
  out = out.replace(/\s+/g, ' ');
  out = out.replace(new RegExp(`${EMPTY_MARK}(?:\\s*${SEP_CLASS}*\\s*${EMPTY_MARK})+`, 'g'), EMPTY_MARK);
  out = out.trim();
  // Separator cleanup is scoped to empty-token marks: literal punctuation that is
  // not adjacent to a mark is preserved. A mark between two separators keeps one
  // of them; at a line edge the dangling separator is removed with the mark.
  out = out.replace(new RegExp(`(${SEP_CLASS}+)\\s*${EMPTY_MARK}\\s*(${SEP_CLASS}+)`, 'g'), '$1');
  out = out.replace(new RegExp(`^${EMPTY_MARK}+\\s*${SEP_CLASS}+\\s*`), '');
  out = out.replace(new RegExp(`${SEP_CLASS}+\\s*${EMPTY_MARK}+$`), '');
  out = out.replace(new RegExp(`^${EMPTY_MARK}+\\s*`), '');
  out = out.replace(new RegExp(`\\s*${EMPTY_MARK}+$`), '');
  out = out.replace(new RegExp(`${EMPTY_MARK}+`, 'g'), '');
  out = out.replace(/\s+/g, ' ').trim();
  // Restore sentinel-protected values.
  out = out.replace(SENTINEL_RE, (_m, i) => values[Number(i)] ?? '');
  return out.trim();
}

/**
 * Renders a cell template into display lines (one per session).
 * `\n` in the template produces a new line; empty lines disappear.
 */
export function renderTemplate(template: string, fields: CellFields): string[] {
  return template
    .split('\n')
    .map((line) => renderLine(line, fields))
    .filter((line) => line.length > 0);
}

const graphemeSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('fr', { granularity: 'grapheme' })
  : null;

/** Truncates a course name to `max` graphemes with an ellipsis (0 = unlimited). */
export function truncateSubject(subject: string, max: number): string {
  if (!subject || max <= 0) return subject;
  const chars = graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(subject), (s) => s.segment)
    : Array.from(subject);
  if (chars.length <= max) return subject;
  if (max <= 1) return '…';
  return `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

/** Builds the {subject} token value according to subjectMode and subjectMaxLength. */
export function subjectDisplay(fields: { subjectCode: string; subject: string }, options: ExportOptions): string {
  const name = truncateSubject(fields.subject, options.subjectMaxLength);
  switch (options.subjectMode) {
    case 'code':
      return fields.subjectCode;
    case 'both':
      return [fields.subjectCode, name].filter(Boolean).join(' ');
    default:
      return name;
  }
}

/** Joins several groups with the configured separator. */
export function joinGroups(groups: string, separator: string): string {
  const list = groups.split(',').map((g) => g.trim()).filter(Boolean);
  return list.join(separator || ', ');
}

/** True when the template is the historical default (legacy cell rendering). */
export function isLegacyTemplate(template: string): boolean {
  return template === '{teacher}';
}

export { CELL_TOKENS };
