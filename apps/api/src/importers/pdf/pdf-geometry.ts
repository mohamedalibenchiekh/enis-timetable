import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { clean, parseSlotLabel, splitSubject } from '../../parser/html-parser.js';
import { ParsedSession, SlotLabel, SourceKind } from '../../parser/types.js';
import { CellIssue } from '../types.js';

export interface VectorLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  len: number;
}

export interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageGrid {
  owner: string;
  institution: string;
  generatedAt: string;
  slots: SlotLabel[];
  dayNames: string[];
  colBounds: number[]; // 8 boundaries for 7 columns (col 0: slots, cols 1..6: days)
  rowBounds: number[]; // Boundaries for slot rows (sorted descending)
}

const DEFAULT_DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

export async function extractVectorLines(
  opList: any,
): Promise<{ hLines: VectorLine[]; vLines: VectorLine[] }> {
  let matrix = [1, 0, 0, 1, 0, 0];
  const matrixStack: number[][] = [];
  const hLines: VectorLine[] = [];
  const vLines: VectorLine[] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    if (fn === pdfjs.OPS.save) {
      matrixStack.push([...matrix]);
    } else if (fn === pdfjs.OPS.restore) {
      if (matrixStack.length) matrix = matrixStack.pop()!;
    } else if (fn === pdfjs.OPS.transform) {
      const [a, b, c, d, e, f] = args;
      const [m0, m1, m2, m3, m4, m5] = matrix;
      matrix = [
        m0 * a + m2 * b,
        m1 * a + m3 * b,
        m0 * c + m2 * d,
        m1 * c + m3 * d,
        m0 * e + m2 * f + m4,
        m1 * e + m3 * f + m5,
      ];
    } else if (fn === pdfjs.OPS.constructPath) {
      const [subOps, coords] = args;
      const pts: [number, number][] = [];
      let ci = 0;

      for (const op of subOps) {
        if (op === pdfjs.OPS.moveTo || op === pdfjs.OPS.lineTo) {
          const x = coords[ci++];
          const y = coords[ci++];
          pts.push([matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]);
        } else if (op === pdfjs.OPS.rectangle) {
          const rx = coords[ci++];
          const ry = coords[ci++];
          const rw = coords[ci++];
          const rh = coords[ci++];
          pts.push([matrix[0] * rx + matrix[2] * ry + matrix[4], matrix[1] * rx + matrix[3] * ry + matrix[5]]);
          pts.push([
            matrix[0] * (rx + rw) + matrix[2] * (ry + rh) + matrix[4],
            matrix[1] * (rx + rw) + matrix[3] * (ry + rh) + matrix[5],
          ]);
        }
      }

      if (pts.length >= 2) {
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const w = maxX - minX;
        const h = maxY - minY;

        if (w <= 3.5 && h >= 8) {
          vLines.push({
            x1: (minX + maxX) / 2,
            x2: (minX + maxX) / 2,
            y1: minY,
            y2: maxY,
            len: h,
          });
        } else if (h <= 3.5 && w >= 8) {
          hLines.push({
            y1: (minY + maxY) / 2,
            y2: (minY + maxY) / 2,
            x1: minX,
            x2: maxX,
            len: w,
          });
        }
      }
    }
  }

  return { hLines, vLines };
}

