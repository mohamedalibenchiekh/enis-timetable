/**
 * CHANGELOG.md parser
 *
 * Converts a Keep-a-Changelog formatted Markdown string into a structured list
 * of version entries. Tolerant of missing sections, an "[Unreleased]" block
 * (never included in the output), odd headings, and very large files.
 *
 * Returns entries ordered newest-first (the order they appear in the file).
 */

export interface ChangelogSection {
  title: string;    // e.g. "Ajouté", "Corrigé"
  items: string[];  // plain text items (stripped of leading "- ")
}

export interface ChangelogEntry {
  version: string;  // e.g. "1.4.0"
  date: string;     // ISO date string as found in the header, e.g. "2026-11-26"
  sections: ChangelogSection[];
}

// Maximum input length we will parse (10 million UTF-16 characters) to avoid runaway processing
const MAX_CHARS = 10 * 1024 * 1024;

// Matches  ## [1.2.3] - 2026-11-26  (with optional surrounding whitespace)
const VERSION_HEADING = /^##\s+\[(\d+\.\d+\.\d+[^\]]*)\]\s*-\s*(\d{4}-\d{2}-\d{2})\s*$/;

// Matches  ## [Unreleased]  (case-insensitive)
const UNRELEASED_HEADING = /^##\s+\[Unreleased\]\s*$/i;

// Matches  ### Ajouté  or  ### Added  etc.
const SECTION_HEADING = /^###\s+(.+)$/;

// Matches  - Some item text
const ITEM_LINE = /^-\s+(.+)$/;

/**
 * Parse CHANGELOG.md text into an ordered list of version entries.
 * "[Unreleased]" is silently skipped.
 * Entries appear newest-first (file order preserved).
 */
export function parseChangelog(text: string): ChangelogEntry[] {
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
  }

  const lines = text.split(/\r?\n/);
  const entries: ChangelogEntry[] = [];

  let current: ChangelogEntry | null = null;
  let currentSection: ChangelogSection | null = null;
  let inUnreleased = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Detect version headings
    const versionMatch = VERSION_HEADING.exec(line);
    if (versionMatch) {
      // Flush previous state
      if (currentSection && current) {
        if (currentSection.items.length > 0) current.sections.push(currentSection);
      }
      if (current) entries.push(current);

      current = { version: versionMatch[1], date: versionMatch[2], sections: [] };
      currentSection = null;
      inUnreleased = false;
      continue;
    }

    // Detect [Unreleased] heading
    if (UNRELEASED_HEADING.test(line)) {
      if (currentSection && current) {
        if (currentSection.items.length > 0) current.sections.push(currentSection);
      }
      if (current) entries.push(current);
      current = null;
      currentSection = null;
      inUnreleased = true;
      continue;
    }

    // Any other level-2 heading closes the current version block so its
    // content is skipped rather than leaking into the previous version.
    if (/^##(?:\s|$)/.test(line)) {
      if (currentSection && current && currentSection.items.length > 0) {
        current.sections.push(currentSection);
      }
      if (current) entries.push(current);
      current = null;
      currentSection = null;
      inUnreleased = false;
      continue;
    }

    // Skip content under [Unreleased]
    if (inUnreleased) continue;

    // No active version block yet
    if (!current) continue;

    // Detect section headings (### Ajouté etc.)
    const sectionMatch = SECTION_HEADING.exec(line);
    if (sectionMatch) {
      if (currentSection && currentSection.items.length > 0) {
        current.sections.push(currentSection);
      }
      currentSection = { title: sectionMatch[1].trim(), items: [] };
      continue;
    }

    // Detect list items and indented continuation lines
    if (currentSection) {
      const itemMatch = ITEM_LINE.exec(line);
      if (itemMatch) {
        const rawItem = itemMatch[1];
        currentSection.items.push(rawItem);
      } else if (/^\s{2,}\S/.test(line) && currentSection.items.length > 0) {
        const idx = currentSection.items.length - 1;
        currentSection.items[idx] = `${currentSection.items[idx]} ${line.trim()}`;
      }
    }
  }

  // Flush trailing state
  if (currentSection && current && currentSection.items.length > 0) {
    current.sections.push(currentSection);
  }
  if (current) entries.push(current);

  return entries;
}

/**
 * Find the entry for a specific version, or null if not found.
 */
export function findEntry(entries: ChangelogEntry[], version: string): ChangelogEntry | null {
  return entries.find((e) => e.version === version) ?? null;
}

/**
 * Return all entries strictly newer than `since` up to and including `upTo`,
 * in the order they appear in the input array (newest-first if the file is
 * in standard Keep-a-Changelog order).
 *
 * Comparison is done by semver numeric tuple; pre-release suffixes are ignored.
 */
export function entriesBetween(
  entries: ChangelogEntry[],
  since: string,
  upTo: string,
): ChangelogEntry[] {
  const sinceNum = semverToTuple(since);
  const upToNum = semverToTuple(upTo);
  if (sinceNum === null || upToNum === null) return [];
  if (compareTuples(upToNum, sinceNum) <= 0) return [];

  return entries.filter((e) => {
    const t = semverToTuple(e.version);
    if (t === null) return false;
    return compareTuples(t, sinceNum) > 0 && compareTuples(t, upToNum) <= 0;
  });
}

/**
 * Compare two version strings: -1 if a < b, 0 if equal, 1 if a > b.
 * Returns null if either string cannot be parsed.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const ta = semverToTuple(a);
  const tb = semverToTuple(b);
  if (ta === null || tb === null) return null;
  return compareTuples(ta, tb);
}

// --- internal helpers ---

function semverToTuple(version: string): [number, number, number] | null {
  // Strip pre-release suffix (e.g. "1.2.3-beta.1" → "1.2.3")
  const core = version.split('-')[0];
  const parts = core.split('.');
  if (parts.length < 3) return null;
  const nums = parts.slice(0, 3).map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || !Number.isInteger(n))) return null;
  return nums as [number, number, number];
}

function compareTuples(a: [number, number, number], b: [number, number, number]): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}
