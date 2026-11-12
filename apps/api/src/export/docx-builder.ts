import {
  AlignmentType, BorderStyle, Document, HeightRule, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell,
  TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType,
} from 'docx';
import { CellSession, DayGrid, RoomRow } from './grid-builder.js';
import { DEFAULT_OPTIONS, ExportOptions } from './options.js';

// Layout copied from the reference file "Jeudi.docx".
const FONT = 'Times New Roman';
const COLORS = { dayHeader: 'C2D69B', slotHeader: 'B8CCE4', bloc: 'FFFF99', room: 'C2D69B', dayText: 'FF0000' };
const COL_WIDTHS = [1497, 1497, 1497, 1497, 1497, 1497, 1677]; // twips — first column + 6 slots
const BORDER = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const PAGE = { width: 11906, height: 16838 }; // A4 portrait, twips
const MARGIN = { top: 851, bottom: 851, left: 600, right: 600 };
const SESSION_SEPARATOR = { style: BorderStyle.SINGLE, size: 4, color: '999999', space: 1 };

function widths(nSlots: number): number[] {
  const w = COL_WIDTHS.slice(0, nSlots + 1);
  while (w.length < nSlots + 1) w.push(1497);
  return w;
}

/** Column widths scaled to the usable page width (column proportions kept). */
function colWidths(nSlots: number, options: ExportOptions): number[] {
  const base = widths(nSlots);
  if (options.orientation !== 'landscape') return base;
  const usable = PAGE.height - MARGIN.left - MARGIN.right; // landscape page width = portrait height
  const total = base.reduce((a, b) => a + b, 0);
  const scale = usable / total;
  const scaled = base.map((w) => Math.round(w * scale));
  const diff = usable - scaled.reduce((a, b) => a + b, 0);
  scaled[scaled.length - 1] += diff;
  return scaled;
}

function cell(
  lines: string[], width: number,
  o: { bold?: boolean; size?: number; color?: string; fill?: string; span?: number } = {},
): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: o.span,
    verticalAlign: VerticalAlign.CENTER,
    borders: BORDERS,
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    children: (lines.length ? lines : ['']).map(
      (t) =>
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: t, font: FONT, bold: o.bold, size: o.size ?? 20, color: o.color })],
        }),
    ),
  });
}

/** Rich cell: one paragraph per template line, sessions separated by a thin line. */
function richCell(entries: CellSession[], width: number, options: ExportOptions): TableCell {
  const baseSize = options.cellFontSize * 2; // points → half-points
  const secondarySize = options.detailSmaller ? Math.max(14, baseSize - 2) : baseSize;
  const paragraphs: Paragraph[] = [];
  entries.forEach((entry, entryIndex) => {
    entry.lines.forEach((line, lineIndex) => {
      const secondary = lineIndex > 0;
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: entryIndex < entries.length - 1 && lineIndex === entry.lines.length - 1
            ? { bottom: SESSION_SEPARATOR }
            : undefined,
          children: [
            new TextRun({
              text: line,
              font: FONT,
              size: secondary ? secondarySize : baseSize,
              italics: secondary ? options.detailItalic : undefined,
            }),
          ],
        }),
      );
    });
  });
  if (!paragraphs.length) {
    paragraphs.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '', font: FONT, size: baseSize })] }));
  }
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    borders: BORDERS,
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children: paragraphs,
  });
}

function sessionCell(row: RoomRow, slot: number, width: number, options: ExportOptions): TableCell {
  if (row.details) return richCell(row.details[slot] ?? [], width, options);
  const text = row.cells[slot] ?? '';
  return cell(text ? [text] : [], width, { size: options.cellFontSize * 2 });
}

function tableRows(grid: DayGrid, blocIndices: number[], showHeader: boolean, options: ExportOptions): TableRow[] {
  const nSlots = grid.headers.length;
  const w = colWidths(nSlots, options);
  const total = w.reduce((a, b) => a + b, 0);
  // tableHeader must be omitted (not false) when disabled: the docx library emits
  // a w:tblHeader element whenever the property is defined.
  const row = (cells: TableCell[], height = 288, header = false) =>
    new TableRow({ children: cells, tableHeader: header || undefined, cantSplit: true, height: { value: height, rule: HeightRule.ATLEAST } });

  const rows: TableRow[] = [];
  if (showHeader) {
    rows.push(
      row(
        [
          cell([grid.dayName], w[0], { bold: true, size: 32, color: COLORS.dayText, fill: COLORS.dayHeader }),
          ...grid.headers.map((h, i) => cell(h, w[i + 1], { bold: true, size: 22, fill: COLORS.slotHeader })),
        ],
        400,
        options.repeatDayHeader,
      ),
    );
  }
  for (const bi of blocIndices) {
    const bloc = grid.blocs[bi];
    if (!bloc) continue;
    rows.push(row([cell([bloc.title], total, { size: 22, fill: COLORS.bloc, span: nSlots + 1 })]));
    for (const r of bloc.rows) {
      rows.push(
        row(
          [
            cell([r.label], w[0], { bold: true, size: 22, fill: COLORS.room }),
            ...Array.from({ length: nSlots }, (_, i) => sessionCell(r, i, w[i + 1], options)),
          ],
          357,
        ),
      );
    }
  }
  return rows;
}

