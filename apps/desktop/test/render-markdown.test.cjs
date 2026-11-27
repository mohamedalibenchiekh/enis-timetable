/**
 * render-markdown.test.cjs
 *
 * Unit tests for the safe Markdown renderer used for GitHub Release notes.
 * Tests with malicious inputs: script tags, javascript: links, images, nested
 * HTML, and very long lines.
 */
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { renderMarkdown } = require('../../desktop/dist/changelog/render-markdown');

describe('renderMarkdown – safe output', () => {
  it('renders headings', () => {
    const html = renderMarkdown('## Hello\n### World');
    assert.match(html, /<h2>Hello<\/h2>/);
    assert.match(html, /<h3>World<\/h3>/);
  });

  it('renders bold and italic inline', () => {
    const html = renderMarkdown('**gras** and *italique*');
    assert.match(html, /<strong>gras<\/strong>/);
    assert.match(html, /<em>italique<\/em>/);
  });

  it('renders an unordered list', () => {
    const html = renderMarkdown('- item one\n- item two');
    assert.match(html, /<ul>/);
    assert.match(html, /<li>item one<\/li>/);
    assert.match(html, /<li>item two<\/li>/);
  });

  it('renders https links', () => {
    const html = renderMarkdown('[cliquez](https://example.com)');
    assert.match(html, /href="https:\/\/example\.com"/);
    assert.match(html, /rel="noopener noreferrer"/);
  });

  it('strips script tags entirely – no executable script element in output', () => {
    const html = renderMarkdown('<script>alert(1)</script> hello');
    // The <script> and </script> tags must be gone (no executable context)
    assert.doesNotMatch(html, /script/);
    // The text content between the tags may appear as plain text – that is safe
    // (it cannot execute without a <script> wrapper)
    assert.match(html, /hello/);
  });

  it('strips img tags', () => {
    const html = renderMarkdown('![alt](https://evil.com/x.png) text');
    assert.doesNotMatch(html, /img/);
    assert.doesNotMatch(html, /evil\.com/);
    assert.match(html, /text/);
  });

  it('neutralises javascript: links – renders as plain text', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    assert.doesNotMatch(html, /javascript:/);
    assert.doesNotMatch(html, /href=/);
    // The text should still appear
    assert.match(html, /click/);
  });

  it('neutralises data: links', () => {
    const html = renderMarkdown('[x](data:text/html,<script>evil()</script>)');
    assert.doesNotMatch(html, /data:/);
    assert.doesNotMatch(html, /evil/);
  });

  it('neutralises http: (non-https) links', () => {
    const html = renderMarkdown('[link](http://unsecure.example.com)');
    assert.doesNotMatch(html, /href=/);
    assert.match(html, /link/);
  });

  it('escapes HTML special chars in text', () => {
    const html = renderMarkdown('a < b && c > d & e "f"');
    assert.match(html, /&lt;/);
    assert.match(html, /&gt;/);
    assert.match(html, /&amp;/);
    assert.doesNotMatch(html, /<b/);
  });

  it('strips nested HTML tags like <div>', () => {
    const html = renderMarkdown('<div onclick="evil()">text</div>');
    assert.doesNotMatch(html, /<div/);
    assert.doesNotMatch(html, /onclick/);
    assert.match(html, /text/);
  });

  it('caps line length at 2000 characters', () => {
    const longLine = 'x'.repeat(5000);
    const html = renderMarkdown(longLine);
    assert.equal(html, `<p>${'x'.repeat(2000)}</p>`);
  });

  it('renders https links with balanced parentheses', () => {
    const html = renderMarkdown('[Wiki](https://en.wikipedia.org/wiki/Foo_(bar))');
    assert.match(html, /href="https:\/\/en\.wikipedia\.org\/wiki\/Foo_\(bar\)"/);
  });

  it('preserves underscores in snake_case identifiers without italicising', () => {
    const html = renderMarkdown('settings_v2 et snake_case_name');
    assert.equal(html, '<p>settings_v2 et snake_case_name</p>');
  });

  it('handles empty string', () => {
    assert.equal(renderMarkdown(''), '');
  });

  it('handles mixed list and paragraph', () => {
    const html = renderMarkdown('Intro\n\n- item\n\nOutro');
    assert.match(html, /<p>Intro<\/p>/);
    assert.match(html, /<li>item<\/li>/);
    assert.match(html, /<p>Outro<\/p>/);
  });

  it('strips <iframe> tags', () => {
    const html = renderMarkdown('<iframe src="https://evil.com"></iframe>');
    assert.doesNotMatch(html, /iframe/);
  });

  it('strips <style> tags', () => {
    const html = renderMarkdown('<style>body{display:none}</style>text');
    assert.doesNotMatch(html, /style/);
    assert.match(html, /text/);
  });
});

describe('check-release-notes – parser and validator', () => {
  const { parseChangelog: parseReleaseNotes, entryToMarkdown } = require('../../../scripts/check-release-notes.js');

  it('parses -, *, and + bullets and formats markdown', () => {
    const entries = parseReleaseNotes([
      '## [1.4.0] - 2026-11-26',
      '### Ajouté',
      '- Bullet dash',
      '* Bullet star',
      '+ Bullet plus',
    ].join('\n'));
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].sections[0].items, ['Bullet dash', 'Bullet star', 'Bullet plus']);
    const md = entryToMarkdown(entries[0]);
    assert.match(md, /## Nouveautés de la version 1\.4\.0 \(2026-11-26\)/);
    assert.match(md, /- Bullet star/);
  });

  it('rejects impossible calendar dates', () => {
    assert.throws(
      () => parseReleaseNotes('## [1.4.0] - 2026-99-99\n### Ajouté\n- Item'),
      /Invalid release date/,
    );
  });

  it('rejects unrecognized level-2 headings', () => {
    assert.throws(
      () => parseReleaseNotes('## [1.4.0] - 2026-11-26\n### Ajouté\n- Ok\n\n## [1.3.0] – 2026-11-01\n### Corrigé\n- Leak'),
      /Unrecognized level-2 heading/,
    );
  });

  it('rejects uncaptured numbered list items', () => {
    assert.throws(
      () => parseReleaseNotes('## [1.4.0] - 2026-11-26\n### Ajouté\n1. Numbered item'),
      /Unsupported or empty list item/,
    );
  });

  it('rejects duplicate version headings', () => {
    assert.throws(
      () => parseReleaseNotes('## [1.4.0] - 2026-11-26\n### Ajouté\n- A\n\n## [1.4.0] - 2026-11-25\n### Ajouté\n- B'),
      /Duplicate version heading/,
    );
  });

  it('appends unindented and single-space-indented continuation lines to the previous item', () => {
    const entries = parseReleaseNotes([
      '## [1.4.0] - 2026-11-26',
      '### Ajouté',
      '- First line',
      'unindented continuation',
      ' single-space continuation',
      '---',
    ].join('\n'));
    assert.deepEqual(
      entries[0].sections[0].items,
      ['First line unindented continuation single-space continuation'],
    );
  });
});