export function buildPageGrid(
  textItems: TextItem[],
  hLines: VectorLine[],
  vLines: VectorLine[],
): PageGrid {
  const sortedItems = [...textItems].sort((a, b) => b.y - a.y || a.x - b.x);

  // 1. Footer line (Planning généré avec FET...)
  let generatedAt = '';
  const footerItem = sortedItems.find((it) => /Planning généré avec/i.test(it.str));
  if (footerItem) {
    const m = footerItem.str.match(/Planning généré avec\s*(.+)/i);
    if (m) generatedAt = clean(m[1]);
  }

  // 2. Top header lines: institution and table owner (room, group or teacher)
  const isDayOrSlotOrFooter = (s: string) => {
    const c = clean(s);
    return (
      DEFAULT_DAYS.some((d) => d.toLowerCase() === c.toLowerCase()) ||
      /\d{1,2}:\d{2}/.test(c) ||
      /Planning généré/i.test(c) ||
      c === '---'
    );
  };

  const topItems = sortedItems.filter(
    (it) => it.y > 530 && it.str.trim().length > 0 && !isDayOrSlotOrFooter(it.str),
  );
  let institution = '';
  let owner = '';

  const instItem = topItems.find((it) =>
    /ecole|institut|universit|enis|facult|college/i.test(it.str),
  );
  if (instItem) {
    institution = clean(instItem.str);
  } else if (topItems.length > 1) {
    institution = clean(topItems[0].str);
  }

  const ownerCandidates = topItems.filter((it) => clean(it.str) !== institution);
  if (ownerCandidates.length > 0) {
    // Pick candidate closest to table top (lowest Y among top items)
    const sortedByY = [...ownerCandidates].sort((a, b) => a.y - b.y);
    owner = clean(sortedByY[0].str);
  } else if (topItems.length > 0) {
    owner = clean(topItems[0].str);
  }

  // 3. Vertical column boundaries (columns 0..6: 7 columns => 8 boundaries required)
  // Cluster vertical lines by X coordinate (tolerance 4pt)
  const vClusters: { x: number; totalLen: number; lines: VectorLine[] }[] = [];
  for (const l of [...vLines].sort((a, b) => a.x1 - b.x1)) {
    const existing = vClusters.find((c) => Math.abs(c.x - l.x1) <= 4);
    if (existing) {
      existing.totalLen += l.len;
      existing.lines.push(l);
    } else {
      vClusters.push({ x: l.x1, totalLen: l.len, lines: [l] });
    }
  }

  // Primary column boundaries: lines that have sufficient total length
  let colBounds = vClusters
    .filter((c) => c.totalLen >= 40)
    .map((c) => c.x)
    .sort((a, b) => a - b);

  // Fallback if vector borders missing or incomplete (require all 8 boundaries for 7 columns)
  if (colBounds.length < 8) {
    const dayHeaders = DEFAULT_DAYS.map((d) => sortedItems.find((it) => it.str.trim() === d)).filter(
      Boolean,
    ) as TextItem[];

    if (dayHeaders.length >= 4) {
      const minX = Math.min(...dayHeaders.map((it) => it.x));
      const maxX = Math.max(...dayHeaders.map((it) => it.x + it.w));
      const colWidth = (maxX - minX) / 6;
      colBounds = [
        minX - colWidth * 0.9,
        minX,
        minX + colWidth,
        minX + colWidth * 2,
        minX + colWidth * 3,
        minX + colWidth * 4,
        minX + colWidth * 5,
        maxX + 10,
      ];
    } else {
      // Standard A4 landscape column positions
      colBounds = [18, 123, 246, 362, 478, 593, 709, 825];
    }
  }

  // 4. Horizontal row boundaries: in column 0 (between colBounds[0] and colBounds[1])
  const col0Width = (colBounds[1] ?? 123) - (colBounds[0] ?? 18);
  const col0HLines = hLines.filter(
    (l) => l.x1 <= colBounds[0] + 15 && l.x2 >= colBounds[0] + col0Width * 0.7,
  );

  const rowBounds: number[] = [];
  for (const l of [...col0HLines].sort((a, b) => b.y1 - a.y1)) {
    if (!rowBounds.some((y) => Math.abs(y - l.y1) <= 4)) {
      rowBounds.push(l.y1);
    }
  }

  // Extract slot labels from col 0
  const slotLabels: SlotLabel[] = [];
  const col0Items = sortedItems.filter(
    (it) => it.x < colBounds[1] - 3 && it.x >= colBounds[0] - 5 && /\d{1,2}:\d{2}/.test(it.str),
  );

  for (const it of col0Items) {
    if (!slotLabels.some((s) => s.raw === clean(it.str))) {
      slotLabels.push(parseSlotLabel(it.str));
    }
  }

  return {
    owner,
    institution,
    generatedAt,
    slots: slotLabels,
    dayNames: DEFAULT_DAYS,
    colBounds,
    rowBounds,
  };
}

export interface GridExtractionResult {
  sessions: ParsedSession[];
  unparseableCells: number;
  totalNonEmptyCells: number;
  issues: CellIssue[];
}

/**
 * Assigns text items into cells and extracts sessions.
 * Handles multi-slot spanning cells and sub-column split cells.
 */
