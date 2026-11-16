import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CsvImporter } from '../src/importers/csv/csv-importer.js';
import { HtmlImporter } from '../src/importers/html/html-importer.js';
import { detectSubColumns, TextItem } from '../src/importers/pdf/pdf-geometry.js';
import { parseHtml } from '../src/parser/html-parser.js';

describe('Equivalence and Cross-View Parity Suite', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');
  const readFixture = (name: string) => fs.readFileSync(path.join(fixturesDir, name));

  it('proves CSV derived views match reference fixture expectations', async () => {
    const csvImporter = new CsvImporter();
    const csvBuf = readFixture('synthetic_timetable.csv');

    const result = await csvImporter.parse({
      originalname: 'synthetic_timetable.csv',
      buffer: csvBuf,
    });

    const [rooms, teachers, groups] = result.parsed;

    // Rooms view: 7 sessions
    expect(rooms.sessions.length).toBe(7);
    expect(rooms.owners).toEqual(['A01', 'A03', 'B01', 'B02']);

    // Check specific session equivalence
    const a01Sess0 = rooms.sessions.find((s) => s.owner === 'A01' && s.day === 0 && s.slot === 0);
    expect(a01Sess0).toMatchObject({
      day: 0,
      slot: 0,
      groups: 'Grp-A1',
      teachers: 'Prof Dupont',
      subjectCode: 'T101',
      subject: 'Analyse',
      frequency: '1/15',
      room: 'A01',
    });

    // Multi-slot activity: spans slots 1 and 2 on Lundi
    const multiSlot = rooms.sessions.filter((s) => s.owner === 'A01' && s.subjectCode === 'T301');
    expect(multiSlot.map((s) => [s.day, s.slot])).toEqual([
      [0, 1],
      [0, 2],
    ]);

    // Teachers view: check that multi-teacher "Prof Moreau+Prof Bernard" splits into both teachers
    expect(teachers.owners).toContain('Prof Moreau');
    expect(teachers.owners).toContain('Prof Bernard');
    expect(teachers.sessions.some((s) => s.owner === 'Prof Moreau' && s.subjectCode === 'T401')).toBe(true);
    expect(teachers.sessions.some((s) => s.owner === 'Prof Bernard' && s.subjectCode === 'T401')).toBe(true);
  });

  it('cross-view parity: rooms view and teachers view describe identical sessions (excluding empty rooms/teachers)', async () => {
    const csvImporter = new CsvImporter();
    const csvBuf = readFixture('synthetic_timetable.csv');

    const result = await csvImporter.parse({
      originalname: 'synthetic_timetable.csv',
      buffer: csvBuf,
    });

    const [rooms, teachers] = result.parsed;

    // Cross-check two-way parity: rooms keys equal teachers keys
    const roomsKeys = new Set<string>();
    for (const rs of rooms.sessions) {
      if (!rs.room || !rs.teachers) continue;
      const teacherNames = rs.teachers.split(',').map((t) => t.trim());
      for (const tName of teacherNames) {
        roomsKeys.add(`${rs.day}|${rs.slot}|${rs.room}|${tName}|${rs.subjectCode ?? ''}`);
      }
    }

    const teachersKeys = new Set<string>();
    for (const ts of teachers.sessions) {
      if (!ts.room || !ts.owner) continue;
      teachersKeys.add(`${ts.day}|${ts.slot}|${ts.room}|${ts.owner}|${ts.subjectCode ?? ''}`);
    }

    expect(roomsKeys.size).toBeGreaterThan(0);
    expect(roomsKeys).toEqual(teachersKeys);
  });

  it('preserves byte-for-byte HTML parser output with HTML importer', async () => {
    const htmlBuf = readFixture('FET_rooms_test.html');
    const directParsed = parseHtml(htmlBuf.toString('utf8'), 'rooms');

    const htmlImporter = new HtmlImporter();
    const result = await htmlImporter.parse({
      originalname: 'FET_rooms_test.html',
      buffer: htmlBuf,
    });

    expect(result.report.origin).toBe('html');
    expect(result.report.errors).toEqual([]);
    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0]).toEqual(directParsed);

    // All original test invariants hold unchanged
    expect(directParsed.owners).toEqual(['A01', 'B01', 'B02', 'Amphi', 'A03']);
    expect(directParsed.sessions.length).toBe(7);
  });

  it('detects sub-columns across adjacent items even when Y baselines span > 3pt', () => {
    // Two parallel activities side by side in a cell of width 100 (left 0, right 100)
    // Left activity has 2 fragments on the first line: (x=10, y=100) and (x=28, y=98)
    // Right activity has 2 fragments on the same visual line: (x=60, y=96.5) and (x=78, y=96)
    // Notice y spans from 100 down to 96 (> 3pt difference from the first item),
    // but adjacent items are close and there is a >12pt gap between x=28+10=38 and x=60.
    const items: TextItem[] = [
      { str: 'Grp-A', x: 10, y: 100, w: 15, h: 8 },
      { str: '(TD)', x: 28, y: 98, w: 10, h: 8 },
      { str: 'Grp-B', x: 60, y: 96.5, w: 15, h: 8 },
      { str: '(TP)', x: 78, y: 96, w: 10, h: 8 },
    ];

    const subCols = detectSubColumns(items, 0, 100);
    expect(subCols).toHaveLength(2);
    expect(subCols[0].map((i) => i.str)).toEqual(['Grp-A', '(TD)']);
    expect(subCols[1].map((i) => i.str)).toEqual(['Grp-B', '(TP)']);
  });
});
