import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { expandToSlots, parseProgramCell } from '../src/masters/cell-parser.js';
import { DEFAULT_PROGRAM_REFERENCE, DEFAULT_PROGRAM_SLOTS, normalizeProgramSlots, parseSlotLabel } from '../src/masters/slots.js';
import { parseMastersDocx } from '../src/masters/docx-importer.js';
import JSZip from 'jszip';
import { detectProgramConflicts } from '../src/masters/conflicts.js';
import { findPdfSlotRowY, parseMastersPdf, pdfRowBounds } from '../src/masters/pdf-importer.js';

describe('master timetable parsing', () => {
  it('normalizes day-scoped time labels and preserves Friday corrections', () => {
    expect(parseSlotLabel('(V: 13:45-15:15)')).toEqual({ base: '13:45-15:15', overrides: { 4: '13:45-15:15' } });
    const corrected = normalizeProgramSlots(['08:30-10:00', '10:15-11:45', '12:00-13:00', '(V: 13:45-15:15)', '14:45-16:15', '16 :30-18 :00(Rat)']);
    expect(corrected.slots[3].label).toBe('13:00-14:30');
    expect(corrected.warnings).toContain('Libellé du vendredi corrigé : 13:45-15:15 → 14:00-15:30');
    expect(corrected.slots[5].rawLabel).toBe('16 :30-18 :00(Rat)');
    expect(DEFAULT_PROGRAM_SLOTS[3]).toBe('13:00-14:30');
    expect(DEFAULT_PROGRAM_REFERENCE.dayOverrides[3][4]).toBe('14:00-15:30');
    expect(parseSlotLabel('(V&Merc: 14.00-15:30)')).toEqual({ base: '14:00-15:30', overrides: { 2: '14:00-15:30', 4: '14:00-15:30' } });
    expect(parseSlotLabel('(M/V: 14:00-15:30)').overrides).toEqual({ 1: '14:00-15:30', 4: '14:00-15:30' });
    expect(parseSlotLabel('(M/V: 15:45-17:15)').overrides).toEqual({ 1: '15:45-17:15', 4: '15:45-17:15' });
    expect(parseSlotLabel('16 :30-18 :00(Rat)').base).toBe('16:30-18:00');
    const unconfirmed = normalizeProgramSlots(['08:30-10:00', '10:15-11:45', '12:00-13:00', '13:00-14:30', '(V: 15:30-17:00)', '(V: 17:30-19:00)']);
    expect(unconfirmed.warnings).toContain('Libellé du vendredi à confirmer : 15:30-17:00');
    expect(unconfirmed.warnings).toContain('Libellé du vendredi à confirmer : 17:30-19:00');
    const reference = [...DEFAULT_PROGRAM_SLOTS];
    const customReference = normalizeProgramSlots(reference, reference, { 3: { 4: '14:00-15:30' } });
    expect(customReference.slots[3].dayOverrides).toEqual({ 4: '14:00-15:30' });
    const correctedGrid = normalizeProgramSlots(['08:30-10:00', '10:15-11:45', '12:15-13:15']);
    expect(correctedGrid.slots[2].base).toBe(DEFAULT_PROGRAM_SLOTS[2]);
    expect(correctedGrid.warnings).toContain('Libellé du créneau 3 corrigé : 12:15-13:15 → 12:00-13:00');
  });

  it('classifies markers, placeholder rooms, aliases, and reversed teacher names', () => {
    expect(parseProgramCell('-X-').empty).toBe(true);
    for (const value of ['Salle XX', 'XX', 'Salle ??', 'Salle xx', 'Salle à rechercher']) {
      const parsed = parseProgramCell(`Architecture // ${value}`);
      expect(parsed.room).toBeNull(); expect(parsed.roomUnassigned).toBe(true); expect(parsed.reasons).not.toContain('Salle hors FET');
    }
    expect(parseProgramCell('Cours\nSalle PAQ').room).toBe('PAQ/DGSE');
    expect(parseProgramCell('Cours\nSalle DGSE').room).toBe('PAQ/DGSE');
    const teacher = parseProgramCell('Architecture\nAMMAR Noeman', [], { teachers: ['Noeman Ammar'] });
    expect(teacher.teachers).toEqual(['Noeman Ammar']);
    expect(teacher.teacherCandidates).toEqual([]);
    const punctuationName = parseProgramCell('Embedded subject Jean-Pierre O’Neil', [], { teachers: ['Jean-Pierre O’Neil'] });
    expect(punctuationName).toMatchObject({ title: 'Embedded subject', teachers: ['Jean-Pierre O’Neil'] });
    const courseLikeWord = parseProgramCell('Tutorat: Architecture');
    expect(courseLikeWord).toMatchObject({ code: '', title: 'Tutorat: Architecture' });
  });

  it('classifies structured tokens, wrapped subjects, multiple teachers and uncertain matches', () => {
    const parsed = parseProgramCell('TU3.22 :\nWrapped subject\n(1/15)\n(période 2)\n10H30 - 12H30\nDevoir Surveillé\nNORA TEST\nMona Fake\nSalle EH5\n(Novation City)', [{}, {}, {}, {}, {}, {}, { bold: true }, { bold: true }], { teachers: ['Nora Test', 'Mona Fake'], rooms: ['R21'] });
    expect(parsed).toMatchObject({ code: 'TU3.22', title: 'Wrapped subject', teachers: ['Nora Test', 'Mona Fake'], room: 'EH5', frequency: '(1/15)', customTime: '10H30-12H30', locationNote: 'Novation City' });
    expect(parsed.tags).toContain('DS');
    expect(parsed.tags).toContain('(période2)');
    expect(parsed.reasons).toContain('Salle hors FET');
    const glued = parseProgramCell('Embedded architecture Nora Test', [], { teachers: ['Nora Test'] });
    expect(glued.title).toBe('Embedded architecture');
    expect(glued.teachers).toEqual(['Nora Test']);

    const typo = parseProgramCell('Cours\nNora Tset', [], { teachers: ['Nora Test'] });
    expect(typo.teachers).toEqual([]);
    expect(typo.title).toContain('Nora Tset');
    expect(typo.teacherCandidates[0]?.name).toBe('Nora Test');
    expect(typo.confidence).toBeLessThan(1);

    const ambiguous = parseProgramCell('Cours\nNora Tset', [], { teachers: ['Nora Test', 'Nora Tess'] });
    expect(ambiguous.teachers).toEqual([]);
    expect(ambiguous.title).toContain('Nora Tset');
    expect(ambiguous.teacherCandidates).toHaveLength(2);
  });

  it('projects the occupied slots of a multi-slot session', () => {
    expect(expandToSlots({ day: 2, slot: 1, daySpan: 2, slotSpan: 2 })).toEqual([
      { day: 2, slot: 1 }, { day: 2, slot: 2 }, { day: 3, slot: 1 }, { day: 3, slot: 2 },
    ]);
  });

  it('matches PDF row positions to the selected reference and bounds missing neighbors safely', () => {
    expect(findPdfSlotRowY('09:00-10:30', [
      { text: '08:30-10:00', y: 600 },
      { text: '09:00-10:30', y: 540 },
    ])).toBe(540);
    expect(pdfRowBounds([600, Number.NaN, 500], 2, 500)).toEqual({ upper: 522, lower: 474 });
    expect(pdfRowBounds([600, Number.NaN, 500], 0, 600)).toEqual({ upper: 622, lower: 574 });
  });

  it('reports a multi-page master PDF instead of failing during PDF.js cleanup', async () => {
    const pdf = await readFile(new URL('./fixtures/FET_rooms_test.pdf', import.meta.url));
    await expect(parseMastersPdf(pdf, 'FET_rooms_test.pdf')).rejects.toThrow('Un PDF de mastère doit contenir une seule page');
  });

  it('detects room and teacher collisions by day and slot and skips unassigned rooms', () => {
    const session = { ...parseProgramCell('Course'), day: 2, slot: 1, slotSpan: 2, daySpan: 1, source: 'manual' as const, teachers: ['Alex Test'], room: 'PAQ/DGSE', roomUnassigned: false };
    const collisions = detectProgramConflicts([session], [
      { day: 2, slot: 1, room: 'DGSE', teachers: ['TEST Alex'] },
      { day: 2, slot: 2, room: 'PAQ', teachers: [] },
    ], { 'salle dgse': 'PAQ/DGSE', dgse: 'PAQ/DGSE', paq: 'PAQ/DGSE' });
    expect(collisions.map((item) => item.type)).toEqual(['room', 'teacher', 'room']);
    const unassigned = detectProgramConflicts([{ ...session, room: null, roomUnassigned: true }], [{ day: 2, slot: 1, room: 'DGSE', teachers: [] }]);
    expect(unassigned.some((item) => item.type === 'room')).toBe(false);
  });

  it('detects bold non-catalog teachers after removing a room line', () => {
    const parsed = parseProgramCell('Course\nSalle R1\nUnlisted Teacher', [{}, {}, { bold: true }]);
    expect(parsed.teachers).toEqual(['Unlisted Teacher']);
    expect(parsed.title).toBe('Course');
  });

  it('parses a synthetic DOCX schedule table', async () => {
    const cell = (text: string) => `<w:tc><w:tcPr/><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const rows = [
      ['','Lundi','Mardi','Mercredi (M)','Jeudi','Vendredi (V)','Samedi'],
      ...DEFAULT_PROGRAM_SLOTS.map((slot, index) => [slot, index === 0 ? 'Architecture &amp; systèmes' : '', '', '', '', '', '']),
    ].map((row) => `<w:tr>${row.map(cell).join('')}</w:tr>`).join('');
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>${rows}</w:tbl></w:body></w:document>`;
    const zip = new JSZip(); zip.file('word/document.xml', xml);
    const parsed = await parseMastersDocx(await zip.generateAsync({ type: 'nodebuffer' }), 'FAKE-M1.docx');
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0]).toMatchObject({ day: 0, slot: 0, title: 'Architecture & systèmes', source: 'docx' });
    expect(parsed.academicYear).toBe('2026-2027');
  });

  it('preserves vertical and horizontal spans, cell fill, and ignores columns after Saturday', async () => {
    const cell = (text: string, properties = '') => `<w:tc><w:tcPr>${properties}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const header = [
      cell(''), cell('Lundi', '<w:gridSpan w:val="2"/>'), cell('Mardi'), cell('Mercredi'),
      cell('Jeudi'), cell('Vendredi'), cell('Samedi'), cell(''),
    ].join('');
    const first = [
      cell(DEFAULT_PROGRAM_SLOTS[0]), cell('Architecture', '<w:vMerge w:val="restart"/><w:shd w:fill="FFEEDD"/>'),
      cell('Calcul'), cell(''), cell(''), cell(''), cell(''), cell(''), cell('Trailing column'),
    ].join('');
    const second = [
      cell(DEFAULT_PROGRAM_SLOTS[1]), cell('', '<w:vMerge/>'), cell(''), cell(''), cell(''), cell(''), cell(''), cell(''), cell('Should be ignored'),
    ].join('');
    const remaining = DEFAULT_PROGRAM_SLOTS.slice(2).map((slot) => `<w:tr>${cell(slot)}${Array.from({ length: 8 }, () => cell('')).join('')}</w:tr>`).join('');
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>2030-2031</w:t></w:r></w:p><w:tbl><w:tr>${header}</w:tr><w:tr>${first}</w:tr><w:tr>${second}</w:tr>${remaining}</w:tbl></w:body></w:document>`;
    const zip = new JSZip(); zip.file('word/document.xml', xml);
    const parsed = await parseMastersDocx(await zip.generateAsync({ type: 'nodebuffer' }), 'FAKE-M1.docx');
    expect(parsed.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ day: 0, slot: 0, slotSpan: 2, title: 'Architecture', color: 'FFEEDD' }),
      expect.objectContaining({ day: 0, slot: 0, title: 'Calcul' }),
    ]));
    expect(parsed.sessions.some((session) => session.title.includes('Trailing') || session.title.includes('Should be ignored'))).toBe(false);
    expect(parsed.warnings).toContain('année incohérente dans le titre du tableau, 2026-2027 retenue');
  });
});
