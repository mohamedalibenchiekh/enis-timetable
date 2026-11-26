import { describe, expect, it } from 'vitest';
import { buildFormLayout, displayRoom } from '../src/masters/form-layout.js';
import { renderFormHtml } from '../src/masters/form-renderers.js';
import { packFormDocument } from '../src/masters/form-renderers.js';
import { parseMastersDocx } from '../src/masters/docx-importer.js';
import JSZip from 'jszip';
import type { ProgramAnalysis } from '../src/masters/types.js';
import { parseProgramCell } from '../src/masters/cell-parser.js';

const base: ProgramAnalysis = {
  code: 'FAKE-M1', title: 'Programme fictif 2025-2026', kind: 'Mastère Recherche', academicYear: '2026-2027',
  semester: '1', coordinator: 'Professeur Exemple', formRef: 'PED-FR-02-01', effectiveFrom: '', footerText: '', version: '1',
  source: 'docx', warnings: [], confidence: 1, rawSnapshot: {}, slots: Array.from({ length: 6 }, (_, index) => ({ index, label: index === 3 ? '14:00-15:30' : '08:30-10:00', rawLabel: '', base: '', dayOverrides: {}, note: '' })),
  sessions: [{ day: 0, slot: 0, slotSpan: 2, daySpan: 2, title: 'Sujet fictif', code: 'TU1.31', teachers: ['Enseignant Exemple'], teacherKeys: [], room: 'PAQ', roomUnassigned: false, locationNote: '', frequency: '(1/15)', tags: [], customTime: null, color: 'DEEAF6', note: '', rawText: '', confidence: 1, reasons: [], source: 'manual' }],
};

describe('master form layout', () => {
  it('uses the program year, normalised slot labels, and merged span geometry', () => {
    const layout = buildFormLayout(base);
    expect(layout.program.academicYear).toBe('2026-2027');
    expect(layout.slots[3].label).toBe('14:00-15:30');
    expect(layout.cells[0][0]).toMatchObject({ daySpan: 2, slotSpan: 2, fill: 'DEEAF6' });
    expect(layout.cells[0][1].covered).toBe(true);
    expect(layout.cells[1][0].covered).toBe(true);
  });

  it('renders the placeholder, room alias display, pause, and title year consistently', () => {
    const layout = buildFormLayout({ ...base, sessions: [{ ...base.sessions[0], room: null, roomUnassigned: true }] });
    const html = renderFormHtml(layout);
    expect(displayRoom({ ...base.sessions[0], room: 'DGSE' })).toBe('Salle PAQ/DGSE');
    expect(html).toContain('Salle XX');
    expect(html).toContain('Année Universitaire 2026-2027');
    expect(layout.program.title).toContain('2026-2027');
    expect(layout.program.title).not.toContain('2025-2026');
    expect(html).toContain('Pause');
  });

  it('keeps a course named Pause as content when no pause-cell context is present', () => {
    expect(parseProgramCell('Pause').title).toBe('Pause');
  });

  it('round-trips a generated DOCX into the same session span and canonical room', async () => {
    const layout = buildFormLayout(base);
    const buffer = await packFormDocument(layout);
    const parsed = await parseMastersDocx(buffer, 'fake-m1.docx');
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0]).toMatchObject({ day: 0, slot: 0, daySpan: 2, slotSpan: 2, title: 'Sujet fictif', code: 'TU1.31', room: 'PAQ/DGSE', frequency: '(1/15)' });
    expect(parsed.academicYear).toBe('2026-2027');
  });

  it('round-trips a standalone location note without folding it into the title', async () => {
    const layout = buildFormLayout({ ...base, sessions: [{ ...base.sessions[0], locationNote: 'Novation City' }] });
    const buffer = await packFormDocument(layout);
    const parsed = await parseMastersDocx(buffer, 'fake-m1.docx');
    expect(parsed.sessions[0]).toMatchObject({ title: 'Sujet fictif', locationNote: 'Novation City' });
  });

  it('uses the default institution when a saved setting is blank', () => {
    expect(buildFormLayout(base, { institution: '' }).institution).toBe('École Nationale d’Ingénieurs de Sousse');
  });

  it('writes a landscape one-table DOCX with horizontal and vertical merges', async () => {
    const buffer = await packFormDocument(buildFormLayout({ ...base, sessions: [{ ...base.sessions[0], tags: ['DS'] }] }));
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('w:orient="landscape"');
    expect((xml.match(/<w:tbl>/gu) ?? []).length).toBe(1);
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
    expect(xml).toContain('<w:vMerge w:val="restart"/>');
    expect(xml).toContain('FFF2CC');
    const dsRun = xml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<w:t(?:\s[^>]*)?>Devoir Surveillé<\/w:t>[\s\S]*?<\/w:r>/u)?.[0];
    expect(dsRun).toContain('w:color');
    expect(dsRun).toContain('FF0000');
  });

  it('expands short colors and applies formatting control tags without printing them', async () => {
    const layout = buildFormLayout({ ...base, sessions: [{ ...base.sessions[0], color: 'ABC', tags: ['teacher-italic'], customTime: '10:30-12:30' }] }, { roomColor: '#009900' });
    const html = renderFormHtml(layout);
    expect(html).toContain('background:#AABBCC');
    expect(html).toContain('.custom{color:#FF0000}');
    expect(html).toContain('class="teacher italic"');
    expect(html).not.toContain('teacher-italic</div>');
    const buffer = await packFormDocument(layout);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('AABBCC');
    expect(xml).toContain('w:color w:val="009900"');
  });

  it('uses rendered tokens when scaling the session font', () => {
    const short = buildFormLayout(base).fontSize;
    const long = buildFormLayout({ ...base, sessions: [{ ...base.sessions[0], code: 'TU'.repeat(40), customTime: '10:30-12:30', frequency: '(1/15)', tags: ['période 2'], locationNote: '(Novation City)', room: 'R21' }] }).fontSize;
    expect(long).toBeLessThan(short);
  });
});
