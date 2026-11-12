import {
  AlignmentType, BorderStyle, Document, HeightRule, Packer, Paragraph, ShadingType, Table, TableCell,
  TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType,
} from 'docx';
import type { Change, ChangeType, CompareResult } from '../compare/types.js';

// Same fonts and colours as the daily timetable documents.
const FONT = 'Times New Roman';
const COLORS = { header: 'C2D69B', slotHeader: 'B8CCE4', bloc: 'FFFF99', dayText: 'FF0000' };
const BORDER = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

const TYPE_LABELS: Record<ChangeType, string> = {
  added: 'Ajoutée',
  removed: 'Supprimée',
  moved: 'Déplacée',
  room_changed: 'Salle changée',
  group_changed: 'Groupe changé',
  teachers_changed: 'Enseignant changé',
};

const SOURCE_LABELS: Record<string, string> = { teachers: 'Enseignants', rooms: 'Salles', groups: 'Groupes' };

function cell(lines: string[], width: number, o: { bold?: boolean; size?: number; color?: string; fill?: string; span?: number } = {}): TableCell {
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
          alignment: AlignmentType.LEFT,
          children: [new TextRun({ text: t, font: FONT, bold: o.bold, size: o.size ?? 20, color: o.color })],
        }),
    ),
  });
}

function para(text: string, o: { bold?: boolean; size?: number; color?: string } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, bold: o.bold, size: o.size ?? 22, color: o.color })],
    spacing: { after: 120 },
  });
}

function locationText(c: Change, side: 'before' | 'after'): string {
  const s = c[side];
  if (!s) return '—';
  return `${s.dayName} · ${s.timeRange} · ${s.room}`;
}

function activityText(c: Change): string {
  const a = c.activity;
  const subject = [a.subjectCode, a.subject].filter(Boolean).join(' ');
  return [a.teachers, a.groups, subject, a.frequency].filter(Boolean).join(' — ');
}

export function buildCompareDocument(result: CompareResult, baseName: string, targetName: string): Document {
  const s = result.summary;
  const totalWidth = 9360;
  const colW = [1100, 1300, 2400, 2400, 2160]; // Type, Journée, Avant, Après, Activité

  const rows: TableRow[] = [];
  const row = (cells: TableCell[], height = 300, header = false) =>
    new TableRow({ children: cells, tableHeader: header, cantSplit: true, height: { value: height, rule: HeightRule.ATLEAST } });

  // Summary table
  rows.push(
    row(
      [
        cell(['Indicateur'], colW[0], { bold: true, fill: COLORS.slotHeader }),
        cell(['Valeur'], colW[1] + colW[2] + colW[3] + colW[4], { bold: true, fill: COLORS.slotHeader, span: 4 }),
      ],
      300,
      true,
    ),
  );
  const summaryLines: [string, string][] = [
    ['Version de base', baseName],
    ['Nouvelle version', targetName],
    ['Vue comparée', SOURCE_LABELS[result.source] ?? result.source],
    ['Séances inchangées', String(s.unchanged)],
    ['Blocs comparés', `${s.baseBlocks} → ${s.targetBlocks}`],
    ['Similarité', `${Math.round(s.similarity * 100)} %`],
    ['Enseignants concernés', String(s.teachers)],
    ['Salles concernées', String(s.rooms)],
  ];
  for (const [label, value] of summaryLines) {
    rows.push(row([cell([label], colW[0], { bold: true }), cell([value], colW[1] + colW[2] + colW[3] + colW[4], { span: 4 })]));
  }
  const typeLine = (Object.keys(s.byType) as ChangeType[])
    .filter((t) => s.byType[t] > 0)
    .map((t) => `${TYPE_LABELS[t]} : ${s.byType[t]}`)
    .join(' · ');
  if (typeLine) rows.push(row([cell(['Changements'], colW[0], { bold: true }), cell([typeLine], colW[1] + colW[2] + colW[3] + colW[4], { span: 4 })]));

  const children: (Paragraph | Table)[] = [
    para('Fiche des changements', { bold: true, size: 32 }),
    para(`De « ${baseName} » vers « ${targetName} »`, { size: 22, color: '444444' }),
    ...(s.warning ? [para(`⚠ ${s.warning}`, { bold: true, color: 'B42318' })] : []),
    new Table({
      width: { size: totalWidth, type: WidthType.DXA },
      columnWidths: colW,
      layout: TableLayoutType.FIXED,
      rows,
    }),
    para('Jours à rééditer', { bold: true, size: 26 }),
  ];

  if (!result.days.length) {
    children.push(para('Aucun changement : les documents Word existants restent valables.'));
  } else {
    children.push(para(result.days.map((d) => d.dayName).join(', '), { bold: true }));
    for (const day of result.days) {
      children.push(para(`${day.dayName} — cellules modifiées :`, { bold: true, size: 22 }));
      const dRows: TableRow[] = [
        row(
          [
            cell(['Salle'], 2200, { bold: true, fill: COLORS.slotHeader }),
            cell(['Créneau'], 1600, { bold: true, fill: COLORS.slotHeader }),
            cell(['Avant'], 2780, { bold: true, fill: COLORS.slotHeader }),
            cell(['Après'], 2780, { bold: true, fill: COLORS.slotHeader }),
          ],
          280,
          true,
        ),
      ];
      for (const c of day.cells) {
        dRows.push(row([cell([c.room], 2200), cell([c.slotHeader], 1600), cell([c.before || '—'], 2780), cell([c.after || '—'], 2780)]));
      }
      children.push(
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2200, 1600, 2780, 2780],
          layout: TableLayoutType.FIXED,
          rows: dRows,
        }),
      );
    }
  }

  children.push(para('Détail des changements', { bold: true, size: 26 }));
  if (!result.changes.length) {
    children.push(para('Aucun changement.'));
  } else {
    let currentDay = '';
    for (const c of result.changes) {
      const dayLabel = c.days.join(' / ');
      if (dayLabel !== currentDay) {
        currentDay = dayLabel;
        children.push(para(dayLabel, { bold: true, size: 24, color: COLORS.dayText }));
      }
      children.push(
        para(
          `${TYPE_LABELS[c.type]} — ${activityText(c)}`,
          { bold: true, size: 22 },
        ),
        para(`Avant : ${locationText(c, 'before')}   →   Après : ${locationText(c, 'after')}`, { size: 20, color: '333333' }),
      );
    }
  }

  return new Document({
    creator: 'ENISo Timetable',
    title: `Fiche des changements – ${targetName}`,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 851, bottom: 851, left: 600, right: 600 },
          },
        },
        children,
      },
    ],
  });
}

export async function buildCompareDocx(result: CompareResult, baseName: string, targetName: string): Promise<Buffer> {
  return Packer.toBuffer(buildCompareDocument(result, baseName, targetName));
}
