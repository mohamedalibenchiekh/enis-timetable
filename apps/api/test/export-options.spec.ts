import * as fs from 'node:fs';
import * as path from 'node:path';
import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { buildDayGrid } from '../src/export/grid-builder';
import { buildDayDocx } from '../src/export/docx-builder';
import {
  assertValidTemplate, dayFileName, DEFAULT_OPTIONS, mergeOptions, normalizeOptions,
  normalizeProfilesState, sanitizeProfileFileName,
} from '../src/export/options';
import { isLegacyTemplate, joinGroups, renderTemplate, subjectDisplay, truncateSubject } from '../src/export/template';
import { parseHtml, parseSlotLabel } from '../src/parser/html-parser';
import { ParsedSession } from '../src/parser/types';

const session = (fields: Partial<ParsedSession> = {}): Pick<ParsedSession, 'day' | 'slot' | 'room' | 'teachers' | 'groups' | 'subjectCode' | 'subject' | 'frequency'> => ({
  day: 0, slot: 0, room: 'A01', teachers: 'Prof Dupont', groups: 'G1', subjectCode: 'ALG', subject: 'Algorithmique', frequency: '', ...fields,
});
const meta = {
  days: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
  slots: ['08:00-09:30', '11:30-13:00', '14:30-16:00', '12:00-13:30'].map(parseSlotLabel),
  rooms: ['A01', 'A02', 'B12', 'R01', 'Amphi'],
};
const fields = { teacher: 'Prof Dupont', group: 'G1', subjectCode: 'ALG', subject: 'Algorithmique', frequency: '1/15' };

describe('template engine', () => {
  it('renders each token and splits lines on \\n', () => {
    expect(renderTemplate('{teacher}\n{group} — {subjectCode} {subject}', fields)).toEqual([
      'Prof Dupont', 'G1 — ALG Algorithmique',
    ]);
  });

  it('drops empty tokens and cleans dangling separators', () => {
    expect(renderTemplate('{teacher} — {subject} — {frequency}', { ...fields, subject: '', frequency: '' })).toEqual(['Prof Dupont']);
    expect(renderTemplate('{group} / {subjectCode}', { ...fields, group: '' })).toEqual(['ALG']);
  });

  it('keeps one separator when an empty token sits between two separators', () => {
    expect(renderTemplate('{teacher} — {group} — {subject}', { ...fields, group: '' })).toEqual(['Prof Dupont — Algorithmique']);
    expect(renderTemplate('{teacher} - {group} - {subject}', { ...fields, group: '' })).toEqual(['Prof Dupont - Algorithmique']);
  });

  it('preserves literal punctuation that is not adjacent to an empty token', () => {
    // No empty token: leading/trailing separators in the template are literal.
    expect(renderTemplate('- {teacher} -', fields)).toEqual(['- Prof Dupont -']);
    expect(renderTemplate('{teacher} / {group}', fields)).toEqual(['Prof Dupont / G1']);
    // Empty token at the edge still strips the dangling separator.
    expect(renderTemplate('{subject} — {teacher}', { ...fields, subject: '' })).toEqual(['Prof Dupont']);
    expect(renderTemplate('{teacher} — {subject}', { ...fields, subject: '' })).toEqual(['Prof Dupont']);
  });

  it('protects token values from separator cleanup', () => {
    expect(renderTemplate('{subject} — {teacher}', { ...fields, subject: 'Maths (avancée)' })).toEqual(['Maths (avancée) — Prof Dupont']);
  });

  it('returns no lines for an empty template', () => {
    expect(renderTemplate('', fields)).toEqual([]);
    expect(renderTemplate('\n\n', fields)).toEqual([]);
  });

  it('isLegacyTemplate only matches the historical default', () => {
    expect(isLegacyTemplate('{teacher}')).toBe(true);
    expect(isLegacyTemplate('{teacher}\n{group}')).toBe(false);
    expect(isLegacyTemplate('')).toBe(false);
  });

  it('subjectDisplay honours mode and max length', () => {
    const f = { subjectCode: 'ALG', subject: 'Algorithmique et structures de données' };
    expect(subjectDisplay(f, { ...DEFAULT_OPTIONS, subjectMode: 'full' })).toBe(f.subject);
    expect(subjectDisplay(f, { ...DEFAULT_OPTIONS, subjectMode: 'code' })).toBe('ALG');
    expect(subjectDisplay(f, { ...DEFAULT_OPTIONS, subjectMode: 'both' })).toBe('ALG Algorithmique et structures de données');
    expect(subjectDisplay(f, { ...DEFAULT_OPTIONS, subjectMode: 'full', subjectMaxLength: 10 })).toBe('Algorithm…');
    expect(subjectDisplay(f, { ...DEFAULT_OPTIONS, subjectMode: 'full', subjectMaxLength: 0 })).toBe(f.subject);
  });

  it('truncateSubject handles edge lengths', () => {
    expect(truncateSubject('abc', 0)).toBe('abc');
    expect(truncateSubject('abc', 3)).toBe('abc');
    expect(truncateSubject('abc', 2)).toBe('a…');
    expect(truncateSubject('abc', 1)).toBe('…');
  });

  it('truncateSubject does not split surrogate pairs or grapheme clusters', () => {
    // "é" as e + combining accent is a single grapheme but two UTF-16 units.
    expect(truncateSubject('école', 3)).toBe('éc…');
    // Astral characters (surrogate pairs) count as one grapheme.
    expect(truncateSubject('𝄞abc', 4)).toBe('𝄞abc');
    expect(truncateSubject('𝄞abc', 3)).toBe('𝄞a…');
  });

  it('joinGroups uses the configured separator', () => {
    expect(joinGroups('G1, G2', ', ')).toBe('G1, G2');
    expect(joinGroups('G1, G2', ' + ')).toBe('G1 + G2');
    expect(joinGroups('G1,, G2', ', ')).toBe('G1, G2');
  });
});

