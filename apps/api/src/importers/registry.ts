import { ParsedFile, SourceKind } from '../parser/types.js';
import { checkDateMismatch, crossCheckSessions } from './cross-check.js';
import { CsvImporter } from './csv/csv-importer.js';
import { HtmlImporter } from './html/html-importer.js';
import { PdfImporter } from './pdf/pdf-importer.js';
import {
  DetectionResult,
  FileReport,
  ImportContext,
  Importer,
  ImportOrigin,
  ImportReport,
  UploadedInputFile,
} from './types.js';

export interface ResolvedBatch {
  views: ParsedFile[];
  report: ImportReport;
  allRooms: string[];
}

export class ImporterRegistry {
  private readonly importers: Importer[];

  constructor() {
    this.importers = [new HtmlImporter(), new CsvImporter(), new PdfImporter()];
  }

  getImporter(origin: ImportOrigin): Importer {
    const imp = this.importers.find((i) => i.id === origin);
    if (!imp) throw new Error(`Aucun importateur enregistré pour le format « ${origin} ».`);
    return imp;
  }

  detectFile(file: UploadedInputFile): { importer: Importer; detection: DetectionResult } {
    for (const importer of this.importers) {
      const detection = importer.detect(file);
      if (detection && detection.confidence >= 0.5) {
        return { importer, detection };
      }
    }
    throw new Error(
      `Format de fichier non reconnu pour « ${file.originalname} » (seuls les formats HTML FET, CSV FET et PDF FET sont acceptés).`,
    );
  }

  async parseFile(
    file: UploadedInputFile,
    ctx?: ImportContext,
  ): Promise<{ parsed: ParsedFile[]; report: FileReport }> {
    const { importer } = this.detectFile(file);
    return importer.parse(file, ctx);
  }

  async analyzeBatch(files: UploadedInputFile[], ctx: ImportContext = {}): Promise<ImportReport> {
    if (!files?.length) {
      return {
        files: [],
        canProceed: false,
        blockingErrors: ['Aucun fichier sélectionné pour l’importation.'],
        warnings: [],
      };
    }

    const fileResults: { report: FileReport; parsed: ParsedFile[] }[] = [];
    const blockingErrors: string[] = [];
    const warnings: string[] = [];

    for (const file of files) {
      try {
        const res = await this.parseFile(file, ctx);
        fileResults.push(res);
      } catch (err) {
        blockingErrors.push(`Erreur lors de l’analyse de « ${file.originalname} » : ${(err as Error).message}`);
      }
    }

    if (blockingErrors.length > 0) {
      return {
        files: fileResults.map((r) => r.report),
        canProceed: false,
        blockingErrors,
        warnings,
      };
    }

    // Check date mismatches across files
    const dateMismatch = checkDateMismatch(fileResults);
    if (dateMismatch.isMismatch && !ctx.confirmDateMismatch) {
      warnings.push(dateMismatch.message!);
    }

    // Check batch rules & conflict detection
    const origins = new Set(fileResults.map((r) => r.report.origin));
    const hasHtml = origins.has('html');
    const hasCsv = origins.has('csv');
    const hasPdf = origins.has('pdf');

    if (hasHtml && (hasCsv || hasPdf)) {
      blockingErrors.push(
        'Mélange non autorisé : les fichiers HTML historiques ne peuvent pas être combinés avec des fichiers CSV ou PDF dans un même lot d’importation.',
      );
    }

    const csvFiles = fileResults.filter((r) => r.report.origin === 'csv');
    if (csvFiles.length > 1) {
      blockingErrors.push('Un seul fichier CSV d’emploi du temps est autorisé par lot d’importation.');
    }

    // Collect catalogs
    const roomsSet = new Set<string>();
    const teachersSet = new Set<string>();
    const groupsSet = new Set<string>();

    for (const r of fileResults) {
      for (const p of r.parsed) {
        if (p.kind === 'rooms') p.owners.forEach((o) => roomsSet.add(o));
        if (p.kind === 'teachers') p.owners.forEach((o) => teachersSet.add(o));
        if (p.kind === 'groups') p.owners.forEach((o) => groupsSet.add(o));
      }
    }

    // Cross-check if both CSV and PDF are present
    let crossCheckSummary;
    if (hasCsv && hasPdf) {
      const csvParsed = csvFiles[0].parsed;
      const csvRooms = csvParsed.find((p) => p.kind === 'rooms');
      const pdfRooms = fileResults
        .filter((r) => r.report.origin === 'pdf')
        .flatMap((r) => r.parsed)
        .find((p) => p.kind === 'rooms');

      if (csvRooms && pdfRooms) {
        crossCheckSummary = crossCheckSessions(csvRooms, pdfRooms);
      }
    }

    return {
      files: fileResults.map((r) => r.report),
      canProceed: blockingErrors.length === 0,
      blockingErrors,
      warnings,
      dateMismatch,
      crossCheck: crossCheckSummary,
      catalogs: {
        rooms: Array.from(roomsSet).sort((a, b) =>
          a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' }),
        ),
        teachers: Array.from(teachersSet).sort((a, b) =>
          a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' }),
        ),
        groups: Array.from(groupsSet).sort((a, b) =>
          a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' }),
        ),
      },
    };
  }

