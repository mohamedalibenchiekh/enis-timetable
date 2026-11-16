import { describe, expect, it } from 'vitest';
import { CsvImporter, extractCsvDateHint } from '../src/importers/csv/csv-importer.js';

describe('CSV Importer suite', () => {
  const importer = new CsvImporter();

  it('extracts date hint from filename', () => {
    expect(extractCsvDateHint('EmploiS1-9-11-2026-5_timetable.csv')).toBe('09/11/2026');
    expect(extractCsvDateHint('emplois_16-11-2026.csv')).toBe('16/11/2026');
    expect(extractCsvDateHint('timetable.csv')).toBe('');
  });

  it('detects FET CSV files by content header', () => {
    const csv = '"Activity Id","Day","Hour","Students Sets","Subject","Teachers","Activity Tags","Room","Comments"\n';
    const detection = importer.detect({
      originalname: 'test.csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    expect(detection).not.toBeNull();
    expect(detection?.origin).toBe('csv');
    expect(detection?.confidence).toBe(1.0);
  });

  it('rejects CSV with missing required columns', async () => {
    const csv = '"Activity Id","Day","Hour","Subject"\n"1","Lundi","08:30","Maths"';
    await expect(
      importer.parse({
        originalname: 'bad.csv',
        buffer: Buffer.from(csv, 'utf8'),
      }),
    ).rejects.toThrow(/Colonnes obligatoires manquantes.*students sets, teachers, room/);
  });

  it('derives rooms, teachers, and groups views correctly', async () => {
    const csv = [
      '"Activity Id","Day","Hour","Students Sets","Subject","Teachers","Activity Tags","Room","Comments"',
      '"1","Lundi","08:30-10:00","INFO-1.1+INFO-1.2","T101 | Algorithmique (1/15)","BEN SALAH Ali+TRABELSI Sara","","A01",""',
      '"2","Mardi","10:15-11:45","INFO-1.1","T102 | Base de données","BEN SALAH Ali","","A02",""',
      '"3","Mercredi","08:30-10:00","INFO-1.2","T103 | Réseaux","","","",""', // empty room & teacher
    ].join('\n');

    const result = await importer.parse({
      originalname: 'EmploiS1-09-11-2026-1_timetable.csv',
      buffer: Buffer.from(csv, 'utf8'),
    });

    expect(result.parsed.length).toBe(3);
    const [rooms, teachers, groups] = result.parsed;

    expect(rooms.kind).toBe('rooms');
    expect(teachers.kind).toBe('teachers');
    expect(groups.kind).toBe('groups');

    // Rooms view: excludes row 3 (empty room)
    expect(rooms.owners).toEqual(['A01', 'A02']);
    expect(rooms.sessions.length).toBe(2);
    expect(rooms.sessions[0]).toMatchObject({
      owner: 'A01',
      day: 0,
      slot: 0,
      groups: 'INFO-1.1, INFO-1.2',
      teachers: 'BEN SALAH Ali, TRABELSI Sara',
      subjectCode: 'T101',
      subject: 'Algorithmique',
      frequency: '1/15',
      room: 'A01',
    });

    // Teachers view: BEN SALAH Ali (2 sessions: row 1 and row 2), TRABELSI Sara (1 session: row 1)
    expect(teachers.owners).toEqual(['BEN SALAH Ali', 'TRABELSI Sara']);
    expect(teachers.sessions.length).toBe(3);

    // Groups view: INFO-1.1 (rows 1 and 2), INFO-1.2 (rows 1 and 3)
    expect(groups.owners).toEqual(['INFO-1.1', 'INFO-1.2']);
    expect(groups.sessions.length).toBe(4);

    expect(result.report.sessionsCount).toBe(3);
    expect(result.report.errors.length).toBe(0);
  });

  it('rejects import if error ratio exceeds 5%', async () => {
    // 2 valid rows, 1 bad day row -> 33% error ratio > 5%
    const csv = [
      '"Activity Id","Day","Hour","Students Sets","Subject","Teachers","Activity Tags","Room","Comments"',
      '"1","Lundi","08:30-10:00","INFO-1","T101 | Algo","Prof A","","A01",""',
      '"2","Mardi","08:30-10:00","INFO-1","T101 | Algo","Prof A","","A01",""',
      '"3","DimancheInvalide","08:30-10:00","INFO-1","T101 | Algo","Prof A","","A01",""',
    ].join('\n');

    await expect(
      importer.parse({
        originalname: 'high_error.csv',
        buffer: Buffer.from(csv, 'utf8'),
      }),
    ).rejects.toThrow(/trop d'erreurs détectées/);
  });
});