function pageTitle(grid: DayGrid, blocIndices: number[]): Paragraph {
  const title = blocIndices.map((i) => grid.blocs[i]?.title).filter(Boolean).join(' · ');
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: title, font: FONT, bold: true, size: 24 })],
  });
}

function hasRichCells(grid: DayGrid): boolean {
  return grid.blocs.some((b) => b.rows.some((r) => r.details));
}

/** True when the historical single-section layout applies (byte-identical output). */
function isLegacyLayout(grid: DayGrid, options: ExportOptions): boolean {
  return !grid.pages && options.orientation === 'portrait' && options.repeatDayHeader && !options.showPageTitle && !hasRichCells(grid);
}

/** Historical layout: one portrait section, plain-text cells. Kept verbatim for backward compatibility. */
function legacyDocument(grid: DayGrid, options: ExportOptions): Document {
  const nSlots = grid.headers.length;
  const w = widths(nSlots);
  const total = w.reduce((a, b) => a + b, 0);
  const row = (cells: TableCell[], height = 288, header = false) =>
    new TableRow({ children: cells, tableHeader: header, cantSplit: true, height: { value: height, rule: HeightRule.ATLEAST } });

  const rows: TableRow[] = [
    row(
      [
        cell([grid.dayName], w[0], { bold: true, size: 32, color: COLORS.dayText, fill: COLORS.dayHeader }),
        ...grid.headers.map((h, i) => cell(h, w[i + 1], { bold: true, size: 22, fill: COLORS.slotHeader })),
      ],
      400,
      true,
    ),
  ];
  for (const bloc of grid.blocs) {
    rows.push(row([cell([bloc.title], total, { size: 22, fill: COLORS.bloc, span: nSlots + 1 })]));
    for (const r of bloc.rows) {
      rows.push(
        row(
          [
            cell([r.label], w[0], { bold: true, size: 22, fill: COLORS.room }),
            ...r.cells.map((c, i) => cell(c ? [c] : [], w[i + 1], { size: options.cellFontSize * 2 })),
          ],
          357,
        ),
      );
    }
  }

  return new Document({
    creator: 'ENISo Timetable',
    title: `Emploi du temps – ${grid.dayName}`,
    styles: { default: { document: { run: { font: FONT, size: options.cellFontSize * 2 } } } },
    sections: [
      {
        properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: MARGIN } },
        children: [
          new Table({
            width: { size: total, type: WidthType.DXA },
            columnWidths: w,
            layout: TableLayoutType.FIXED,
            alignment: AlignmentType.CENTER,
            rows,
          }),
        ],
      },
    ],
  });
}

/** Rich layout: one OOXML section per page group, optional orientation/titles/rich cells. */
function richDocument(grid: DayGrid, options: ExportOptions): Document {
  const nSlots = grid.headers.length;
  const w = colWidths(nSlots, options);
  const total = w.reduce((a, b) => a + b, 0);
  const pageGroups = grid.pages ?? [{ page: 1, blocs: grid.blocs.map((_, i) => i) }];
  const orientation = options.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT;

  const sections = pageGroups.map((pg, pgIndex) => {
    const children: (Paragraph | Table)[] = [];
    if (options.showPageTitle) children.push(pageTitle(grid, pg.blocs));
    const showHeader = pgIndex === 0 || options.repeatDayHeader;
    children.push(
      new Table({
        width: { size: total, type: WidthType.DXA },
        columnWidths: w,
        layout: TableLayoutType.FIXED,
        alignment: AlignmentType.CENTER,
        rows: tableRows(grid, pg.blocs, showHeader, options),
      }),
    );
    return {
      properties: {
        page: {
          size: { width: PAGE.width, height: PAGE.height, orientation },
          margin: MARGIN,
          // Keep the configured page numbers (they may be non-contiguous).
          pageNumbers: pg.page > 1 ? { start: pg.page } : undefined,
        },
      },
      children,
    };
  });

  return new Document({
    creator: 'ENISo Timetable',
    title: `Emploi du temps – ${grid.dayName}`,
    styles: { default: { document: { run: { font: FONT, size: options.cellFontSize * 2 } } } },
    sections,
  });
}

export function buildDayDocument(grid: DayGrid, options: ExportOptions = DEFAULT_OPTIONS): Document {
  return isLegacyLayout(grid, options) ? legacyDocument(grid, options) : richDocument(grid, options);
}

export async function buildDayDocx(grid: DayGrid, options: ExportOptions = DEFAULT_OPTIONS): Promise<Buffer> {
  return Packer.toBuffer(buildDayDocument(grid, options));
}
