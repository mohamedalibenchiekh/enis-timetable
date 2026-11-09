import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { clean, detectKind, parseHtml, parseSlotLabel, splitSubject } from '../src/parser/html-parser';

const fixtureDir = path.join(__dirname, 'fixtures');
const readFixture = (name: string) => fs.readFileSync(path.join(fixtureDir, name), 'utf8');

describe('parser helpers', () => {
  it.each([
    ['ordinary spacing', '  a   b  ', 'a b'],
    ['non-breaking spaces', 'A\u00a0\u00a0B', 'A B'],
    ['missing value', undefined, ''],
  ])('clean: %s', (_label, input, expected) => {
    expect(clean(input)).toBe(expected);
  });

  it.each([
    ['T322 | Processus stochastiques (1/15)', 'T322', 'Processus stochastiques', '1/15'],
    ['T 322  |  Processus   stochastiques', 'T 322', 'Processus stochastiques', ''],
    ['Analyse', '', 'Analyse', ''],
    ['(1 / 15) Matière', '', '(1 / 15) Matière', ''],
    [' | Matière ', '', 'Matière', ''],
  ])('splitSubject parses %j', (input, code, subject, frequency) => {
    expect(splitSubject(input)).toEqual({ code, subject, frequency });
  });

  it.each([
    ['8:00 - 9:30', '8:00-9:30', {}, ''],
    ['13:00-14:30 (V: 14:00-15:30)', '13:00-14:30', { 4: '14:00-15:30' }, ''],
    ['11:30-13:00 (M/S: 12:00-13:30)', '11:30-13:00', { 2: '12:00-13:30', 5: '12:00-13:30' }, ''],
    ['10:00-11:00 (Rat.)', '10:00-11:00', {}, 'Rat.'],
    ['horaire inconnu', 'horaire inconnu', {}, ''],
  ])('parseSlotLabel parses %j', (raw, base, overrides, note) => {
    expect(parseSlotLabel(raw)).toEqual({ raw, base, overrides, note });
  });

  it.each([
    ['export_teachers.html', undefined, 'teachers'],
    ['FET_salles.html', undefined, 'rooms'],
    ['FET_groupes.html', undefined, 'groups'],
    ['export.html', '<html><title>Table des matières</title><li><a href="#table_1">Année Groupe 1</a></li></html>', 'groups'],
    ['export.html', '<html></html>', null],
  ] as const)('detectKind: %s', (filename, html, expected) => {
    expect(detectKind(filename, html ?? undefined)).toBe(expected);
  });
});

describe('parseHtml on synthetic FET fixtures', () => {
  const roomsHtml = readFixture('FET_rooms_test.html');
  const teachersHtml = readFixture('FET_teachers_test.html');
  const groupsHtml = readFixture('FET_groups_test.html');
  const rooms = parseHtml(roomsHtml, 'rooms');
  const teachers = parseHtml(teachersHtml, 'teachers');
  const groups = parseHtml(groupsHtml, 'groups');

  it('parses a simple room cell exactly, including frequency', () => {
    expect(rooms.sessions.find((s) => s.owner === 'A01' && s.day === 0 && s.slot === 0)).toMatchObject({
      owner: 'A01', day: 0, slot: 0, groups: 'Grp-A1', teachers: 'Prof Dupont', subjectCode: 'T101',
      subject: 'Analyse', room: 'A01', frequency: '1/15',
    });
  });

  it('carries a rowspan into every covered slot without shifting later day columns', () => {
    expect(rooms.sessions.filter((s) => s.owner === 'A01' && s.subjectCode === 'T301')
      .map(({ day, slot, room }) => [day, slot, room])).toEqual([[0, 1, 'A01'], [0, 2, 'A01']]);
    expect(rooms.sessions.find((s) => s.subjectCode === 'T201')).toMatchObject({ day: 3, slot: 0, room: 'A01' });
  });

  it('filters detailed room and teacher cells to the owner, including comma-separated teacher ownership', () => {
    expect(rooms.sessions.filter((s) => s.owner === 'B01').map((s) => [s.room, s.subjectCode, s.teachers]))
      .toEqual([['B01', 'T401', 'Prof Moreau, Prof Bernard']]);
    expect(rooms.sessions.filter((s) => s.owner === 'B02').map((s) => [s.room, s.subjectCode]))
      .toEqual([['B02', 'T501']]);
    expect(teachers.sessions.some((s) => s.owner === 'Prof Moreau' && s.subjectCode === 'T401')).toBe(true);
    expect(teachers.sessions.some((s) => s.owner === 'Prof Bernard' && s.subjectCode === 'T401')).toBe(true);
    expect(teachers.sessions.some((s) => s.owner === 'Prof Bernard' && s.subjectCode === 'T501')).toBe(true);
  });

  it('parses groups view sessions and ignores empty cells and duplicate activities', () => {
    expect(groups.kind).toBe('groups');
    expect(groups.sessions.find((s) => s.subjectCode === 'T201')).toMatchObject({
      owner: 'Grp-B2', day: 3, slot: 0, groups: 'Grp-B2', teachers: 'Prof Martin', subjectCode: 'T201', subject: 'Algèbre', room: 'A01',
    });
    expect(groups.sessions.filter((s) => s.subjectCode === 'T401')).toHaveLength(1);
    expect(rooms.sessions.some((s) => s.subject === '---' || !s.subjectCode)).toBe(false);
    const unique = new Set(rooms.sessions.map((s) => [s.day, s.slot, s.groups, s.teachers, s.subjectCode, s.room, s.owner].join('|')));
    expect(unique.size).toBe(rooms.sessions.length);
    expect(groups.sessions.find((s) => s.subjectCode === 'T700')).toMatchObject({ room: '', teachers: 'Prof Sanssalle' });
    expect(rooms.sessions.find((s) => s.subjectCode === 'T700')).toMatchObject({ room: 'A03', teachers: '' });
  });

  it('room and teacher views describe the same (day, slot, room, teacher, subject code) set', () => {
    const keys = (items: typeof rooms.sessions) => [...new Set(items.flatMap((s) => s.teachers.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).map((teacher) =>
      [s.day, s.slot, s.room.trim().toLowerCase(), teacher, s.subjectCode].join('|'))))].sort();
    expect(keys(rooms.sessions)).toEqual(keys(teachers.sessions));
  });
});
