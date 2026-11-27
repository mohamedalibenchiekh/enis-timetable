/**
 * changelog-parser.test.cjs
 *
 * Unit tests for the CHANGELOG.md parser (desktop/src/changelog/parse.ts)
 * and the show-once decision logic (desktop/src/changelog/seen.ts).
 * Uses Node.js built-in test runner (node --test).
 */
'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Import the compiled JS (tsc outputs to dist/)
const { parseChangelog, findEntry, entriesBetween, compareVersions } =
  require('../../desktop/dist/changelog/parse');
const { decideShowChangelog } =
  require('../../desktop/dist/changelog/seen');

// ── Parser tests ───────────────────────────────────────────────────────────────

describe('parseChangelog', () => {
  it('parses a well-formed changelog with two versions', () => {
    const md = `
# Journal

## [1.2.0] - 2026-11-01

### Ajouté
- Feature A
- Feature B

### Corrigé
- Bug fix

## [1.1.0] - 2026-10-01

### Ajouté
- Initial feature
`;
    const entries = parseChangelog(md);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].version, '1.2.0');
    assert.equal(entries[0].date, '2026-11-01');
    assert.equal(entries[0].sections.length, 2);
    assert.equal(entries[0].sections[0].title, 'Ajouté');
    assert.equal(entries[0].sections[0].items.length, 2);
    assert.equal(entries[1].version, '1.1.0');
    assert.equal(entries[1].sections[0].items[0], 'Initial feature');
  });

  it('skips the [Unreleased] block', () => {
    const md = `
## [Unreleased]

### Ajouté
- Coming soon

## [1.0.0] - 2026-01-01

### Ajouté
- First release
`;
    const entries = parseChangelog(md);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].version, '1.0.0');
  });

  it('handles missing sections gracefully', () => {
    const md = `
## [2.0.0] - 2026-12-01
`;
    const entries = parseChangelog(md);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].sections.length, 0);
  });

  it('handles empty input', () => {
    assert.deepEqual(parseChangelog(''), []);
  });

  it('handles input with only preamble and no versions', () => {
    const md = `# Changelog\n\nSome text here.\n\n> Note: nothing.`;
    assert.deepEqual(parseChangelog(md), []);
  });

  it('handles versions with pre-release suffix in heading', () => {
    const md = `
## [1.3.0-beta.1] - 2026-11-15

### Ajouté
- Beta feature
`;
    const entries = parseChangelog(md);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].version, '1.3.0-beta.1');
  });

  it('handles CRLF line endings', () => {
    const md = `## [1.0.0] - 2026-01-01\r\n\r\n### Ajouté\r\n- Item\r\n`;
    const entries = parseChangelog(md);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].sections[0].items[0], 'Item');
  });

  it('ignores headings at other levels (# and ####)', () => {
    const md = `
# Title (ignored)

## [1.0.0] - 2026-01-01

#### Sub (ignored as section)
- not an item under section

### Ajouté
- Real item
`;
    const entries = parseChangelog(md);
    assert.equal(entries.length, 1);
    // "#### Sub" doesn't create a section; "### Ajouté" does
    assert.equal(entries[0].sections.length, 1);
    assert.equal(entries[0].sections[0].title, 'Ajouté');
  });

  it('caps processing at 10M characters and drops trailing versions beyond the cap', () => {
    const bigText = '- item\n'.repeat(2_000_000); // ~14M chars (> 10 * 1024 * 1024)
    const entries = parseChangelog(
      `## [1.0.0] - 2026-01-01\n\n### Ajouté\n${bigText}\n## [0.9.0] - 2025-01-01\n\n### Ajouté\n- Dropped\n`,
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0].version, '1.0.0');
  });

  it('closes the previous version on an unrecognized ## heading instead of merging items', () => {
    const md = `
## [1.2.0] - 2026-11-01

### Ajouté
- Real feature

## [1.1.1] – 2026-10-15

### Corrigé
- Should not leak into 1.2.0
`;
    const entries = parseChangelog(md);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].version, '1.2.0');
    assert.equal(entries[0].sections.length, 1);
    assert.deepEqual(entries[0].sections[0].items, ['Real feature']);
  });
});