describe('options validation and migration', () => {
  it('assertValidTemplate accepts known tokens and rejects unknown ones', () => {
    expect(() => assertValidTemplate('{teacher} {group} {subjectCode} {subject} {frequency}')).not.toThrow();
    expect(() => assertValidTemplate('{bogus}')).toThrow(/Jeton inconnu/);
    expect(() => assertValidTemplate('{teacher')).not.toThrow(); // unclosed brace is literal text
    expect(() => assertValidTemplate('x'.repeat(501))).toThrow(/500/);
  });

  it('normalizeOptions migrates a legacy unversioned object to v2 defaults', () => {
    const legacy = { abbreviateBen: false, pauseLabel: 'Déjeuner', blocs: [{ title: 'BLOC « X »', patterns: ['^X'] }] };
    const o = normalizeOptions(legacy);
    expect(o.optionsVersion).toBe(2);
    expect(o.abbreviateBen).toBe(false);
    expect(o.pauseLabel).toBe('Déjeuner');
    expect(o.cellTemplate).toBe('{teacher}');
    expect(o.subjectMode).toBe('full');
    expect(o.orientation).toBe('portrait');
    expect(o.blocs[0]).toMatchObject({ title: 'BLOC « X »', patterns: ['^X'] });
    expect(o.blocs[0].id).toBeTruthy();
    expect(o.blocs[0].page).toBe(1);
  });

  it('normalizeOptions falls back to defaults for invalid values in non-strict mode', () => {
    const o = normalizeOptions({ cellTemplate: '{bogus}', subjectMode: 'weird', cellFontSize: 'abc', orientation: 'sideways' });
    expect(o.cellTemplate).toBe('{teacher}');
    expect(o.subjectMode).toBe('full');
    expect(o.cellFontSize).toBe(10);
    expect(o.orientation).toBe('portrait');
    // Out-of-range numbers clamp to the allowed bounds.
    expect(normalizeOptions({ cellFontSize: 99 }).cellFontSize).toBe(12);
    expect(normalizeOptions({ cellFontSize: 1 }).cellFontSize).toBe(7);
  });

  it('normalizeOptions throws French errors in strict mode', () => {
    expect(() => normalizeOptions({ cellTemplate: '{bogus}' }, true)).toThrow(/Jeton inconnu/);
    expect(() => normalizeOptions({ blocs: [] }, true)).toThrow(/Au moins un bloc/);
    expect(() => normalizeOptions({ blocs: [{ title: 'X', patterns: ['['] }] }, true)).toThrow(/invalide/);
  });

  it('normalizeOptions validates scalar fields in strict mode', () => {
    expect(() => normalizeOptions({ subjectMode: 'weird' }, true)).toThrow(/subjectMode/);
    expect(() => normalizeOptions({ orientation: 'sideways' }, true)).toThrow(/orientation/);
    expect(() => normalizeOptions({ cellFontSize: 99 }, true)).toThrow(/cellFontSize/);
    expect(() => normalizeOptions({ cellFontSize: 'big' }, true)).toThrow(/cellFontSize/);
    expect(() => normalizeOptions({ subjectMaxLength: -1 }, true)).toThrow(/subjectMaxLength/);
    expect(() => normalizeOptions({ detailItalic: 'yes' }, true)).toThrow(/detailItalic/);
    expect(() => normalizeOptions({ pauseLabel: 42 }, true)).toThrow(/pauseLabel/);
    // Valid scalars pass through unchanged.
    const o = normalizeOptions({ subjectMode: 'code', orientation: 'landscape', cellFontSize: 11, detailItalic: true }, true);
    expect(o.subjectMode).toBe('code');
    expect(o.orientation).toBe('landscape');
    expect(o.cellFontSize).toBe(11);
    expect(o.detailItalic).toBe(true);
  });

  it('normalizeOptions restores default bloc patterns when non-strict sanitization empties them', () => {
    const o = normalizeOptions({
      blocs: [
        { id: 'bloc-a', title: 'Amphi', patterns: ['['] },
        { id: 'custom', title: 'Custom', patterns: [123, ''] },
      ],
    });
    // bloc-a matches the default 'bloc-a' id → Amphi patterns restored.
    expect(o.blocs[0].patterns).toEqual(['^A\\d\\d']);
    // custom has no default match at index 1 → falls back to the positional default.
    expect(o.blocs[1].patterns.length).toBeGreaterThan(0);
  });

  it('normalizeOptions restores positional default patterns for unmatched blocs', () => {
    const o = normalizeOptions({ blocs: [{ title: 'X', patterns: ['['] }] });
    // Single custom bloc at index 0 restores positional default patterns, so it survives.
    expect(o.blocs.length).toBeGreaterThan(0);
    expect(o.blocs[0].patterns.length).toBeGreaterThan(0);
  });

  it('mergeOptions keeps legacy shallow-merge semantics', () => {
    expect(mergeOptions({ pauseLabel: 'Break' }).pauseLabel).toBe('Break');
    expect(mergeOptions({ blocs: [] }).blocs).toEqual(DEFAULT_OPTIONS.blocs);
    expect(mergeOptions(null).optionsVersion).toBe(2);
  });

  it('normalizeProfilesState migrates a single legacy options object into one Standard profile', () => {
    const state = normalizeProfilesState({ abbreviateBen: false });
    expect(state.defaultId).toBe('default');
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].name).toBe('Standard');
    expect(state.profiles[0].options.abbreviateBen).toBe(false);
  });

  it('normalizeProfilesState keeps multiple profiles and resolves the default', () => {
    const state = normalizeProfilesState({
      defaultId: 'b',
      profiles: [
        { id: 'a', name: 'Un', options: { cellTemplate: '{teacher}\n{group}' } },
        { id: 'b', name: 'Deux', options: {} },
      ],
    });
    expect(state.defaultId).toBe('b');
    expect(state.profiles).toHaveLength(2);
    expect(state.profiles[0].options.cellTemplate).toBe('{teacher}\n{group}');
  });

  it('normalizeProfilesState deduplicates profile ids', () => {
    const state = normalizeProfilesState({
      profiles: [
        { id: 'x', name: 'Un', options: {} },
        { id: 'x', name: 'Deux', options: {} },
      ],
    });
    expect(new Set(state.profiles.map((p) => p.id)).size).toBe(2);
  });

  it('sanitizeProfileFileName and dayFileName produce safe names', () => {
    expect(sanitizeProfileFileName('A/B:C*D?')).toBe('ABCD');
    expect(sanitizeProfileFileName('  nom.  ')).toBe('nom');
    expect(dayFileName('Jeudi', null, true)).toBe('Jeudi.docx');
    expect(dayFileName('Jeudi', { id: 'p', name: 'Compact', options: DEFAULT_OPTIONS }, false)).toBe('Jeudi - Compact.docx');
    expect(dayFileName('Jeudi', { id: 'p', name: 'A/B', options: DEFAULT_OPTIONS }, false)).toBe('Jeudi - AB.docx');
  });
});

