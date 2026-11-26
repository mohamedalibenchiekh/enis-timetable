import {
  AlignmentType, BorderStyle, Document, PageOrientation, Packer, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { displayRoom, FormCell, FormLayout } from './form-layout.js';

const border = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
const borders = { top: border, bottom: border, left: border, right: border };
const safeHex = (color: string, fallback: string) => {
  const raw = color.replace(/^#/u, '');
  if (/^[0-9a-f]{3}$/iu.test(raw)) return [...raw].map((digit) => `${digit}${digit}`).join('').toUpperCase();
  return /^[0-9a-f]{6}$/iu.test(raw) ? raw.toUpperCase() : fallback;
};
const isDs = (tags: string[]) => tags.some((tag) => tag === 'DS' || /devoir surveill[eé]/iu.test(tag));
const isTeacherItalic = (session: FormCell['session']) => session?.tags.includes('teacher-italic') ?? false;
const visibleTags = (tags: string[]) => tags.filter((tag) => tag !== 'DS' && tag !== 'teacher-italic' && !/devoir surveill[eé]/iu.test(tag));
const text = (value: string, options: { bold?: boolean; color?: string; italic?: boolean; size?: number } = {}) => new TextRun({ text: value, bold: options.bold, color: options.color, italics: options.italic, size: (options.size ?? 18) * 2 });

function sessionParagraphs(cell: FormCell, layout: FormLayout): Paragraph[] {
  const session = cell.session;
  if (!session) return [new Paragraph({ alignment: AlignmentType.CENTER, children: [text(cell.pause ? 'Pause' : cell.marker, { bold: cell.pause, color: cell.pause ? 'FFFFFF' : undefined, size: layout.fontSize })], shading: cell.pause ? { type: ShadingType.CLEAR, fill: '4472C4' } : undefined })];
  const paras: Paragraph[] = [];
  if (session.customTime) paras.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [text(session.customTime, { color: 'FF0000', size: layout.fontSize })] }));
  const title = [session.code, session.title].filter(Boolean).join(': ');
  if (isDs(session.tags)) paras.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [text('Devoir Surveillé', { bold: true, color: 'FF0000', size: layout.fontSize })] }));
  paras.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [text([title, session.frequency, ...visibleTags(session.tags), session.locationNote].filter(Boolean).join(' '), { size: layout.fontSize })] }));
  for (const teacher of session.teachers) paras.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [text(teacher, { bold: true, italic: isTeacherItalic(session), size: layout.fontSize })] }));
  const room = displayRoom(session);
  if (room) paras.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [text(room, { bold: true, color: safeHex(layout.roomColor, 'FF0000'), size: layout.fontSize })] }));
  return paras;
}

function cellOptions(layout: FormLayout, fill: string, width: number, span = 1, rowSpan = 1) {
  return {
    borders, width: { size: width, type: WidthType.DXA }, columnSpan: span > 1 ? span : undefined,
    rowSpan: rowSpan > 1 ? rowSpan : undefined, verticalAlign: 'center' as const,
    shading: fill ? { type: ShadingType.CLEAR, fill: safeHex(fill, 'FFFFFF') } : undefined,
    margins: { top: 35, bottom: 35, left: 35, right: 35 },
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [] })],
  };
}

export function buildFormDocument(layout: FormLayout): Document {
  const width = layout.tableWidthTwips;
  const widths = layout.columnWidthsTwips;
  const timeWidth = widths[0];
  const dayWidth = (day: number, span = 1) => widths.slice(day + 1, day + 1 + span).reduce((sum, item) => sum + item, 0);
  const dayWidthsTotal = widths.slice(1).reduce((sum, item) => sum + item, 0);
  const rows: TableRow[] = [];
  rows.push(new TableRow({ children: [new TableCell({ ...cellOptions(layout, '', width), columnSpan: 7, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [text('Ministère de l’Enseignement Supérieur et de la Recherche Scientifique     ENISo     ' + layout.headerTitle + '     ' + layout.program.formRef + (layout.formDate ? ` — ${layout.formDate}` : ''), { bold: true, size: 9 })] })] })] }));
  rows.push(new TableRow({ children: [new TableCell({ ...cellOptions(layout, '', width), columnSpan: 7, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [text(`Année Universitaire ${layout.program.academicYear}`, { bold: true })] })] })] }));
  rows.push(new TableRow({ children: [new TableCell({ ...cellOptions(layout, 'D9D9D9', width), columnSpan: 7, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [text(`Semestre ${layout.program.semester}`, { bold: true })] })] })] }));
  rows.push(new TableRow({ children: [
    new TableCell({ ...cellOptions(layout, 'DEEAF6', timeWidth), children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [text(layout.institution, { bold: true })] })] }),
    new TableCell({ ...cellOptions(layout, 'DEEAF6', dayWidthsTotal), columnSpan: 6, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [text(layout.program.academicYear, { bold: true })] })] }),
  ] }));
  rows.push(new TableRow({ children: [new TableCell({ ...cellOptions(layout, 'DEEAF6', width), columnSpan: 7, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [text(layout.program.title, { bold: true })] })] })] }));
  rows.push(new TableRow({ children: [
    new TableCell({ ...cellOptions(layout, 'D9D9D9', timeWidth), children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [text('Horaire', { bold: true })] })] }),
    ...layout.days.map((day, index) => new TableCell({ ...cellOptions(layout, 'D9D9D9', dayWidth(index)), children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [text(day, { bold: true, size: 9 })] })] })),
  ] }));
  for (let slot = 0; slot < 6; slot++) {
    const cells: TableCell[] = [new TableCell({ ...cellOptions(layout, 'D9D9D9', timeWidth), children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [text(layout.slots[slot]?.label ?? '', { bold: true, size: 8 })] })] })];
    for (let day = 0; day < 6; day++) {
      const cell = layout.cells[slot][day];
      if (cell.covered) continue;
      const fill = cell.fill || (cell.pause ? '4472C4' : 'FFFFFF');
      cells.push(new TableCell({
        ...cellOptions(layout, fill, dayWidth(day, cell.daySpan), cell.daySpan, cell.slotSpan),
        children: sessionParagraphs(cell, layout),
      }));
      day += cell.daySpan - 1;
    }
    rows.push(new TableRow({ children: cells, cantSplit: true }));
  }
  rows.push(new TableRow({ children: [new TableCell({ ...cellOptions(layout, '', width), columnSpan: 7, children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [text(layout.footer, { size: 8 })] })] })] }));
  rows.push(new TableRow({ children: [new TableCell({ ...cellOptions(layout, '', width), columnSpan: 7, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [text(`Coordinateur du mastère  ${layout.program.coordinator}`, { bold: true, size: 9 })] })] })] }));
  const table = new Table({ rows, width: { size: width, type: WidthType.DXA }, columnWidths: widths });
  return new Document({ sections: [{ properties: { page: { size: { width: 16838, height: 11906, orientation: PageOrientation.LANDSCAPE }, margin: { top: 420, bottom: 420, left: 500, right: 500 } } }, children: [table] }] });
}

