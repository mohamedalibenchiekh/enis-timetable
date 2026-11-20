import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { normalizeProgramSlots, DEFAULT_PROGRAM_SLOTS } from './slots.js';
import { CellCatalogs, ProgramAnalysis, ProgramSession } from './types.js';
import { parseProgramCell } from './cell-parser.js';

const MAX_BYTES = 20 * 1024 * 1024;
const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const TIMEOUT_MS = 120_000;
export interface PdfTextCoordinate { text: string; y: number; }

export function findPdfSlotRowY(slotLabel: string, timeColumnItems: PdfTextCoordinate[]): number {
  const match = slotLabel.match(/(\d{1,2})\s*[:.]\s*(\d{2})/u);
  const start = match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
  const candidates = timeColumnItems.filter((item) => {
    const time = item.text.match(/^\s*(\d{1,2})\s*[:.]\s*(\d{2})/u);
    return Boolean(start && time && `${time[1].padStart(2, '0')}:${time[2]}` === start);
  });
  const preferred = candidates.filter((item) => !/[()]/u.test(item.text));
  return (preferred.length ? preferred : candidates)
    .sort((a, b) => Number(/\d{1,2}[:.]\d{2}\s*[-–]\s*\d{1,2}[:.]\d{2}/u.test(b.text)) - Number(/\d{1,2}[:.]\d{2}\s*[-–]\s*\d{1,2}[:.]\d{2}/u.test(a.text)))[0]?.y ?? Number.NaN;
}

async function withTimeout<T>(promise: Promise<T>, onTimeout?: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { onTimeout?.(); reject(new Error('Délai dépassé pendant l’analyse du PDF.')); }, TIMEOUT_MS); })]);
  } finally { if (timer) clearTimeout(timer); }
}

export function pdfRowBounds(rows: number[], slot: number, y: number): { upper: number; lower: number } {
  const previous = rows[slot - 1];
  const next = rows[slot + 1];
  return {
    upper: slot === 0 || !Number.isFinite(previous) ? y + 22 : (previous + y) / 2,
    lower: slot === rows.length - 1 || !Number.isFinite(next) ? y - 26 : (y + next) / 2 - 4,
  };
}