describe('entriesBetween', () => {
  const md = `
## [1.4.0] - 2026-11-26
### Ajouté
- D

## [1.3.0] - 2026-11-01
### Ajouté
- C

## [1.2.0] - 2026-10-01
### Ajouté
- B

## [1.1.0] - 2026-09-01
### Ajouté
- A
`;
  const entries = parseChangelog(md);

  it('returns versions between lastSeen (exclusive) and current (inclusive)', () => {
    const result = entriesBetween(entries, '1.2.0', '1.4.0');
    assert.deepEqual(result.map((e) => e.version), ['1.4.0', '1.3.0']);
  });

  it('returns empty when current <= lastSeen', () => {
    assert.deepEqual(entriesBetween(entries, '1.4.0', '1.3.0'), []);
    assert.deepEqual(entriesBetween(entries, '1.4.0', '1.4.0'), []);
  });

  it('returns empty for unparseable versions', () => {
    assert.deepEqual(entriesBetween(entries, 'bad', '1.4.0'), []);
  });

  it('handles pre-release stripping: 1.1.0-beta < 1.2.0', () => {
    const result = entriesBetween(entries, '1.1.0-beta.1', '1.2.0');
    assert.deepEqual(result.map((e) => e.version), ['1.2.0']);
  });
});

describe('compareVersions', () => {
  it('compares correctly', () => {
    assert.equal(compareVersions('1.2.0', '1.1.0'), 1);
    assert.equal(compareVersions('1.1.0', '1.2.0'), -1);
    assert.equal(compareVersions('1.1.0', '1.1.0'), 0);
    assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
    assert.equal(compareVersions('bad', '1.0.0'), null);
    assert.equal(compareVersions('1.0.0', 'bad'), null);
  });

  it('strips pre-release for comparison', () => {
    // 1.2.0-beta.1 core = 1.2.0 > 1.1.0
    assert.equal(compareVersions('1.2.0-beta.1', '1.1.0'), 1);
  });
});

// ── Show-once logic tests ─────────────────────────────────────────────────────

describe('decideShowChangelog', () => {
  const cases = [
    // [description, currentVersion, lastSeen, settingEnabled, expected]
    ['first install – null lastSeen', '1.2.0', null, true, 'first-install'],
    ['first install – undefined lastSeen', '1.2.0', undefined, true, 'first-install'],
    ['first install – empty string lastSeen', '1.2.0', '', true, 'first-install'],
    ['same version', '1.2.0', '1.2.0', true, 'nothing'],
    ['downgrade', '1.1.0', '1.2.0', true, 'nothing'],
    ['upgrade', '1.2.0', '1.1.0', true, 'show'],
    ['skipped versions: 1.0 -> 1.3', '1.3.0', '1.0.0', true, 'show'],
    ['pre-release stripped: 1.2.0-rc.1 > 1.1.0', '1.2.0-rc.1', '1.1.0', true, 'show'],
    ['pre-release stripped: 1.2.0 same as 1.2.0-rc (core)', '1.2.0', '1.2.0-rc.1', true, 'nothing'],
    ['setting disabled', '1.2.0', '1.1.0', false, 'nothing'],
    ['corrupt stored value (non-string)', '1.2.0', /** @type {any} */ (42), true, 'first-install'],
    ['corrupt stored value (unparseable string)', '1.2.0', 'not-a-version', true, 'first-install'],
    ['unparseable current version', 'bad-current', '1.1.0', true, 'nothing'],
  ];

  for (const [desc, current, lastSeen, setting, expected] of cases) {
    it(desc, () => {
      const result = decideShowChangelog({
        currentVersion: current,
        lastSeen: lastSeen,
        settingEnabled: setting,
      });
      assert.equal(result, expected, `Expected ${expected} for case: ${desc}`);
    });
  }
});