export function renderFormHtml(layout: FormLayout): string {
  const esc = (value: string) => value.replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
  const sessionContent = (cell: FormCell) => {
    if (!cell.session) return `<span class="${cell.pause ? 'pause' : ''}">${cell.pause ? 'Pause' : esc(cell.marker)}</span>`;
    const session = cell.session;
    const title = [session.code, session.title].filter(Boolean).join(': ');
    return `${session.customTime ? `<div class="custom">${esc(session.customTime)}</div>` : ''}${isDs(session.tags) ? '<b class="ds">Devoir Surveillé</b>' : ''}<div>${esc([title, session.frequency, ...visibleTags(session.tags), session.locationNote].filter(Boolean).join(' '))}</div>${session.teachers.map((teacher) => `<b class="teacher${isTeacherItalic(session) ? ' italic' : ''}">${esc(teacher)}</b>`).join('<br>')}${displayRoom(session) ? `<b class="room">${esc(displayRoom(session))}</b>` : ''}`;
  };
  const widths = layout.columnWidthsTwips.map((width) => `${(100 * width / layout.tableWidthTwips).toFixed(4)}%`);
  const bodyRows = layout.cells.map((row, slot) => `<tr><th>${esc(layout.slots[slot]?.label ?? '')}</th>${row.map((cell) => cell.covered ? '' : `<td rowspan="${cell.slotSpan}" colspan="${cell.daySpan}" style="background:${cell.fill ? `#${safeHex(cell.fill, 'FFFFFF')}` : cell.pause ? '#4472C4' : 'white'}">${sessionContent(cell)}</td>`).join('')}</tr>`).join('');
  const warnings = layout.warnings.length ? `<aside class="warning">${layout.warnings.map(esc).join('<br>')}</aside>` : '';
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><title>${esc(layout.program.code)}</title><style>@page{size:A4 landscape;margin:8mm}*{box-sizing:border-box}body{font:10pt Arial,sans-serif;margin:0;color:#111}.head{display:flex;justify-content:space-between;align-items:center;font-weight:bold}.year{text-align:right;font-weight:bold;margin:5px 0}.semester{background:#d9d9d9;text-align:center;font-weight:bold;padding:3px}table{border-collapse:collapse;width:100%;table-layout:fixed}col{width:auto}td,th{border:1px solid #777;padding:2px;text-align:center;vertical-align:middle;white-space:pre-wrap;font-size:${layout.fontSize}pt}th{background:#d9d9d9}thead .institution{background:#deeaf6;font-weight:bold}.custom{color:#FF0000}.room{color:#${safeHex(layout.roomColor, 'FF0000')};display:block;font-weight:bold}.teacher.italic{font-style:italic}.ds{color:#FF0000;background:#fff2cc}.pause{background:#4472c4;color:white;display:block}.warning{border:1px solid #b45309;background:#fff7ed;color:#7c2d12;padding:4px;margin:4px 0}.foot{font-size:8pt;margin-top:4px}.coord{text-align:right;font-weight:bold;margin-top:4px}</style>${warnings}<div class="head"><span>Ministère de l’Enseignement Supérieur et de la Recherche Scientifique</span><span>${esc(layout.headerTitle)}</span><span>${esc(layout.program.formRef)} ${esc(layout.formDate)}</span></div><div class="year">Année Universitaire ${esc(layout.program.academicYear)}</div><div class="semester">Semestre ${esc(layout.program.semester)}</div><table><colgroup>${widths.map((width) => `<col style="width:${width}">`).join('')}</colgroup><thead><tr><th class="institution" colspan="7">${esc(layout.institution)} — ${esc(layout.program.academicYear)}</th></tr><tr><th colspan="7">${esc(layout.program.title)}</th></tr><tr><th>Horaire</th>${layout.days.map((day) => `<th>${esc(day)}</th>`).join('')}</tr></thead><tbody>${bodyRows}</tbody></table><div class="foot">${esc(layout.footer)}</div><div class="coord">Coordinateur du mastère ${esc(layout.program.coordinator)}</div></html>`;
}

export async function packFormDocument(layout: FormLayout): Promise<Buffer> {
  return Packer.toBuffer(buildFormDocument(layout));
}
