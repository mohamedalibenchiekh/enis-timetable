import JSZip from 'jszip';
import { load } from 'cheerio';
import { normalizeProgramSlots, DEFAULT_PROGRAM_SLOTS } from './slots.js';
import { CellCatalogs, ProgramAnalysis, ProgramSession, StyleHints } from './types.js';
import { parseProgramCell } from './cell-parser.js';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const DAY_RE = /^(?:lundi|mardi|mercredi|jeudi|vendredi|samedi)\b/iu;
const dayIndex = (text: string) => ['lundi','mardi','mercredi','jeudi','vendredi','samedi'].findIndex((d) => text.toLocaleLowerCase('fr').startsWith(d));
type GridCell = { text: string; style: StyleHints; styles: StyleHints[]; colSpan: number; rowSpan: number; continuation?: boolean; restart?: boolean; anchor?: boolean };
type LogicalTable = GridCell[][];

function cellFromElement($: ReturnType<typeof load>, cell: any): GridCell {
  const $cell = $(cell);
  const paragraphs = $cell.find('w\\:p').toArray();
  const styledLines: { text: string; style: StyleHints }[] = [];
  for (const paragraph of paragraphs) {
    let plainText = '';
    let plainStyle: StyleHints = {};
    const flushPlain = () => { if (plainText.trim()) styledLines.push({ text: plainText.trim(), style: plainStyle }); plainText = ''; plainStyle = {}; };
    for (const run of $(paragraph).find('w\\:r').toArray()) {
      const runText = $(run).find('w\\:t').toArray().map((t) => $(t).text()).join('');
      if (!runText) continue;
      const runProps = $(run).children('w\\:rPr');
      const style = {
        bold: runProps.children('w\\:b').length > 0,
        italic: runProps.children('w\\:i').length > 0,
        color: runProps.children('w\\:color').attr('w:val'),
        highlight: runProps.children('w\\:highlight').attr('w:val'),
      };
      if (style.bold) { flushPlain(); styledLines.push({ text: runText.trim(), style }); }
      else { plainText += runText; plainStyle = { ...plainStyle, ...style }; }
    }
    flushPlain();
  }
  const text = styledLines.map((line) => line.text).join('\n').trim();
  const styles = styledLines.map((line) => line.style);
  const props = $cell.children('w\\:tcPr');
  const colSpan = Math.max(1, Number(props.children('w\\:gridSpan').attr('w:val') ?? 1));
  const vMerge = props.children('w\\:vMerge');
  const restart = vMerge.length > 0 && vMerge.attr('w:val') === 'restart';
  const rowSpan = vMerge.length ? (restart ? 1 : 0) : 1;
  const shd = props.children('w\\:shd');
  const firstRun = $cell.find('w\\:rPr').first();
  return {
    text, colSpan, rowSpan, continuation: rowSpan === 0, restart, styles,
    style: {
      bold: firstRun.children('w\\:b').length > 0,
      italic: firstRun.children('w\\:i').length > 0,
      color: firstRun.children('w\\:color').attr('w:val'),
      highlight: firstRun.children('w\\:highlight').attr('w:val'),
      fill: shd.attr('w:fill'),
    },
  };
}

function logicalGrid($: ReturnType<typeof load>, table: any): LogicalTable {
  const rows: LogicalTable = [];
  const active = new Map<number, GridCell>();
  for (const row of $(table).children('w\\:tr').toArray()) {
    const cells: GridCell[] = [];
    let col = 0;
    for (const rawCell of $(row).children('w\\:tc').toArray()) {
      const cell = cellFromElement($, rawCell);
      if (cell.continuation) {
        const carried = active.get(col);
        cell.text = carried?.text ?? '';
        cell.style = carried?.style ?? cell.style;
        cell.rowSpan = carried ? carried.rowSpan + 1 : 1;
        if (carried) carried.rowSpan = cell.rowSpan;
        active.set(col, carried ?? cell);
      } else {
        active.delete(col);
        if (cell.restart) active.set(col, cell);
      }
      for (let offset = 0; offset < cell.colSpan; offset++) cells[col + offset] = offset === 0 ? cell : { ...cell, anchor: false };
      col += cell.colSpan;
    }
    rows.push(cells);
  }
  return rows;
}

