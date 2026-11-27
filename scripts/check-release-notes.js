#!/usr/bin/env node
/**
 * check-release-notes.js
 *
 * Validates that:
 *  1. The git tag version (passed as $TAG or first CLI arg) matches
 *     apps/desktop/package.json version.
 *  2. CHANGELOG.md contains a section for that version.
 *  3. The section has at least one item.
 *
 * Exit codes:
 *   0 – all checks pass; prints the extracted section to stdout
 *   1 – one or more checks failed; prints clear error messages to stderr
 *
 * Usage:
 *   node scripts/check-release-notes.js v1.4.0
 *   TAG=v1.4.0 node scripts/check-release-notes.js
 */

'use strict';
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');

// ── helpers ───────────────────────────────────────────────────────────────────

function fail(msg) {
  process.stderr.write(`::error::${msg}\n`);
  process.exitCode = 1;
}

function isValidIsoDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Parse CHANGELOG.md text and return entries[]. No external deps. */
function parseChangelog(text) {
  const VERSION_HEADING = /^##\s+\[(\d+\.\d+\.\d+[^\]]*)\]\s*-\s*(\d{4}-\d{2}-\d{2})\s*$/;
  const UNRELEASED_HEADING = /^##\s+\[Unreleased\]\s*$/i;
  const ANY_H2_HEADING = /^##(?:\s|$)/;
  const SECTION_HEADING = /^###\s+(.+)$/;
  const ITEM_LINE = /^[-*+]\s+(.+)$/;
  const UNCAPTURED_LIST_LINE = /^(?:[-*+]|\d+[.)])(?:\s|$)/;

  const lines = text.split(/\r?\n/);
  const entries = [];
  let current = null;
  let currentSection = null;
  let inUnreleased = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const vm = VERSION_HEADING.exec(line);
    if (vm) {
      if (!isValidIsoDate(vm[2])) {
        throw new Error(`Invalid release date "${vm[2]}" in heading "${line}".`);
      }
      if (currentSection && current && currentSection.items.length > 0) current.sections.push(currentSection);
      if (current) entries.push(current);
      current = { version: vm[1], date: vm[2], sections: [] };
      currentSection = null; inUnreleased = false;
      continue;
    }
    if (UNRELEASED_HEADING.test(line)) {
      if (currentSection && current && currentSection.items.length > 0) current.sections.push(currentSection);
      if (current) entries.push(current);
      current = null; currentSection = null; inUnreleased = true;
      continue;
    }
    if (ANY_H2_HEADING.test(line)) {
      throw new Error(`Unrecognized level-2 heading: "${line}". Expected "## [X.Y.Z] - YYYY-MM-DD" or "## [Unreleased]".`);
    }
    if (inUnreleased || !current) continue;
    const sm = SECTION_HEADING.exec(line);
    if (sm) {
      if (currentSection && currentSection.items.length > 0) current.sections.push(currentSection);
      currentSection = { title: sm[1].trim(), items: [] };
      continue;
    }
    const im = ITEM_LINE.exec(line);
    if (im) {
      if (!currentSection) {
        throw new Error(`Bullet item outside of a ### section: "${line}".`);
      }
      currentSection.items.push(im[1]);
    } else if (UNCAPTURED_LIST_LINE.test(line)) {
      throw new Error(`Unsupported or empty list item: "${line}". Use "- ", "* ", or "+ " with text inside a ### section.`);
    } else if (currentSection && /^\s{2,}\S/.test(line) && currentSection.items.length > 0) {
      const idx = currentSection.items.length - 1;
      currentSection.items[idx] = `${currentSection.items[idx]} ${line.trim()}`;
    }
  }
  if (currentSection && current && currentSection.items.length > 0) current.sections.push(currentSection);
  if (current) entries.push(current);
  return entries;
}

/** Render a single ChangelogEntry as Markdown suitable for a GitHub Release body. */
function entryToMarkdown(entry) {
  const lines = [`## Nouveautés de la version ${entry.version} (${entry.date})`, ''];
  for (const section of entry.sections) {
    lines.push(`### ${section.title}`, '');
    for (const item of section.items) lines.push(`- ${item}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ── main ──────────────────────────────────────────────────────────────────────

function main() {
  const tagArg = process.argv[2] || process.env.TAG || process.env.GITHUB_REF_NAME || '';
  const tagVersion = tagArg.replace(/^v/, '');

  if (!tagVersion) {
    fail('No version tag provided. Pass it as the first argument or set TAG env var.');
    process.exit(1);
  }

  // 1. Check package.json version
  const pkgPath = path.join(repoRoot, 'apps', 'desktop', 'package.json');
  let pkgVersion;
  try {
    pkgVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  } catch (err) {
    fail(`Cannot read apps/desktop/package.json: ${err.message}`);
    process.exit(1);
  }

  if (tagVersion !== pkgVersion) {
    fail(`Tag version "${tagVersion}" does not match apps/desktop/package.json version "${pkgVersion}".`);
  }

  // 2. Parse CHANGELOG.md
  const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
  let entries;
  try {
    entries = parseChangelog(fs.readFileSync(changelogPath, 'utf8'));
  } catch (err) {
    fail(`Invalid CHANGELOG.md: ${err.message}`);
    process.exit(1);
  }

  const entry = entries.find((e) => e.version === tagVersion);
  if (!entry) {
    fail(
      `CHANGELOG.md does not contain a section for version "${tagVersion}". ` +
      `Add "## [${tagVersion}] - YYYY-MM-DD" with at least one item before releasing.`
    );
    process.exit(1);
  }

  // 3. Check the section has content
  const totalItems = entry.sections.reduce((n, s) => n + s.items.length, 0);
  if (totalItems === 0) {
    fail(`The [${tagVersion}] section in CHANGELOG.md has no items. Add at least one bullet point.`);
    process.exit(1);
  }

  if (process.exitCode) process.exit(process.exitCode);

  // All good – print the extracted Markdown to stdout (used by CI to populate release body)
  const markdown = entryToMarkdown(entry);
  process.stdout.write(markdown + '\n');
  process.stderr.write(`✓ CHANGELOG.md section for ${tagVersion} is valid (${totalItems} items across ${entry.sections.length} section(s)).\n`);
}

if (require.main === module) {
  main();
}

module.exports = { parseChangelog, entryToMarkdown };