  async resolveBatch(files: UploadedInputFile[], ctx: ImportContext = {}): Promise<ResolvedBatch> {
    const report = await this.analyzeBatch(files, ctx);
    if (!report.canProceed) {
      throw new Error(report.blockingErrors.join('\n'));
    }

    // Parse all files
    const parsedFiles = await Promise.all(files.map((f) => this.parseFile(f, ctx)));

    const origins = new Set(parsedFiles.map((p) => p.report.origin));
    const hasCsv = origins.has('csv');
    const hasPdf = origins.has('pdf');

    // Rule 1: CSV + PDFs
    if (hasCsv) {
      const csvItem = parsedFiles.find((p) => p.report.origin === 'csv')!;
      const views = [...csvItem.parsed];

      // Enrich rooms catalog from PDF catalogs if present
      const allRoomsSet = new Set<string>();
      if (report.catalogs?.rooms) {
        report.catalogs.rooms.forEach((r) => allRoomsSet.add(r));
      }
      views.forEach((v) => {
        if (v.kind === 'rooms') v.owners.forEach((r) => allRoomsSet.add(r));
      });

      // Update rooms view's owners list with complete universe
      const roomsView = views.find((v) => v.kind === 'rooms');
      if (roomsView) {
        roomsView.owners = Array.from(allRoomsSet).sort((a, b) =>
          a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' }),
        );
      }

      // If PDF has generatedAt or institution, carry it over to CSV views if empty
      const pdfItem = parsedFiles.find((p) => p.report.origin === 'pdf');
      if (pdfItem) {
        const ref = pdfItem.parsed[0];
        if (ref) {
          for (const v of views) {
            if (!v.institution && ref.institution) v.institution = ref.institution;
            if (!v.generatedAt && ref.generatedAt) v.generatedAt = ref.generatedAt;
          }
        }
      }

      return {
        views,
        report,
        allRooms: Array.from(allRoomsSet),
      };
    }

    // Rule 2: PDFs only
    if (hasPdf) {
      const allViews: ParsedFile[] = [];
      const allRoomsSet = new Set<string>();

      for (const p of parsedFiles) {
        for (const view of p.parsed) {
          allViews.push(view);
          if (view.kind === 'rooms') {
            view.owners.forEach((r) => allRoomsSet.add(r));
          }
        }
      }

      return {
        views: allViews,
        report,
        allRooms: Array.from(allRoomsSet),
      };
    }

    // Rule 3: HTML only
    const allViews: ParsedFile[] = [];
    const allRoomsSet = new Set<string>();
    for (const p of parsedFiles) {
      for (const view of p.parsed) {
        allViews.push(view);
        if (view.kind === 'rooms') {
          view.owners.forEach((r) => allRoomsSet.add(r));
        }
      }
    }

    return {
      views: allViews,
      report,
      allRooms: Array.from(allRoomsSet),
    };
  }
}
