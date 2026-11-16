import { describe, expect, it } from 'vitest';
import { CsvImporter } from '../src/importers/csv/csv-importer.js';
import { PdfImporter } from '../src/importers/pdf/pdf-importer.js';

describe('Hostile and Malformed Input Protection Suite', () => {
  const csvImporter = new CsvImporter();
  const pdfImporter = new PdfImporter();

  it('rejects corrupt or non-PDF binary buffers', async () => {
    const corruptBuffer = Buffer.from('%PDF-1.4\ncorrupt garbage bytes that do not form a valid pdf xref');
    await expect(
      pdfImporter.parse({
        originalname: 'corrupt.pdf',
        buffer: corruptBuffer,
      }),
    ).rejects.toThrow();
  });

  it('rejects PDF without text layer (scanned or image document)', async () => {
    // PDF with no text objects, only a canvas or empty page
    // We can simulate an empty text document using pdfjs
    const emptyPdf = Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources <<>> >> endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer << /Size 4 /Root 1 0 R >>
startxref
208
%%EOF`);

    await expect(
      pdfImporter.parse({
        originalname: 'scanned_image.pdf',
        buffer: emptyPdf,
      }),
    ).rejects.toThrow(/ne contient aucun texte vectoriel exploitable/);
  });

  it('rejects oversized CSV files (> 5MB)', async () => {
    const bigCsv = Buffer.alloc(6 * 1024 * 1024, 'a');
    await expect(
      csvImporter.parse({
        originalname: 'huge.csv',
        buffer: bigCsv,
      }),
    ).rejects.toThrow(/dépasse la taille maximale autorisée de 5 Mo/);
  });

  it('rejects CSV with unclosed quotes', async () => {
    const badCsv = '"Activity Id","Day","Hour","Students Sets","Subject","Teachers","Room"\n"1","Lundi,"08:30"';
    await expect(
      csvImporter.parse({
        originalname: 'unclosed.csv',
        buffer: Buffer.from(badCsv, 'utf8'),
      }),
    ).rejects.toThrow(/Guillemet non fermé/);
  });

  it('rejects CSV with missing required columns', async () => {
    const missingCsv = '"Col1","Col2","Col3"\n"1","2","3"';
    await expect(
      csvImporter.parse({
        originalname: 'missing.csv',
        buffer: Buffer.from(missingCsv, 'utf8'),
      }),
    ).rejects.toThrow(/Colonnes obligatoires manquantes/);
  });

  it('rejects CSV with error ratio exceeding 5%', async () => {
    const badRows = [
      '"Activity Id","Day","Hour","Students Sets","Subject","Teachers","Room"',
      '"1","Lundi","08:30-10:00","G1","T1 | Maths","Prof A","A01"',
      '"2","JourInvalide","08:30-10:00","G1","T1 | Maths","Prof A","A01"',
      '"3","AutreJourInvalide","08:30-10:00","G1","T1 | Maths","Prof A","A01"',
    ].join('\n');

    await expect(
      csvImporter.parse({
        originalname: 'too_many_errors.csv',
        buffer: Buffer.from(badRows, 'utf8'),
      }),
    ).rejects.toThrow(/trop d'erreurs détectées/);
  });
});