describe('buildDayGrid rich cells and page grouping', () => {
  it('keeps legacy plain-text cells for the default template', () => {
    const grid = buildDayGrid([session()], meta, 0, DEFAULT_OPTIONS);
    const row = grid.blocs[0].rows.find((r) => r.room === 'A01');
    expect(row?.cells[0]).toBe('Prof Dupont');
    expect(row?.details).toBeUndefined();
    expect(grid.pages).toBeUndefined();
  });

  it('renders multi-line rich cells and exposes details for a custom template', () => {
    const options = { ...DEFAULT_OPTIONS, cellTemplate: '{teacher}\n{group} — {subjectCode} {subject}' };
    const grid = buildDayGrid([session()], meta, 0, options);
    const row = grid.blocs[0].rows.find((r) => r.room === 'A01');
    expect(row?.details?.[0]).toEqual([{ lines: ['Prof Dupont', 'G1 — ALG Algorithmique'] }]);
    // Plain-text projection joins the lines.
    expect(row?.cells[0]).toBe('Prof Dupont\nG1 — ALG Algorithmique');
  });

  it('deduplicates identical rendered sessions in the same cell', () => {
    const options = { ...DEFAULT_OPTIONS, cellTemplate: '{teacher}\n{group}' };
    const grid = buildDayGrid([session(), session({ teachers: 'Prof Dupont' })], meta, 0, options);
    const row = grid.blocs[0].rows.find((r) => r.room === 'A01');
    expect(row?.details?.[0]).toHaveLength(1);
  });

  it('groups blocs onto pages only when more than one page is configured', () => {
    const single = buildDayGrid([session({ room: 'A01' }), session({ room: 'B12', slot: 1 })], meta, 0, DEFAULT_OPTIONS);
    expect(single.pages).toBeUndefined();

    const options = {
      ...DEFAULT_OPTIONS,
      blocs: [
        { id: 'a', page: 1, title: 'BLOC « A »', patterns: ['^A'] },
        { id: 'b', page: 2, title: 'BLOC « B »', patterns: ['^B'] },
      ],
    };
    const grid = buildDayGrid([session({ room: 'A01' }), session({ room: 'B12', slot: 1 })], meta, 0, options);
    expect(grid.pages).toEqual([{ page: 1, blocs: [0] }, { page: 2, blocs: [1] }]);
    expect(grid.blocs[0].page).toBe(1);
    expect(grid.blocs[1].page).toBe(2);
  });
});

