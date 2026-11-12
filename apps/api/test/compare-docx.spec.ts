import * as fs from 'node:fs';
import * as path from 'node:path';
import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { compareSessions } from '../src/compare/compare.js';
import { buildCompareDocx } from '../src/export/compare-docx.js';
import { DEFAULT_OPTIONS } from '../src/export/options.js';
import { createNameResolver } from '../src/export/name-resolver.js';
import { parseHtml } from '../src/parser/html-parser.js';
import type { CompareInput } from '../src/compare/types.js';

const fixtures = path.join(__dirname, 'fixtures');
const resolver = createNameResolver(new Map(), new Map());

function load(dir: string, kind: 'teachers' | 'rooms' | 'groups') {
  const file = fs.readdirSync(dir).find((f) => f.toLowerCase().includes(kind === 'teachers' ? 'teacher' : kind === 'rooms' ? 'room' : 'group'))!;
  return parseHtml(fs.readFileSync(path.join(dir, file), 'utf8'), kind);
}

function toInput(p: ReturnType<typeof parseHtml>, id: string): CompareInput {
  return {
    summary: { id, name: id, institution: p.institution, comment: p.comment, generatedAt: p.generatedAt, createdAt: '', files: [] },
    meta: { days: p.days, slots: p.slots, rooms: p.owners },
    sessions: p.sessions,
  };
}

async function documentText(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  expect(xml).toBeDefined();
  const $ = cheerio.load(xml!, { xmlMode: true });
  return $('*').filter((_, el) => el.type === 'tag' && el.name === 'w:document').text();
}

describe('compare Word document', () => {
  it('renders summary, days to re-edit, and change details from a real comparison', async () => {
    const base = load(fixtures, 'teachers');
    const target = load(path.join(fixtures, 'v2'), 'teachers');
    const result = compareSessions(toInput(base, 'v1'), toInput(target, 'v2'), 'teachers', DEFAULT_OPTIONS, resolver);
    expect(result.changes.length).toBeGreaterThan(0);

    const buffer = await buildCompareDocx(result, 'Emploi v1', 'Emploi v2');
    const text = await documentText(buffer);

    expect(text).toContain('Fiche des changements');
    expect(text).toContain('Emploi v1');
    expect(text).toContain('Emploi v2');
    expect(text).toContain('Enseignants');
    expect(text).toContain('Jours à rééditer');
    expect(text).toContain('Détail des changements');
    expect(text).toContain('Salle');
    expect(text).toContain('Créneau');
    expect(text).toMatch(/Avant : .+ → +Après : /);
  });

  it('renders the empty state when nothing changed', async () => {
    const parsed = load(fixtures, 'teachers');
    const input = toInput(parsed, 'same');
    const result = compareSessions(input, input, 'teachers', DEFAULT_OPTIONS, resolver);
    expect(result.changes).toHaveLength(0);
    expect(result.days).toHaveLength(0);

    const buffer = await buildCompareDocx(result, 'A', 'B');
    const text = await documentText(buffer);

    expect(text).toContain('Aucun changement : les documents Word existants restent valables.');
    expect(text).toContain('Aucun changement.');
  });
});
