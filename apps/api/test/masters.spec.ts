import { describe, expect, it } from 'vitest';
import { expandToSlots, parseProgramCell } from '../src/masters/cell-parser.js';
import { DEFAULT_PROGRAM_REFERENCE, DEFAULT_PROGRAM_SLOTS, normalizeProgramSlots, parseSlotLabel } from '../src/masters/slots.js';
import { parseMastersDocx } from '../src/masters/docx-importer.js';
import JSZip from 'jszip';
import { detectProgramConflicts } from '../src/masters/conflicts.js';

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
    expect(typo.teachers).toEqual(['Nora Tset']);
    expect(typo.teacherCandidates[0]?.name).toBe('Nora Test');
    expect(typo.confidence).toBeLessThan(1);

    const ambiguous = parseProgramCell('Cours\nNora Tset', [], { teachers: ['Nora Test', 'Nora Tess'] });
    expect(ambiguous.teachers).toEqual(['Nora Tset']);
    expect(ambiguous.teacherCandidates).toHaveLength(2);
  });

  it('keeps spans as one session and projects occupied slots', () => {
    expect(expandToSlots({ day: 2, slot: 1, daySpan: 2, slotSpan: 2 })).toEqual([
      { day: 2, slot: 1 }, { day: 2, slot: 2 }, { day: 3, slot: 1 }, { day: 3, slot: 2 },
    ]);
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

  it('reads a synthetic DOCX schedule table without persisting source content', async () => {
    const cell = (text: string) => `<w:tc><w:tcPr/><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const rows = [
      ['','Lundi','Mardi','Mercredi (M)','Jeudi','Vendredi (V)','Samedi'],
      ...DEFAULT_PROGRAM_SLOTS.map((slot, index) => [slot, index === 0 ? 'Architecture & systèmes' : '', '', '', '', '', '']),
    ].map((row) => `<w:tr>${row.map(cell).join('')}</w:tr>`).join('');
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>${rows}</w:tbl></w:body></w:document>`;
    const zip = new JSZip(); zip.file('word/document.xml', xml);
    const parsed = await parseMastersDocx(await zip.generateAsync({ type: 'nodebuffer' }), 'FAKE-M1.docx');
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0]).toMatchObject({ day: 0, slot: 0, title: 'Architecture & systèmes', source: 'docx' });
    expect(parsed.academicYear).toBe('2026-2027');
  });
});
