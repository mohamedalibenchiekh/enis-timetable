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

// Separator characters that may dangle around an empty token.
const SEP = '\\s\\-–—·•/,;:|';
const SEP_RUN = new RegExp(`([${SEP}])(\\s*[${SEP}])+`, 'g');
const LEADING_SEP = new RegExp(`^[${SEP}]+`);
const TRAILING_SEP = new RegExp(`[${SEP}]+$`);

const SENTINEL_OPEN = '\u0001';
const SENTINEL_CLOSE = '\u0002';
const SENTINEL_RE = /\u0001(\d+)\u0002/g;

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
      }
      // Empty tokens contribute nothing; surrounding separators are cleaned below.
    }
  }
  // Collapse whitespace, merge runs of separators, strip dangling separators.
  out = out.replace(/\s+/g, ' ');
  out = out.replace(SEP_RUN, '$1');
  out = out.replace(LEADING_SEP, '').replace(TRAILING_SEP, '');
  out = out.trim();
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

/** Truncates a course name to `max` chars with an ellipsis (0 = unlimited). */
export function truncateSubject(subject: string, max: number): string {
  if (!subject || max <= 0 || subject.length <= max) return subject;
  if (max <= 1) return '…';
  return `${subject.slice(0, max - 1).trimEnd()}…`;
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
