import {
  AlignmentType, BorderStyle, Document, HeightRule, Packer, Paragraph, ShadingType, Table, TableCell,
  TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType,
} from 'docx';
import { DayGrid } from './grid-builder.js';

// Layout copied from the reference file "Jeudi.docx".
const FONT = 'Times New Roman';
const COLORS = { dayHeader: 'C2D69B', slotHeader: 'B8CCE4', bloc: 'FFFF99', room: 'C2D69B', dayText: 'FF0000' };
const COL_WIDTHS = [1497, 1497, 1497, 1497, 1497, 1497, 1677]; // twips — first column + 6 slots
const BORDER = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function widths(nSlots: number): number[] {
  const w = COL_WIDTHS.slice(0, nSlots + 1);
  while (w.length < nSlots + 1) w.push(1497);
  return w;
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

export function buildDayDocument(grid: DayGrid): Document {
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
            ...r.cells.map((c, i) => cell(c ? [c] : [], w[i + 1])),
          ],
          357,
        ),
      );
    }
  }

  return new Document({
    creator: 'ENISo Timetable',
    title: `Emploi du temps – ${grid.dayName}`,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 851, bottom: 851, left: 600, right: 600 },
          },
        },
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

export async function buildDayDocx(grid: DayGrid): Promise<Buffer> {
  return Packer.toBuffer(buildDayDocument(grid));
}