function paragraphText($: ReturnType<typeof load>, node: any): string { return $(node).find('w\\:t').toArray().map((t) => $(t).text()).join('').trim(); }

function metadata(text: string, tableRows: LogicalTable, filename: string): Omit<ProgramAnalysis, 'slots' | 'sessions' | 'warnings' | 'confidence' | 'rawSnapshot' | 'source'> {
  const all = [text, ...tableRows.flat().map((cell) => cell.text)].filter(Boolean).join('\n');
  const yearMatch = all.match(/20\d{2}\s*[-–/]\s*20\d{2}/u);
  const semester = all.match(/semestre\s*(\d+)/iu)?.[1] ?? '';
  const titleLines = tableRows.slice(0, 3).flat().map((cell) => cell.text).filter(Boolean);
  const programText = titleLines.find((line) => /mast[eè]re|tage|i4de|mastech|gt\s*m[12]/iu.test(line)) ?? filename.replace(/\.[^.]+$/u, '');
  const code = (/\b(GT|I4DE|MASTECH|TAGE)[\s-]*(M[12])\b/iu.exec(programText)?.slice(1).join('-') ?? programText.split(/\s+/u).slice(0, 2).join('-')).toUpperCase().replace(/\s+/gu, '-');
  const coordinator = all.match(/coordinateur\s+du\s+mast[eè]re\s*[:\-]?\s*([^\n]+)/iu)?.[1]?.trim() ?? '';
  const formRef = all.match(/PED-FR-[\w/-]+/iu)?.[0] ?? '';
  const effectiveFrom = all.match(/(?:[àa] partir du\s+)?(?:semaine du\s+)?\d{1,2}[/-]\d{1,2}[/-]20\d{2}/iu)?.[0] ?? '';
  const version = all.match(/\bv\d+(?:\.\d+)?\b/iu)?.[0] ?? '';
  const footerText = all.split('\n').filter((line) => /ENISo,?\s+le|emploi du temps,?\s+ENISO/iu.test(line)).at(-1) ?? '';
  return { code, title: programText, kind: programText, academicYear: '2026-2027', semester, coordinator, formRef, effectiveFrom, footerText, version };
}

