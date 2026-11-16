import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { detectKind } from '../../parser/html-parser.js';
import { ParsedFile, ParsedSession, SlotLabel, SourceKind } from '../../parser/types.js';
import { FileReport } from '../types.js';
import {
  buildPageGrid,
  extractSessionsFromGrid,
  extractVectorLines,
  TextItem,
} from './pdf-geometry.js';

export interface ParsePdfOptions {
  maxPages?: number;
  maxSizeBytes?: number;
  expectedKind?: SourceKind;
  onProgress?: (progress: { current: number; total: number; stage: string }) => void;
  signal?: AbortSignal;
}

const DEFAULT_MAX_PAGES = 2000;
const DEFAULT_MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export function detectPdfKind(fileName: string, sampleOwners: string[]): SourceKind | null {
  // Filename detection
  const fnKind = detectKind(fileName);

  // Content inspection on first few owners
  let roomScore = 0;
  let teacherScore = 0;
  let groupScore = 0;

  for (const o of sampleOwners.slice(0, 10)) {
    if (/^(?:A|B|M|R|E)\s*\d/i.test(o) || /amphi|labo/i.test(o)) {
      roomScore++;
    } else if (/^[A-Z]{2,4}-\d/i.test(o)) {
      groupScore++;
    } else if (/[A-Z][a-z]+|\b(?:BEN|ABDEL|EL|AL)\b/i.test(o)) {
      teacherScore++;
    }
  }

  if (roomScore > teacherScore && roomScore > groupScore) return 'rooms';
  if (groupScore > roomScore && groupScore > teacherScore) return 'groups';
  if (teacherScore > roomScore && teacherScore > groupScore) return 'teachers';

  return fnKind;
}

export async function parsePdfDocument(
  dataBuffer: Buffer,
  fileName: string,
  options: ParsePdfOptions = {},
): Promise<{ parsed: ParsedFile; report: FileReport }> {
  const maxBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  if (dataBuffer.length > maxBytes) {
    throw new Error(
      `Le fichier PDF dépasse la taille maximale autorisée de ${(maxBytes / (1024 * 1024)).toFixed(0)} Mo.`,
    );
  }

  // Load document with pdfjs in Node mode
  const uint8Data = new Uint8Array(dataBuffer);
  const loadingTask = pdfjs.getDocument({
    data: uint8Data,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const doc = await loadingTask.promise;
  const numPages = doc.numPages;

  if (numPages < 1) {
    throw new Error(`Le fichier PDF « ${fileName} » ne contient aucune page.`);
  }

  if (numPages > maxPages) {
    throw new Error(
      `Le fichier PDF « ${fileName} » contient ${numPages} pages, ce qui dépasse la limite maximale de ${maxPages} pages.`,
    );
  }

  let totalTextItemsCount = 0;
  const allOwners: string[] = [];
  const allSessions: ParsedSession[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const issues: FileReport['issues'] = [];

  let institution = '';
  let generatedAt = '';
  let slotLabels: SlotLabel[] = [];
  let dayNames: string[] = [];

  let totalCellsScanned = 0;
  let unparseableCellsCount = 0;

  // First pass on page 1 to guess kind and basic metadata
  const p1 = await doc.getPage(1);
  const tc1 = await p1.getTextContent({ includeMarkedContent: false });
  const p1Strings = tc1.items
    .map((it: any) => it.str)
    .map((s: string) => s.trim())
    .filter(Boolean);

  if (p1Strings.length < 5) {
    throw new Error(
      `Le fichier PDF « ${fileName} » ne contient aucun texte vectoriel exploitable (document numérisé ou image sans couche texte).`,
    );
  }

  // Sample the first few page titles to confirm kind
  const sampleTitles: string[] = [p1Strings[1] ?? ''];
  const sampleCheckPages = Math.min(5, numPages);
  for (let p = 2; p <= sampleCheckPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent({ includeMarkedContent: false });
    const items = tc.items.map((it: any) => it.str.trim()).filter(Boolean);
    if (items.length >= 2) sampleTitles.push(items[1]);
  }

  const detectedKind = options.expectedKind ?? detectPdfKind(fileName, sampleTitles);
  if (!detectedKind) {
    throw new Error(
      `Impossible de déterminer le type d'export (salles, enseignants ou groupes) pour le fichier PDF « ${fileName} ».`,
    );
  }

  // Iterate over all pages
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    if (options.signal?.aborted) {
      throw new Error('Importation PDF annulée par l’utilisateur.');
    }

    if (options.onProgress) {
      options.onProgress({
        current: pageNum,
        total: numPages,
        stage: `Extraction géométrique page ${pageNum}/${numPages}`,
      });
    }

    const page = await doc.getPage(pageNum);
    const tc = await page.getTextContent({ includeMarkedContent: false });
    totalTextItemsCount += tc.items.length;

    const textItems: TextItem[] = tc.items.map((it: any) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      h: it.height,
    }));

    const opList = await page.getOperatorList();
    const { hLines, vLines } = await extractVectorLines(opList);
    const grid = buildPageGrid(textItems, hLines, vLines);

    if (grid.owner) {
      allOwners.push(grid.owner);
    }
    if (!institution && grid.institution) {
      institution = grid.institution;
    }
    if (!generatedAt && grid.generatedAt) {
      generatedAt = grid.generatedAt;
    }
    if (grid.slots.length && !slotLabels.length) {
      slotLabels = grid.slots;
    }
    if (grid.dayNames.length && !dayNames.length) {
      dayNames = grid.dayNames;
    }

    const pageSessions = extractSessionsFromGrid(grid, textItems, hLines, detectedKind);
    allSessions.push(...pageSessions);

    totalCellsScanned += 36; // 6 days * 6 slots per table page
  }

  // Quality gate: ensure valid text layer was read
  if (totalTextItemsCount < numPages * 10) {
    throw new Error(
      `Couche texte insuffisante ou incomplète détectée dans « ${fileName} » (${totalTextItemsCount} éléments textuels pour ${numPages} pages).`,
    );
  }

  // Quality gate: unparseable non-empty cell ratio check (< 2%)
  const unparseableRatio = totalCellsScanned > 0 ? unparseableCellsCount / totalCellsScanned : 0;
  if (unparseableRatio > 0.02) {
    throw new Error(
      `Qualité d'extraction insuffisante pour « ${fileName} » : ${(unparseableRatio * 100).toFixed(1)}% des cellules n'ont pas pu être décodées correctement (> seuil de 2%).`,
    );
  }

  const naturalSort = (arr: string[]) =>
    [...arr].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' }));

  const parsed: ParsedFile = {
    kind: detectedKind,
    institution,
    comment: '',
    generatedAt,
    days: dayNames.length ? dayNames : ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
    slots: slotLabels,
    owners: naturalSort(Array.from(new Set(allOwners))),
    sessions: allSessions,
  };

  const report: FileReport = {
    fileName,
    origin: 'pdf',
    kind: detectedKind,
    ownersCount: parsed.owners.length,
    sessionsCount: parsed.sessions.length,
    warnings,
    errors,
    issues,
    stats: {
      totalPages: numPages,
      totalRows: allSessions.length,
    },
  };

  return { parsed, report };
}
