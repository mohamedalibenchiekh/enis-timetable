import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CsvImporter } from '../src/importers/csv/csv-importer.js';
import { PdfImporter } from '../src/importers/pdf/pdf-importer.js';
import { ImporterRegistry } from '../src/importers/registry.js';

const privateDataDir = process.env.ENIS_PRIVATE_DATA;
const hasPrivateData = Boolean(privateDataDir && fs.existsSync(privateDataDir));

describe.skipIf(!hasPrivateData)('Private real files test suite (ENIS_PRIVATE_DATA)', () => {
  const csvImporter = new CsvImporter();
  const pdfImporter = new PdfImporter();
  const registry = new ImporterRegistry();

  it('parses real CSV export accurately without errors', async () => {
    const csvFiles = fs
      .readdirSync(privateDataDir!)
      .filter((f) => f.endsWith('.csv') && !f.endsWith('.txt'));

    expect(csvFiles.length).toBeGreaterThanOrEqual(1);
    const csvFileName = csvFiles[0];
    const csvBuffer = fs.readFileSync(path.join(privateDataDir!, csvFileName));

    const result = await csvImporter.parse({
      originalname: csvFileName,
      buffer: csvBuffer,
    });

    expect(result.parsed.length).toBe(3);
    const [rooms, teachers, groups] = result.parsed;

    expect(rooms.sessions.length).toBeGreaterThan(500);
    expect(teachers.sessions.length).toBeGreaterThan(500);
    expect(groups.sessions.length).toBeGreaterThan(500);

    // Verify stats without logging personal names
    expect(rooms.owners.length).toBeGreaterThan(40);
    expect(teachers.owners.length).toBeGreaterThan(100);
    expect(groups.owners.length).toBeGreaterThan(50);
  });

  it('parses real PDF exports accurately when present', async () => {
    const pdfFiles = fs
      .readdirSync(privateDataDir!)
      .filter((f) => f.endsWith('.pdf') && !f.endsWith('.txt'));

    for (const pdfFile of pdfFiles) {
      const pdfBuffer = fs.readFileSync(path.join(privateDataDir!, pdfFile));
      const res = await pdfImporter.parse({
        originalname: pdfFile,
        buffer: pdfBuffer,
      });

      expect(res.parsed.length).toBe(1);
      const parsed = res.parsed[0];
      expect(parsed.owners.length).toBeGreaterThan(0);
      expect(parsed.sessions.length).toBeGreaterThanOrEqual(0);
      expect(parsed.slots.length).toBe(6);
    }
  });

  it('resolves real batch and cross-checks without crashing', async () => {
    const files = fs
      .readdirSync(privateDataDir!)
      .filter((f) => (f.endsWith('.pdf') || f.endsWith('.csv')) && !f.endsWith('.txt'))
      .map((f) => ({
        originalname: f,
        buffer: fs.readFileSync(path.join(privateDataDir!, f)),
      }));

    const report = await registry.analyzeBatch(files);
    expect(report.files.length).toBe(files.length);
  });
});