export async function parseMastersDocx(buffer: Buffer, filename: string, referenceSlots: readonly string[] = DEFAULT_PROGRAM_SLOTS, catalogs: CellCatalogs = {}, referenceOverrides?: Record<number, Record<number, string>>): Promise<ProgramAnalysis> {
  if (buffer.length > MAX_BYTES) throw new Error('Le fichier DOCX dépasse la taille maximale de 20 Mo.');
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buffer, { checkCRC32: false }); }
  catch { throw new Error('Archive DOCX corrompue ou non valide.'); }
  const entries = Object.values(zip.files);
  const sizes = entries.filter((entry) => !entry.dir).map((entry) => {
    const data = (entry as unknown as { _data?: { uncompressedSize?: unknown; compressedSize?: unknown } })._data;
    const uncompressedSize = Number(data?.uncompressedSize);
    const compressedSize = Number(data?.compressedSize);
    if (!data || !Number.isFinite(uncompressedSize) || !Number.isFinite(compressedSize) || uncompressedSize < 0 || compressedSize < 0) return null;
    return { uncompressedSize, compressedSize };
  });
  if (entries.length > 2_000 || sizes.some((size) => size === null)
    || sizes.reduce((total, size) => total + (size?.uncompressedSize ?? 0), 0) > MAX_UNCOMPRESSED_BYTES
    || sizes.some((size) => size && (size.uncompressedSize > MAX_BYTES || (size.compressedSize > 0 && size.uncompressedSize / size.compressedSize > 150)))) {
    throw new Error('Archive DOCX trop volumineuse ou suspecte.');
  }
  const document = zip.file('word/document.xml');
  if (!document) throw new Error('Document Word sans fichier principal word/document.xml.');
  let timer: NodeJS.Timeout | undefined;
  let xml: string;
  try {
    xml = await Promise.race([document.async('string'), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Délai dépassé pendant l’analyse du document Word.')), TIMEOUT_MS); })]);
  } finally { if (timer) clearTimeout(timer); }
  const $ = load(xml, { xmlMode: true });
  const paragraphs = $('w\\:body > w\\:p').toArray().map((p) => paragraphText($, p)).filter(Boolean);
  const tables = $('w\\:body > w\\:tbl').toArray().map((table) => logicalGrid($, table));
  if (!tables.length) throw new Error('Aucun tableau trouvé dans le document Word.');
  const schedule = tables.find((grid) => grid.some((row) => row.some((cell) => DAY_RE.test(cell.text)) && row.filter((cell) => dayIndex(cell.text) >= 0).length >= 3));
  if (!schedule) throw new Error('Impossible de repérer le tableau de l’emploi du temps (ligne des jours introuvable).');
  const headerIndex = schedule.findIndex((row) => row.some((cell) => DAY_RE.test(cell.text)));
  const header = schedule[headerIndex];
  const days: number[] = [];
  header.forEach((cell, col) => {
    if (cell.anchor === false) return;
    const day = dayIndex(cell.text);
    if (day >= 0) for (let n = 0; n < cell.colSpan; n++) days[col + n] = day;
  });
  for (let col = 0; col < header.length; col++) {
    if (days[col] === undefined && col > 0 && days[col - 1] !== undefined && days[col - 1] < 5) days[col] = days[col - 1] + 1;
  }
  const timeRows = schedule.slice(headerIndex + 1).filter((row) => row.some((cell) => /\d{1,2}\s*[:.]\s*\d{2}\s*[-–]\s*\d{1,2}\s*[:.]\s*\d{2}/u.test(cell.text) || /pause/iu.test(cell.text)));
  const rawLabels = timeRows.map((row) => row[0]?.text || row.flat().find((c) => /\d{1,2}\s*[:.]\s*\d{2}\s*[-–]/u.test(c.text))?.text || '');
  const normalized = normalizeProgramSlots(rawLabels.length ? rawLabels : [...referenceSlots], referenceSlots, referenceOverrides);
  const sessions: ProgramSession[] = [];
  let cellsScanned = 0;
  let lowConfidenceCells = 0;
  timeRows.slice(0, 6).forEach((row, slot) => {
    let col = 0;
    for (const cell of row) {
      if (cell.anchor === false) { col++; continue; }
      if (cell.continuation) { col++; continue; }
      const day = days[col];
      const cellText = /\d{1,2}\s*[:.]\s*\d{2}\s*[-–]/u.test(cell.text) ? '' : cell.text;
      if (day !== undefined) cellsScanned++;
      if (day !== undefined && cellText.trim()) {
        const cellStyles = cell.styles.length
          ? cell.styles.map((style, index) => index === 0 ? { ...style, fill: cell.style.fill } : style)
          : [{ ...cell.style }];
        const parsed = parseProgramCell(cellText, cellStyles, catalogs);
        if (parsed.confidence < 0.75 && !parsed.empty) lowConfidenceCells++;
        const daySpan = Math.max(1, cell.colSpan);
        if (!parsed.empty) sessions.push({ ...parsed, day, slot, slotSpan: Math.max(1, cell.rowSpan), daySpan, source: 'docx' });
      }
      col++;
    }
  });
  const meta = metadata(paragraphs.join('\n'), schedule.slice(0, headerIndex), filename);
  const warnings = [...normalized.warnings];
  const allText = paragraphs.join('\n') + schedule.flat().map((c) => c.text).join('\n');
  const detectedYear = allText.match(/20\d{2}\s*[-–/]\s*20\d{2}/u)?.[0].replace(/\s+/gu, '').replace(/[–/]/u, '-');
  if (detectedYear && detectedYear !== meta.academicYear) warnings.push(`année incohérente dans le titre du tableau, ${meta.academicYear} retenue`);
  return { ...meta, slots: normalized.slots, sessions, warnings: [...new Set(warnings)], confidence: sessions.length ? sessions.reduce((sum, s) => sum + s.confidence, 0) / sessions.length : 0, rawSnapshot: { paragraphs, rowCount: schedule.length, columnCount: Math.max(...schedule.map((row) => row.length)), cellsScanned, lowConfidenceCells }, source: 'docx' };
}

