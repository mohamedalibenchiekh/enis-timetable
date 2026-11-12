import { describe, expect, it } from 'vitest';
import { buildDayGrid, formatTeacher, roomLabel } from '../src/export/grid-builder';
import { DEFAULT_OPTIONS, mergeOptions } from '../src/export/options';
import { parseSlotLabel } from '../src/parser/html-parser';
import { ParsedSession } from '../src/parser/types';
import { createNameResolver } from '../src/export/name-resolver';
import { normalizeName, validateDisplayName } from '../src/names/name-normalization';

const session = (fields: Partial<ParsedSession> = {}): Pick<ParsedSession, 'day' | 'slot' | 'room' | 'teachers' | 'groups' | 'subjectCode' | 'subject' | 'frequency'> => ({
  day: 0, slot: 0, room: 'A01', teachers: 'BEN RHOUMA Asma', groups: 'G1', subjectCode: 'ALG', subject: 'Algorithmique', frequency: '', ...fields,
});
const meta = {
  days: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
  slots: ['08:00-09:30', '11:30-13:00 (M/S: 12:00-13:30)', '14:30-16:00 (V: 14:00-15:30)', '12:00-13:30']
    .map(parseSlotLabel),
  rooms: ['A01', 'A02', 'B12 (Labo Anglais)', 'R01', 'Amphi', 'Hors bloc'],
};

describe('formatTeacher and roomLabel', () => {
  it.each([
    ['BEN RHOUMA Asma', true, 'B Rhouma Asma'], ['BEN RHOUMA Asma', false, 'Ben Rhouma Asma'],
    ['Jean-Pierre O’Neil', false, 'Jean-Pierre O’Neil'], ['ÉLODIE D’AMOUR', false, 'Élodie D’Amour'],
    ['Ben Rhouma', true, 'Ben Rhouma'], ['', true, ''], ['-', true, ''],
  ])('formatTeacher(%j, %s)', (input, abbreviate, expected) => expect(formatTeacher(input, abbreviate)).toBe(expected));

  it.each([
    ['A02', 'A 0-2'], ['B12 (Labo Anglais)', 'B 1-2'], ['Amphi', 'Amphi'], ['Salle polyvalente', 'Salle polyvalente'],
  ])('roomLabel(%j)', (room, expected) => expect(roomLabel(room)).toBe(expected));
});

describe('mergeOptions', () => {
  it('keeps defaults for an empty bloc list while applying other values', () => {
    expect(mergeOptions({ blocs: [], pauseLabel: 'Break' })).toEqual({ ...DEFAULT_OPTIONS, pauseLabel: 'Break' });
  });

  it('uses non-empty bloc overrides', () => {
    const blocs = [{ title: 'BLOC TEST', patterns: ['^X'] }];
    expect(mergeOptions({ blocs }).blocs).toEqual(blocs);
  });
});

describe('name overrides', () => {
  it('normalizes accents, whitespace, non-breaking spaces, and case for keys', () => {
    expect(normalizeName('  ÉLODIE\u00a0  D’Amour  ')).toBe('elodie d’amour');
    expect(normalizeName('Salle ^3 `test`')).toBe('salle ^3 `test`');
  });

  it('treats a blank display value as override removal and trims valid display values', () => {
    expect(validateDisplayName('   ', 1)).toBeNull();
    expect(validateDisplayName('  Hanafi Latifa  ', 1)).toBe('Hanafi Latifa');
  });

  it('uses overrides verbatim before automatic formatting and applies frequency afterward', () => {
    const resolver = createNameResolver(
      new Map([[normalizeName('BEN RHOUMA Asma'), 'Hanafi Latifa']]),
      new Map([[normalizeName('Amphi'), 'Amphi 1']]),
    );
    const grid = buildDayGrid(
      [session({ teachers: 'BEN RHOUMA Asma', room: 'Amphi', frequency: '1/15' })],
      meta,
      0,
      DEFAULT_OPTIONS,
      resolver,
    );
    const row = grid.blocs.flatMap((bloc) => bloc.rows).find((item) => item.room === 'Amphi');
    expect(row?.label).toBe('Amphi 1');
    expect(row?.cells[0]).toBe('Hanafi Latifa 1/15');
  });

  it('resolves comma-separated teachers independently and preserves automatic formatting for others', () => {
    const resolver = createNameResolver(
      new Map([[normalizeName('BEN RHOUMA Asma'), 'Ben Rhouma Asma']]),
      new Map(),
    );
    const grid = buildDayGrid(
      [session({ teachers: 'BEN RHOUMA Asma,Prof Dupont' })],
      meta,
      0,
      DEFAULT_OPTIONS,
      resolver,
    );
    expect(grid.blocs[0].rows[0].cells[0]).toBe('Ben Rhouma Asma / Prof Dupont');
  });
});