export function extractSessionsFromGrid(
  grid: PageGrid,
  textItems: TextItem[],
  hLines: VectorLine[],
  kind: SourceKind,
): GridExtractionResult {
  const sessions: ParsedSession[] = [];
  const issues: CellIssue[] = [];
  let unparseableCells = 0;
  let totalNonEmptyCells = 0;
  const { colBounds, rowBounds, owner } = grid;

  // We have 6 days (cols 1..6) and 6 time slots (rows 0..5)
  // rowBounds has boundaries sorted descending:
  // rowBounds[0] is top of header row
  // rowBounds[1] is top of slot 0 / bottom of header row
  // rowBounds[s + 1] is top of slot s, rowBounds[s + 2] is bottom of slot s
  const numSlots = Math.min(6, rowBounds.length - 2);

  // Helper: check if horizontal border exists in day column d at boundary between slot s and s+1
  const hasBorderBetween = (dayCol: number, slotIdx: number): boolean => {
    const yBound = rowBounds[slotIdx + 2];
    if (yBound === undefined) return true;
    const xLeft = colBounds[dayCol + 1];
    const xRight = colBounds[dayCol + 2];
    const border = hLines.find(
      (l) => Math.abs(l.y1 - yBound) <= 4 && l.x1 <= xLeft + 10 && l.x2 >= xRight - 10,
    );
    return border !== undefined;
  };

  for (let day = 0; day < 6; day++) {
    const xLeft = colBounds[day + 1];
    const xRight = colBounds[day + 2];
    let slot = 0;

    while (slot < numSlots) {
      const yTop = rowBounds[slot + 1];
      let spanEndSlot = slot;

      // Check for tall spanning cell (no horizontal border separating subsequent slots)
      while (spanEndSlot + 1 < numSlots && !hasBorderBetween(day, spanEndSlot)) {
        spanEndSlot++;
      }

      const yBot = rowBounds[spanEndSlot + 2];
      const cellItems = textItems.filter(
        (it) =>
          it.x >= xLeft - 3 &&
          it.x <= xRight + 3 &&
          it.y >= (yBot ?? 0) - 2 &&
          it.y <= (yTop ?? 999) + 2 &&
          clean(it.str) !== '' &&
          clean(it.str) !== '---',
      );

      if (cellItems.length > 0) {
        totalNonEmptyCells++;
        const parsedList = parseCellContent(cellItems, xLeft, xRight, kind, owner, day);
        if (parsedList.length === 0) {
          unparseableCells++;
          issues.push({
            day,
            slot,
            owner,
            text: cellItems.map((c) => c.str).join(' ').slice(0, 100),
            reason: 'Impossible d’extraire une séance valide de cette cellule non vide',
            level: 'warning',
          });
        } else {
          for (const s of parsedList) {
            // Replicate across all covered slots (exact FET rowspan semantics)
            for (let sIdx = slot; sIdx <= spanEndSlot; sIdx++) {
              sessions.push({ ...s, slot: sIdx });
            }
          }
        }
      }

      slot = spanEndSlot + 1;
    }
  }

  return {
    sessions,
    unparseableCells,
    totalNonEmptyCells,
    issues,
  };
}

/**
 * Splits text items inside a cell into sub-columns (for split TP groups / parallel activities)
 * and extracts parsed sessions for each.
 */
function parseCellContent(
  items: TextItem[],
  cellLeft: number,
  cellRight: number,
  kind: SourceKind,
  owner: string,
  day: number,
): ParsedSession[] {
  const subCols = detectSubColumns(items, cellLeft, cellRight);
  const results: ParsedSession[] = [];

  for (const colItems of subCols) {
    const session = parseSingleActivity(colItems, kind, owner, day);
    if (session) {
      results.push(session);
    }
  }

  return results;
}

/**
 * Identifies sub-columns by clustering horizontal gaps between items on the same line.
 * Handles 1, 2, 3 or more parallel activity sub-columns.
 */
function detectSubColumns(
  items: TextItem[],
  cellLeft: number,
  cellRight: number,
): TextItem[][] {
  const cellWidth = cellRight - cellLeft;
  if (items.length <= 1 || cellWidth <= 20) return [items];

  // Look for items on the same Y level with a gap > 12pt
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const gaps: number[] = [];

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (Math.abs(a.y - b.y) <= 3) {
        const leftItem = a.x < b.x ? a : b;
        const rightItem = a.x < b.x ? b : a;
        const gap = rightItem.x - (leftItem.x + leftItem.w);
        if (gap > 12) {
          gaps.push(leftItem.x + leftItem.w + gap / 2);
        }
      }
    }
  }

  if (gaps.length === 0) {
    return [items];
  }

  // Cluster gap midpoints (tolerance 10pt)
  const gapClusters: { x: number; count: number }[] = [];
  for (const g of gaps) {
    const existing = gapClusters.find((c) => Math.abs(c.x - g) <= 10);
    if (existing) {
      existing.x = (existing.x * existing.count + g) / (existing.count + 1);
      existing.count++;
    } else {
      gapClusters.push({ x: g, count: 1 });
    }
  }

  const splitPoints = gapClusters
    .filter((c) => c.x > cellLeft + 15 && c.x < cellRight - 15)
    .map((c) => c.x)
    .sort((a, b) => a - b);

  if (splitPoints.length === 0) {
    return [items];
  }

  const subCols: TextItem[][] = Array.from({ length: splitPoints.length + 1 }, () => []);
  for (const it of items) {
    const mid = it.x + it.w / 2;
    let colIdx = 0;
    while (colIdx < splitPoints.length && mid > splitPoints[colIdx]) {
      colIdx++;
    }
    subCols[colIdx].push(it);
  }

  const activeCols = subCols.filter((col) => col.length > 0);
  return activeCols.length > 1 ? activeCols : [items];
}

