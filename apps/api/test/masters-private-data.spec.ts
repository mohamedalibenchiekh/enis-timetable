import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseMastersDocx } from '../src/masters/docx-importer.js';
import { parseMastersPdf } from '../src/masters/pdf-importer.js';

const privateDir = process.env.ENIS_PRIVATE_DATA;
const privateFiles = [
  'A-16--model-Emploi-mast-GT-M1-16-novembre-2026 (1).docx',
  'TAGE-M1_S1_16_11_2026.pdf',
  'TAGE-M2_S1_16.11.2026.pdf',
  'Emploi du temps_I4DE M1 2026 2027 final.docx',
  'Emploi du temps_I4DE M2 - Semestre 3 periode 1 04102026.pdf',
  'A-09-Emploi-model-mast-GT-M2-09-novembre-2026.docx',
  'Emploi du temps_MasTech_2026_2027_M1 -Q2-05 10 2026.docx',
];

describe.skipIf(!privateDir)('private master timetable fixtures', () => {
  for (const [index, filename] of privateFiles.entries()) {
    it(`parses private timetable ${index + 1}`, async () => {
      const buffer = await fs.readFile(path.join(privateDir!, filename));
      const parsed = filename.endsWith('.docx')
        ? await parseMastersDocx(buffer, filename)
        : await parseMastersPdf(buffer, filename);
      const counts = {
        fileIndex: index + 1,
        cells: Number(parsed.rawSnapshot.cellsScanned ?? 0),
        sessions: parsed.sessions.length,
        lowConfidenceCells: Number(parsed.rawSnapshot.lowConfidenceCells ?? 0),
        warnings: parsed.warnings.length,
        unassignedRooms: parsed.sessions.filter((session) => session.roomUnassigned).length,
        correctedFridayLabels: parsed.warnings.filter((warning) => warning.includes('vendredi corrigé')).length,
      };
      console.info(JSON.stringify(counts));
      expect(parsed.academicYear).toBe('2026-2027');
      expect(parsed.slots).toHaveLength(6);
      expect(parsed.sessions.length).toBeGreaterThan(0);
      if (index === 0) expect(parsed.sessions.some((session) => session.day === 0 && session.slot === 0 && session.room === 'PAQ/DGSE')).toBe(true);
      if (index === 3) expect(parsed.academicYear).toBe('2026-2027');
    });
  }
});