describe('buildDayGrid', () => {
  it('assigns rooms by regex, orders numbered rooms before Amphi, and formats labels', () => {
    const grid = buildDayGrid([session({ room: 'A02' })], meta, 0, DEFAULT_OPTIONS);
    expect(grid.blocs.map((b) => [b.title, b.rows.map((r) => r.room)])).toEqual([
      ['BLOC « A »', ['A01', 'A02']], ['BLOC « B »', ['B12 (Labo Anglais)']],
      ['BLOC « R »', ['R01', 'Amphi']],
    ]);
    expect(grid.blocs[0].rows[1].label).toBe('A 0-2');
  });

  it.each([[true, 2], [false, 1]])('includes empty rooms = %s', (includeEmptyRooms, rowCount) => {
    const options = { ...DEFAULT_OPTIONS, includeEmptyRooms };
    const grid = buildDayGrid([session()], { ...meta, rooms: ['A01', 'A02'] }, 0, options);
    expect(grid.blocs[0].rows).toHaveLength(rowCount);
  });

  it.each([[true, 'B Rhouma Asma 1/15'], [false, 'B Rhouma Asma']])('frequency setting %s', (showFrequency, text) => {
    const grid = buildDayGrid([session({ frequency: '1/15' })], meta, 0, { ...DEFAULT_OPTIONS, showFrequency });
    expect(grid.blocs[0].rows.find((r) => r.room === 'A01')?.cells[0]).toBe(text);
  });

  it('joins teachers, removes duplicate teachers, and never renders sessions without rooms', () => {
    const grid = buildDayGrid([
      session({ teachers: 'BEN RHOUMA Asma,Prof Dupont' }), session({ teachers: 'BEN RHOUMA Asma' }),
      session({ room: '', teachers: 'Hidden Teacher' }),
    ], meta, 0, DEFAULT_OPTIONS);
    expect(grid.blocs[0].rows.find((r) => r.room === 'A01')?.cells[0]).toBe('B Rhouma Asma / Prof Dupont');
    expect(grid.sessionCount).toBe(2);
    expect(grid.blocs.flatMap((b) => b.rows).some((r) => r.cells.includes('Hidden Teacher'))).toBe(false);
  });

  it('shows the pause only when the lunch slot is empty for that day', () => {
    const lunchSlot = 3;
    const empty = buildDayGrid([], meta, 0, DEFAULT_OPTIONS);
    const busy = buildDayGrid([session({ slot: lunchSlot })], meta, 0, DEFAULT_OPTIONS);
    expect(empty.headers[lunchSlot]).toEqual(['Pause']);
    expect(busy.headers[lunchSlot]).toEqual(['12:00-13:30']);
  });

  it('uses Wednesday/Saturday and Friday header overrides', () => {
    const wed = buildDayGrid([], meta, 2, DEFAULT_OPTIONS);
    const fri = buildDayGrid([], meta, 4, DEFAULT_OPTIONS);
    const sat = buildDayGrid([], meta, 5, DEFAULT_OPTIONS);
    expect(wed.headers[1]).toEqual(['12:00-13:30']);
    expect(sat.headers[1]).toEqual(['12:00-13:30']);
    expect(fri.headers[2]).toEqual(['14:00-15:30']);
  });
});