describe('buildDayDocx layout', () => {
  const roomsFile = path.join(__dirname, 'fixtures', 'FET_rooms_test.html');
  const parsed = parseHtml(fs.readFileSync(roomsFile, 'utf8'), 'rooms');
  const pmeta = { days: parsed.days, slots: parsed.slots, rooms: parsed.owners };

  async function documentXml(grid: ReturnType<typeof buildDayGrid>, options = DEFAULT_OPTIONS) {
    const buffer = await buildDayDocx(grid, options);
    const zip = await JSZip.loadAsync(buffer);
    return zip.file('word/document.xml')?.async('string') ?? '';
  }
  const $ = (xml: string) => cheerio.load(xml, { xmlMode: true });
  const tagged = (xml: string, name: string) => $(xml)('*').filter((_, el) => el.type === 'tag' && el.name === name);

  it('produces a single portrait section for the legacy layout', async () => {
    const grid = buildDayGrid(parsed.sessions, pmeta, 0, DEFAULT_OPTIONS);
    const xml = await documentXml(grid);
    expect(tagged(xml, 'w:pgSz')).toHaveLength(1);
    // Portrait is the default; the docx library may emit it explicitly.
    expect(tagged(xml, 'w:pgSz').first().attr('w:orient') ?? 'portrait').toBe('portrait');
  });

  it('emits landscape orientation when configured', async () => {
    const options = { ...DEFAULT_OPTIONS, orientation: 'landscape' as const };
    const grid = buildDayGrid(parsed.sessions, pmeta, 0, options);
    const xml = await documentXml(grid, options);
    const pgSz = tagged(xml, 'w:pgSz');
    expect(pgSz.length).toBeGreaterThan(0);
    expect(pgSz.first().attr('w:orient')).toBe('landscape');
  });

  it('splits into multiple sections and repeats the header per page when configured', async () => {
    const options = {
      ...DEFAULT_OPTIONS,
      repeatDayHeader: true,
      blocs: [
        { id: 'a', page: 1, title: 'BLOC « A »', patterns: ['^A\\d'] },
        { id: 'b', page: 2, title: 'BLOC « Amphi »', patterns: ['^Amphi'] },
      ],
    };
    const grid = buildDayGrid(parsed.sessions, pmeta, 0, options);
    expect(grid.pages?.length).toBe(2);
    const xml = await documentXml(grid, options);
    // Two page groups → two sections → two pgSz elements.
    expect(tagged(xml, 'w:pgSz').length).toBe(2);
    // Day name appears in each repeated header.
    const dayName = grid.dayName;
    const occurrences = xml.split(dayName).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('shows a page title paragraph when showPageTitle is set', async () => {
    const options = { ...DEFAULT_OPTIONS, showPageTitle: true };
    const grid = buildDayGrid(parsed.sessions, pmeta, 0, options);
    const xml = await documentXml(grid, options);
    // The page title joins the bloc titles with ' · ' as a standalone paragraph.
    const expected = grid.blocs.map((b) => b.title).join(' · ');
    expect(expected.length).toBeGreaterThan(0);
    expect(xml).toContain(expected);
    // It is a bold paragraph placed before the first table.
    const titleIdx = xml.indexOf(expected);
    const tableIdx = xml.indexOf('<w:tbl>');
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    expect(tableIdx).toBeGreaterThan(titleIdx);
    expect(xml.slice(Math.max(0, titleIdx - 400), titleIdx)).toContain('<w:b/>');
  });

  it('does not repeat the day header on later page groups when repeatDayHeader is false', async () => {
    const options = {
      ...DEFAULT_OPTIONS,
      repeatDayHeader: false,
      blocs: [
        { id: 'a', page: 1, title: 'BLOC « A »', patterns: ['^A\\d'] },
        { id: 'b', page: 2, title: 'BLOC « Amphi »', patterns: ['^Amphi'] },
      ],
    };
    const grid = buildDayGrid(parsed.sessions, pmeta, 0, options);
    expect(grid.pages?.length).toBe(2);
    const xml = await documentXml(grid, options);
    // Two sections → two tables, but the day name header appears only once.
    expect(tagged(xml, 'w:tbl').length).toBe(2);
    const occurrences = xml.split(grid.dayName).length - 1;
    expect(occurrences).toBe(1);
    // The header row must not be marked as a repeating table header.
    expect(xml).not.toContain('w:tblHeader');
  });

  it('marks the header row as repeating when repeatDayHeader is true', async () => {
    const options = {
      ...DEFAULT_OPTIONS,
      repeatDayHeader: true,
      blocs: [
        { id: 'a', page: 1, title: 'BLOC « A »', patterns: ['^A\\d'] },
        { id: 'b', page: 2, title: 'BLOC « Amphi »', patterns: ['^Amphi'] },
      ],
    };
    const grid = buildDayGrid(parsed.sessions, pmeta, 0, options);
    const xml = await documentXml(grid, options);
    expect(xml).toContain('w:tblHeader');
  });

  it('honours cellFontSize in the legacy plain-cell layout', async () => {
    const options = { ...DEFAULT_OPTIONS, cellFontSize: 9 };
    const grid = buildDayGrid(parsed.sessions, pmeta, 0, options);
    const xml = await documentXml(grid, options);
    // 9pt → 18 half-points on session cells.
    expect(xml).toContain('w:sz w:val="18"');
  });

  it('preserves non-contiguous page numbers in section properties', async () => {
    const options = {
      ...DEFAULT_OPTIONS,
      blocs: [
        { id: 'a', page: 1, title: 'BLOC « A »', patterns: ['^A\\d'] },
        { id: 'b', page: 3, title: 'BLOC « Amphi »', patterns: ['^Amphi'] },
      ],
    };
    const grid = buildDayGrid(parsed.sessions, pmeta, 0, options);
    expect(grid.pages).toEqual([{ page: 1, blocs: [0] }, { page: 3, blocs: [1] }]);
    const xml = await documentXml(grid, options);
    // The second section restarts numbering at the configured page (3).
    expect(xml).toContain('w:start="3"');
  });

  it('renders rich multi-line cells with the configured font size', async () => {
    const options = { ...DEFAULT_OPTIONS, cellTemplate: '{teacher}\n{group} — {subject}', cellFontSize: 9, detailItalic: true };
    const grid = buildDayGrid(parsed.sessions, pmeta, 0, options);
    const xml = await documentXml(grid, options);
    // The fixture contains a "Physique" session rendered through the {subject} token.
    expect(xml).toContain('Physique');
    expect(xml).toContain('Grp-C3');
    // cellFontSize 9pt → 18 half-points for primary lines.
    expect(xml).toContain('w:sz w:val="18"');
    // detailItalic → secondary lines carry w:i.
    expect(xml).toContain('<w:i/>');
  });
});