/**
 * Assembles lines from a set of text items and parses session fields according to export kind.
 */
function parseSingleActivity(
  items: TextItem[],
  kind: SourceKind,
  owner: string,
  day: number,
): ParsedSession | null {
  // Group text items by Y level into lines
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: string[] = [];
  let currentLine: TextItem[] = [];

  for (const it of sorted) {
    if (!currentLine.length) {
      currentLine.push(it);
    } else {
      const prev = currentLine[currentLine.length - 1];
      if (Math.abs(prev.y - it.y) <= 3) {
        currentLine.push(it);
      } else {
        lines.push(currentLine.map((i) => i.str).join(' '));
        currentLine = [it];
      }
    }
  }
  if (currentLine.length) {
    lines.push(currentLine.map((i) => i.str).join(' '));
  }

  const cleanedLines = lines.map(clean).filter((l) => l.length > 0 && l !== '---');
  if (!cleanedLines.length) return null;

  let groups = '';
  let teachers = '';
  let subjectRaw = '';
  let room = '';

  const norm = (s: string) => clean(s).toLowerCase();

  switch (kind) {
    case 'rooms': {
      // Detailed split cell: room / group / teacher / subject
      // Simple cell: group / teacher / subject
      if (cleanedLines.length >= 4) {
        const potentialRoom = cleanedLines[0];
        // If the first line is a room name
        if (norm(potentialRoom) === norm(owner)) {
          // Belongs to this room
          groups = cleanedLines[1];
          teachers = cleanedLines[2];
          subjectRaw = cleanedLines.slice(3).join(' ');
          room = owner;
        } else if (norm(potentialRoom) !== norm(owner) && cleanedLines.length >= 4 && /[A-Z]\s*\d/i.test(potentialRoom)) {
          // Belongs to another room in a split cell: discard
          return null;
        } else {
          groups = cleanedLines[0];
          teachers = cleanedLines[1];
          subjectRaw = cleanedLines.slice(2).join(' ');
          room = owner;
        }
      } else {
        groups = cleanedLines[0] ?? '';
        teachers = cleanedLines[1] ?? '';
        subjectRaw = cleanedLines.slice(2).join(' ');
        room = owner;
      }
      break;
    }

    case 'teachers': {
      // Detailed split cell: teacher / group / subject / room
      // Simple cell: group / subject / room
      if (cleanedLines.length >= 4 && norm(cleanedLines[0]) === norm(owner)) {
        groups = cleanedLines[1];
        room = cleanedLines[cleanedLines.length - 1];
        subjectRaw = cleanedLines.slice(2, cleanedLines.length - 1).join(' ');
        teachers = owner;
      } else if (cleanedLines.length >= 4 && norm(cleanedLines[0]) !== norm(owner) && /[A-Z]{3,}/i.test(cleanedLines[0])) {
        // Belongs to another teacher in a split cell: discard
        return null;
      } else {
        groups = cleanedLines[0] ?? '';
        if (cleanedLines.length >= 3) {
          room = cleanedLines[cleanedLines.length - 1];
          subjectRaw = cleanedLines.slice(1, cleanedLines.length - 1).join(' ');
        } else {
          subjectRaw = cleanedLines[1] ?? '';
        }
        teachers = owner;
      }
      break;
    }

    case 'groups': {
      // Structure: [subgroup] / subject / teacher / room
      if (cleanedLines.length >= 4) {
        groups = cleanedLines[0];
        room = cleanedLines[cleanedLines.length - 1];
        teachers = cleanedLines[cleanedLines.length - 2];
        subjectRaw = cleanedLines.slice(1, cleanedLines.length - 2).join(' ');
      } else if (cleanedLines.length === 3) {
        groups = owner;
        subjectRaw = cleanedLines[0];
        teachers = cleanedLines[1];
        room = cleanedLines[2];
      } else {
        groups = owner;
        subjectRaw = cleanedLines[0] ?? '';
        teachers = cleanedLines[1] ?? '';
      }
      break;
    }
  }

  const sj = splitSubject(subjectRaw);

  return {
    owner,
    day,
    slot: 0, // slot set by caller
    groups,
    teachers,
    subjectCode: sj.code,
    subject: sj.subject,
    room,
    frequency: sj.frequency,
  };
}
