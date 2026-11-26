/**
 * parse.ts – shared CHANGELOG parser for the API layer.
 *
 * Re-exports the same logic as apps/desktop/src/changelog/parse.ts without
 * importing from the desktop package (to keep circular deps away).
 * Kept as a pure function with no side-effects.
 */

export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

const MAX_BYTES = 10 * 1024 * 1024;
const VERSION_HEADING = /^##\s+\[(\d+\.\d+\.\d+[^\]]*)\]\s*-\s*(\d{4}-\d{2}-\d{2})\s*$/;
const UNRELEASED_HEADING = /^##\s+\[Unreleased\]\s*$/i;
const SECTION_HEADING = /^###\s+(.+)$/;
const ITEM_LINE = /^-\s+(.+)$/;

export function parseChangelog(text: string): ChangelogEntry[] {
  if (text.length > MAX_BYTES) text = text.slice(0, MAX_BYTES);
  const lines = text.split(/\r?\n/);
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let currentSection: ChangelogSection | null = null;
  let inUnreleased = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const versionMatch = VERSION_HEADING.exec(line);
    if (versionMatch) {
      if (currentSection && current && currentSection.items.length > 0) current.sections.push(currentSection);
      if (current) entries.push(current);
      current = { version: versionMatch[1], date: versionMatch[2], sections: [] };
      currentSection = null;
      inUnreleased = false;
      continue;
    }
    if (UNRELEASED_HEADING.test(line)) {
      if (currentSection && current && currentSection.items.length > 0) current.sections.push(currentSection);
      if (current) entries.push(current);
      current = null; currentSection = null; inUnreleased = true;
      continue;
    }
    if (inUnreleased || !current) continue;
    const sectionMatch = SECTION_HEADING.exec(line);
    if (sectionMatch) {
      if (currentSection && currentSection.items.length > 0) current.sections.push(currentSection);
      currentSection = { title: sectionMatch[1].trim(), items: [] };
      continue;
    }
    if (currentSection) {
      const itemMatch = ITEM_LINE.exec(line);
      if (itemMatch) {
        currentSection.items.push(itemMatch[1]);
      } else if (/^\s{2,}\S/.test(line) && currentSection.items.length > 0) {
        const idx = currentSection.items.length - 1;
        currentSection.items[idx] = `${currentSection.items[idx]} ${line.trim()}`;
      }
    }
  }
  if (currentSection && current && currentSection.items.length > 0) current.sections.push(currentSection);
  if (current) entries.push(current);
  return entries;
}
