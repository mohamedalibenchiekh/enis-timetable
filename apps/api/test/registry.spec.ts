import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ImporterRegistry } from '../src/importers/registry.js';

describe('ImporterRegistry and Batch Resolution Suite', () => {
  const registry = new ImporterRegistry();
  const fixturesDir = path.resolve(__dirname, 'fixtures');

  const readFixture = (name: string) => fs.readFileSync(path.join(fixturesDir, name));

  it('detects origin by content first, filename second', () => {
    // 1. HTML detection
    const htmlBuf = readFixture('FET_rooms_test.html');
    const htmlDet = registry.detectFile({ originalname: 'unknown_name.txt', buffer: htmlBuf });
    expect(htmlDet.detection.origin).toBe('html');
    expect(htmlDet.detection.kind).toBe('rooms');

    // 2. CSV detection
    const csvBuf = readFixture('synthetic_timetable.csv');
    const csvDet = registry.detectFile({ originalname: 'unknown_file.dat', buffer: csvBuf });
    expect(csvDet.detection.origin).toBe('csv');

    // 3. PDF detection (%PDF magic bytes)
    const pdfBuf = readFixture('FET_rooms_test.pdf');
    const pdfDet = registry.detectFile({ originalname: 'arbitrary_file.bin', buffer: pdfBuf });
    expect(pdfDet.detection.origin).toBe('pdf');

    // 4. Filename fallback when content is unrecognized
    const fallbackCsv = registry.detectFile({
      originalname: 'export.csv',
      buffer: Buffer.from('unrecognized content that is neither html nor pdf nor standard csv header'),
    });
    expect(fallbackCsv.detection.origin).toBe('csv');
  });

  it('rejects forbidden mixed batches (HTML + CSV or HTML + PDF)', async () => {
    const htmlBuf = readFixture('FET_rooms_test.html');
    const csvBuf = readFixture('synthetic_timetable.csv');
    const pdfBuf = readFixture('FET_rooms_test.pdf');

    const reportHtmlCsv = await registry.analyzeBatch([
      { originalname: 'FET_rooms.html', buffer: htmlBuf },
      { originalname: 'timetable.csv', buffer: csvBuf },
    ]);

    expect(reportHtmlCsv.canProceed).toBe(false);
    expect(reportHtmlCsv.blockingErrors.some((e) => e.includes('Mélange non autorisé'))).toBe(true);

    const reportHtmlPdf = await registry.analyzeBatch([
      { originalname: 'FET_rooms.html', buffer: htmlBuf },
      { originalname: 'FET_rooms_test.pdf', buffer: pdfBuf },
    ]);

    expect(reportHtmlPdf.canProceed).toBe(false);
    expect(reportHtmlPdf.blockingErrors.some((e) => e.includes('Mélange non autorisé'))).toBe(true);
  });

  it('rejects batch with multiple CSV files', async () => {
    const csvBuf = readFixture('synthetic_timetable.csv');

    const report = await registry.analyzeBatch([
      { originalname: 'timetable1.csv', buffer: csvBuf },
      { originalname: 'timetable2.csv', buffer: csvBuf },
    ]);

    expect(report.canProceed).toBe(false);
    expect(report.blockingErrors.some((e) => e.includes('Un seul fichier CSV'))).toBe(true);
  });

  it('resolves CSV + PDF batch with CSV authoritative and PDF catalog enrichment', async () => {
    const csvBuf = readFixture('synthetic_timetable.csv');
    const pdfBuf = readFixture('FET_rooms_test.pdf');

    const batch = await registry.resolveBatch(
      [
        { originalname: 'EmploiS1-09-11-2026-1_timetable.csv', buffer: csvBuf },
        { originalname: 'emplois_16-11-2026-salles.pdf', buffer: pdfBuf },
      ],
      { confirmDateMismatch: true },
    );

    expect(batch.views.length).toBe(3);
    const roomsView = batch.views.find((v) => v.kind === 'rooms');
    expect(roomsView).toBeDefined();

    // CSV sessions are authoritative (7 rows in synthetic_timetable.csv)
    expect(roomsView!.sessions.length).toBe(7);

    // PDF catalog enriches all rooms (including any rooms from the PDF)
    expect(batch.allRooms.length).toBeGreaterThanOrEqual(5);
  });

  it('detects date mismatch between CSV and PDF files and generates warning', async () => {
    const csvBuf = readFixture('synthetic_timetable.csv');
    const pdfBuf = readFixture('FET_rooms_test.pdf');

    const report = await registry.analyzeBatch([
      { originalname: 'EmploiS1-09-11-2026-1_timetable.csv', buffer: csvBuf },
      { originalname: 'emplois_16-11-2026-salles.pdf', buffer: pdfBuf },
    ]);

    expect(report.dateMismatch).toBeDefined();
    expect(report.dateMismatch?.isMismatch).toBe(true);
    expect(report.warnings.some((w) => w.includes('dates de génération différentes'))).toBe(true);
  });
});