export async function parseMastersPdf(buffer: Buffer, filename: string, referenceSlots: readonly string[] = DEFAULT_PROGRAM_SLOTS, catalogs: CellCatalogs = {}, referenceOverrides?: Record<number, Record<number, string>>): Promise<ProgramAnalysis> {
  if (buffer.length > MAX_BYTES) throw new Error('Le fichier PDF dépasse la taille maximale de 20 Mo.');
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true, disableFontFace: true, stopAtErrors: true, disableAutoFetch: true, disableStream: true, disableRange: true });
  let doc: Awaited<typeof task.promise> | undefined;
  let timedOut = false;
  try {
    try { doc = await withTimeout(task.promise, () => { timedOut = true; }); }
    catch (error) {
      const message = (error as Error).message;
      if (/password|encrypted/iu.test(message)) throw new Error('Le PDF est chiffré et ne peut pas être analysé.');
      throw new Error(/Délai dépassé/u.test(message) ? message : 'PDF illisible ou chiffré.');
    }
    if (doc.numPages !== 1) throw new Error(`Un PDF de mastère doit contenir une seule page (pages détectées : ${doc.numPages}).`);
    const page = await doc.getPage(1);
    const content = await withTimeout(page.getTextContent({ includeMarkedContent: false }), () => { timedOut = true; });
    const textItems = (content as { items: unknown[] }).items as Array<{ str?: string; transform?: number[]; width?: number; height?: number; fontName?: string }>;
    const items = textItems.filter((item): item is { str: string; transform: number[]; width: number; height: number; fontName: string } => typeof item.str === 'string' && Array.isArray(item.transform) && typeof item.width === 'number' && typeof item.height === 'number' && typeof item.fontName === 'string')
      .map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5], w: item.width, h: item.height, font: item.fontName }))
      .filter((item) => item.text);
    if (items.length < 20) throw new Error('Le PDF ne contient pas de couche texte exploitable (les documents numérisés ne sont pas acceptés).');
    const headerItems = items.filter((item) => DAY_NAMES.some((day) => item.text.toLocaleLowerCase('fr').startsWith(day)));
    const columns = DAY_NAMES.map((day) => headerItems.find((item) => item.text.toLocaleLowerCase('fr').startsWith(day))).filter((item): item is NonNullable<typeof item> => Boolean(item)).sort((a, b) => a.x - b.x);
    if (columns.length < 5) throw new Error('Ligne des jours introuvable dans le PDF du mastère.');
    const xCuts = [columns[0].x, ...columns.slice(1).map((item, i) => (columns[i].x + item.x) / 2), Infinity];
    const scheduleItems = items.filter((item) => item.y <= Math.max(...columns.map((col) => col.y)) && item.y > Math.min(...columns.map((col) => col.y)) - 420);
    const timeColumnItems = scheduleItems.filter((item) => item.x < columns[0].x);
    const rows = referenceSlots.slice(0, 6).map((slot) => findPdfSlotRowY(slot, timeColumnItems));
    const slotLabels = rows.map((y, slot) => {
      if (!Number.isFinite(y)) return referenceSlots[slot] ?? DEFAULT_PROGRAM_SLOTS[slot];
      const { upper, lower } = pdfRowBounds(rows, slot, y);
      const parts = timeColumnItems.filter((item) => item.y <= upper && item.y >= lower).sort((a, b) => b.y - a.y).map((item) => item.text);
      return parts.join(' ') || referenceSlots[slot] || DEFAULT_PROGRAM_SLOTS[slot];
    });
    const normalized = normalizeProgramSlots(slotLabels.length ? slotLabels : [...referenceSlots], referenceSlots, referenceOverrides);
    const sessions: ProgramSession[] = [];
    let lowConfidenceCells = 0;
    rows.forEach((y, slot) => {
      if (!Number.isFinite(y)) return;
      const { upper, lower } = pdfRowBounds(rows, slot, y);
      for (let day = 0; day < columns.length; day++) {
        const left = xCuts[day]; const right = xCuts[day + 1];
        const cellItems = scheduleItems.filter((item) => item.y <= upper && item.y >= lower && item.x >= left && item.x < right);
        const text = cellItems.sort((a, b) => b.y - a.y || a.x - b.x).map((item) => item.text).join('\n').trim();
        if (text) {
          const parsed = parseProgramCell(text, cellItems.map((item) => ({ bold: /bold|black|semibold/iu.test(item.font), italic: /italic|oblique/iu.test(item.font) })), catalogs);
          if (parsed.confidence < 0.75 && !parsed.empty) lowConfidenceCells++;
          if (!parsed.empty) sessions.push({ ...parsed, day, slot, slotSpan: 1, daySpan: 1, source: 'pdf' });
        }
      }
    });
    const fullText = items.map((item) => item.text).join('\n');
    const programLine = items.find((item) => /mast[eè]re|tage|i4de|mastech/iu.test(item.text))?.text ?? filename.replace(/\.[^.]+$/u, '');
    const code = (/\b(GT|I4DE|MASTECH|TAGE)[\s-]*(M[12])\b/iu.exec(programLine)?.slice(1).join('-') ?? programLine.split(/\s+/u).slice(0,2).join('-')).toUpperCase().replace(/\s+/gu, '-');
    const warnings = [...normalized.warnings, 'PDF : couleur de fond des cellules et remplissages vectoriels non disponibles dans cette extraction.'];
    if (/2025\s*[-–/]\s*2026/u.test(fullText)) warnings.push('année incohérente dans le titre du tableau, 2026-2027 retenue');
    return {
      code, title: programLine, kind: programLine, academicYear: '2026-2027', semester: fullText.match(/semestre\s*(\d+)/iu)?.[1] ?? '',
      coordinator: '', formRef: fullText.match(/PED-FR-[\w/-]+/iu)?.[0] ?? '', effectiveFrom: fullText.match(/\d{1,2}[/-]\d{1,2}[/-]20\d{2}/u)?.[0] ?? '',
      footerText: items.filter((item) => /ENISo,?\s+le|emploi du temps,?\s+ENISO/iu.test(item.text)).map((item) => item.text).join(' '),
      version: fullText.match(/\bv\d+(?:\.\d+)?\b/iu)?.[0] ?? '', slots: normalized.slots, sessions, warnings: [...new Set(warnings)],
      confidence: sessions.length ? sessions.reduce((sum, session) => sum + session.confidence, 0) / sessions.length : 0,
      rawSnapshot: { textItems: items.length, pageCount: 1, cellsScanned: rows.length * columns.length, lowConfidenceCells }, source: 'pdf',
    };
  } finally {
    if (doc) await doc.destroy().catch(() => undefined);
    if (!doc || timedOut) await task.destroy().catch(() => undefined);
  }
}

