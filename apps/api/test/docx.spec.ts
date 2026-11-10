import * as fs from 'node:fs';
import * as path from 'node:path';
import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { buildDayDocx } from '../src/export/docx-builder';
import { buildDayGrid } from '../src/export/grid-builder';
import { DEFAULT_OPTIONS } from '../src/export/options';
import { parseHtml } from '../src/parser/html-parser';

const roomsFile = path.join(__dirname, 'fixtures', 'FET_rooms_test.html');
const parsed = parseHtml(fs.readFileSync(roomsFile, 'utf8'), 'rooms');
const meta = { days: parsed.days, slots: parsed.slots, rooms: parsed.owners };

describe('Word documents', () => {
  it('matches the reviewed Monday DayGrid golden file', () => {
    expect(buildDayGrid(parsed.sessions, meta, 0, DEFAULT_OPTIONS)).toMatchSnapshot();
  });

  it('builds six readable documents with the reference table layout and fixture sessions', async () => {
    const names: string[] = [];
    for (let day = 0; day < parsed.days.length; day++) {
      const buffer = await buildDayDocx(buildDayGrid(parsed.sessions, meta, day, DEFAULT_OPTIONS));
      const zip = await JSZip.loadAsync(buffer);
      const xml = await zip.file('word/document.xml')?.async('string');
      expect(xml).toBeDefined();
      const $ = cheerio.load(xml!, { xmlMode: true });
      const tagged = (name: string) => $('*').filter((_, element) => element.type === 'tag' && element.name === name);
      const tables = tagged('w:tbl');
      const rows = tables.first().find('*').filter((_, element) => element.name === 'w:tr');
      expect(tables.length).toBe(1);
      expect(rows.first().find('*').filter((_, element) => element.name === 'w:tc').length).toBe(7);
      expect(rows.first().text()).toContain(parsed.days[day]);
      expect(tagged('w:gridCol').length).toBe(7);
      const pageSize = tagged('w:pgSz').first();
      expect(pageSize.attr('w:w')).toBe('11906');
      expect(pageSize.attr('w:h')).toBe('16838');
      const text = tagged('w:document').text();
      if (day === 0) {
        expect(text).toContain('A 0-1');
        expect(text).toContain('BLOC « A »');
        expect(text).toContain('Prof Dupont 1/15');
        expect(text).toContain('Prof Laurent');
        const spans = tagged('w:gridSpan').toArray().map((el) => $(el).attr('w:val'));
        expect(spans).toContain('7');
        const fills = tagged('w:shd').toArray().map((el) => $(el).attr('w:fill'));
        expect(fills).toContain('FFFF99');
        expect(fills).toContain('C2D69B');
        expect(fills).toContain('B8CCE4');
      }
      if (parsed.days[day] === 'Jeudi') {
        expect(text).toContain('Prof Martin');
        expect(text).toContain('A 0-1');
      }
      names.push(`${parsed.days[day]}.docx`);
    }
    expect(names).toEqual(['Lundi.docx', 'Mardi.docx', 'Mercredi.docx', 'Jeudi.docx', 'Vendredi.docx', 'Samedi.docx']);
  });
});
