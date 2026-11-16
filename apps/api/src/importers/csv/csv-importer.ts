import { clean, parseSlotLabel, splitSubject } from '../../parser/html-parser.js';
import { ParsedFile, ParsedSession, SlotLabel } from '../../parser/types.js';
import {
  DetectionResult,
  FileReport,
  Importer,
  ImporterResult,
  UploadedInputFile,
} from '../types.js';
import { parseCsv } from './csv-parser.js';

const CANONICAL_DAYS: Record<string, number> = {
  lundi: 0,
  mardi: 1,
  mercredi: 2,
  jeudi: 3,
  vendredi: 4,
  samedi: 5,
  dimanche: 6,
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

const REQUIRED_COLUMNS = [
  'activity id',
  'day',
  'hour',
  'students sets',
  'subject',
  'teachers',
  'room',
];

export function extractCsvDateHint(fileName: string): string {
  // e.g. EmploiS1-9-11-2026-5_timetable.csv or emplois_16-11-2026.csv
  const m = fileName.match(/(\d{1,2})[-_](\d{1,2})[-_](\d{4})/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const month = m[2].padStart(2, '0');
    const year = m[3];
    return `${day}/${month}/${year}`;
  }
  return '';
}

function parseStartMinutes(base: string): number {
  const m = base.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export class CsvImporter implements Importer {
  readonly id = 'csv' as const;

  detect(file: UploadedInputFile): DetectionResult | null {
    const isCsvExt = /\.csv$/i.test(file.originalname);
    let sample = file.buffer.slice(0, 4096).toString('utf8');
    if (sample.charCodeAt(0) === 0xfeff) sample = sample.slice(1);

    const firstLine = sample.split(/\r?\n/)[0]?.toLowerCase() ?? '';
    const hasRequired = REQUIRED_COLUMNS.every((col) => firstLine.includes(col));

    if (!hasRequired && !isCsvExt) {
      return null;
    }

    return {
      origin: 'csv',
      confidence: hasRequired ? 1.0 : 0.6,
      reason: hasRequired
        ? 'En-tête FET CSV standard détecté ("Activity Id", "Day", "Hour", ...)'
        : 'Fichier avec extension .csv',
    };
  }

  async parse(file: UploadedInputFile): Promise<ImporterResult> {
    const rawRows = parseCsv(file.buffer);

    if (rawRows.length < 1) {
      throw new Error(`Le fichier CSV « ${file.originalname} » est vide.`);
    }

    const header = rawRows[0].map((col) => clean(col).toLowerCase());
    const missing = REQUIRED_COLUMNS.filter((req) => !header.includes(req));
    if (missing.length > 0) {
      throw new Error(
        `Colonnes obligatoires manquantes dans « ${file.originalname} » : ${missing.join(', ')}`,
      );
    }

    const colIdx = {
      actId: header.indexOf('activity id'),
      day: header.indexOf('day'),
      hour: header.indexOf('hour'),
      students: header.indexOf('students sets'),
      subject: header.indexOf('subject'),
      teachers: header.indexOf('teachers'),
      room: header.indexOf('room'),
      comments: header.indexOf('comments'),
      tags: header.indexOf('activity tags'),
    };

    const warnings: string[] = [];
    const errors: string[] = [];
    const issues: FileReport['issues'] = [];

    // Check for unknown extra columns
    for (const h of header) {
      if (!REQUIRED_COLUMNS.includes(h) && h !== 'comments' && h !== 'activity tags') {
        warnings.push(`Colonne supplémentaire ignorée : « ${h} »`);
      }
    }

    // 1. Collect distinct hours in order of appearance, then sort chronologically
    const distinctHoursSet = new Set<string>();
    for (let r = 1; r < rawRows.length; r++) {
      const hStr = clean(rawRows[r][colIdx.hour]);
      if (hStr) distinctHoursSet.add(hStr);
    }

    const distinctHours = Array.from(distinctHoursSet).sort((a, b) => {
      const aSlot = parseSlotLabel(a);
      const bSlot = parseSlotLabel(b);
      return parseStartMinutes(aSlot.base) - parseStartMinutes(bSlot.base);
    });

    const slotLabels: SlotLabel[] = distinctHours.map(parseSlotLabel);

    const generatedAt = extractCsvDateHint(file.originalname);

    // 2. Process data rows
    interface InternalRow {
      rowNum: number;
      actId: string;
      day: number;
      slot: number;
      groupsList: string[];
      teachersList: string[];
      subjectCode: string;
      subject: string;
      frequency: string;
      room: string;
    }

    const validRows: InternalRow[] = [];
    const totalDataRows = rawRows.length - 1;
    let failedRowCount = 0;

    for (let r = 1; r < rawRows.length; r++) {
      const row = rawRows[r];
      const rowNum = r + 1; // 1-based index including header

      const rawDay = clean(row[colIdx.day]);
      const dayIndex = CANONICAL_DAYS[rawDay.toLowerCase()];
      if (dayIndex === undefined) {
        failedRowCount++;
        issues.push({
          row: rowNum,
          reason: `Jour inconnu ou invalide : « ${rawDay} »`,
          level: 'error',
        });
        continue;
      }

      const rawHour = clean(row[colIdx.hour]);
      const slotIndex = distinctHours.indexOf(rawHour);
      if (slotIndex === -1) {
        failedRowCount++;
        issues.push({
          row: rowNum,
          reason: `Créneau horaire non reconnu : « ${rawHour} »`,
          level: 'error',
        });
        continue;
      }

      const rawStudents = clean(row[colIdx.students]);
      const groupsList = rawStudents
        .split('+')
        .map(clean)
        .filter(Boolean);

      const rawTeachers = clean(row[colIdx.teachers]);
      const teachersList = rawTeachers
        .split('+')
        .map(clean)
        .filter(Boolean);

      const sj = splitSubject(clean(row[colIdx.subject]));
      const room = clean(row[colIdx.room]);

      validRows.push({
        rowNum,
        actId: clean(row[colIdx.actId]),
        day: dayIndex,
        slot: slotIndex,
        groupsList,
        teachersList,
        subjectCode: sj.code,
        subject: sj.subject,
        frequency: sj.frequency,
        room,
      });
    }

    const errorRatio = totalDataRows > 0 ? failedRowCount / totalDataRows : 0;
    if (errorRatio > 0.05) {
      throw new Error(
        `Import CSV rejeté : trop d'erreurs détectées (${failedRowCount}/${totalDataRows} lignes invalides, soit ${(errorRatio * 100).toFixed(1)}% > limite 5%).`,
      );
    }

    // 3. Derive views: rooms, teachers, groups
    // Normalisation: joined teacher values use ", " (matching HTML parser)
    const formatTeachers = (list: string[]) => list.join(', ');
    const formatGroups = (list: string[]) => list.join(', ');

    // Rooms view: excludes sessions without room
    const roomsOwnersSet = new Set<string>();
    const roomsSessions: ParsedSession[] = [];
    const roomsSeen = new Set<string>();

    for (const r of validRows) {
      if (!r.room) continue;
      roomsOwnersSet.add(r.room);
      const teachersStr = formatTeachers(r.teachersList);
      const groupsStr = formatGroups(r.groupsList);
      const key = [r.day, r.slot, groupsStr, teachersStr, r.subjectCode, r.room, r.room].join('|');
      if (roomsSeen.has(key)) continue;
      roomsSeen.add(key);

      roomsSessions.push({
        owner: r.room,
        day: r.day,
        slot: r.slot,
        groups: groupsStr,
        teachers: teachersStr,
        subjectCode: r.subjectCode,
        subject: r.subject,
        room: r.room,
        frequency: r.frequency,
      });
    }

    // Teachers view: each teacher gets a table
    const teachersOwnersSet = new Set<string>();
    const teachersSessions: ParsedSession[] = [];
    const teachersSeen = new Set<string>();

    for (const r of validRows) {
      for (const t of r.teachersList) {
        teachersOwnersSet.add(t);
        const teachersStr = formatTeachers(r.teachersList);
        const groupsStr = formatGroups(r.groupsList);
        const key = [r.day, r.slot, groupsStr, teachersStr, r.subjectCode, r.room, t].join('|');
        if (teachersSeen.has(key)) continue;
        teachersSeen.add(key);

        teachersSessions.push({
          owner: t,
          day: r.day,
          slot: r.slot,
          groups: groupsStr,
          teachers: teachersStr,
          subjectCode: r.subjectCode,
          subject: r.subject,
          room: r.room,
          frequency: r.frequency,
        });
      }
    }

    // Groups view: each student set gets a table
    const groupsOwnersSet = new Set<string>();
    const groupsSessions: ParsedSession[] = [];
    const groupsSeen = new Set<string>();

    for (const r of validRows) {
      for (const g of r.groupsList) {
        groupsOwnersSet.add(g);
        const teachersStr = formatTeachers(r.teachersList);
        const groupsStr = formatGroups(r.groupsList);
        // Note: in groups view, owner matches the specific group
        const key = [r.day, r.slot, groupsStr, teachersStr, r.subjectCode, r.room, g].join('|');
        if (groupsSeen.has(key)) continue;
        groupsSeen.add(key);

        groupsSessions.push({
          owner: g,
          day: r.day,
          slot: r.slot,
          groups: groupsStr,
          teachers: teachersStr,
          subjectCode: r.subjectCode,
          subject: r.subject,
          room: r.room,
          frequency: r.frequency,
        });
      }
    }

    const naturalSort = (arr: string[]) =>
      [...arr].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' }));

    const parsedRooms: ParsedFile = {
      kind: 'rooms',
      institution: '',
      comment: '',
      generatedAt,
      days: DAY_NAMES,
      slots: slotLabels,
      owners: naturalSort(Array.from(roomsOwnersSet)),
      sessions: roomsSessions,
    };

    const parsedTeachers: ParsedFile = {
      kind: 'teachers',
      institution: '',
      comment: '',
      generatedAt,
      days: DAY_NAMES,
      slots: slotLabels,
      owners: naturalSort(Array.from(teachersOwnersSet)),
      sessions: teachersSessions,
    };

    const parsedGroups: ParsedFile = {
      kind: 'groups',
      institution: '',
      comment: '',
      generatedAt,
      days: DAY_NAMES,
      slots: slotLabels,
      owners: naturalSort(Array.from(groupsOwnersSet)),
      sessions: groupsSessions,
    };

    const report: FileReport = {
      fileName: file.originalname,
      origin: 'csv',
      ownersCount: roomsOwnersSet.size + teachersOwnersSet.size + groupsOwnersSet.size,
      sessionsCount: validRows.length,
      warnings,
      errors,
      issues,
      stats: {
        totalRows: totalDataRows,
      },
    };

    return {
      parsed: [parsedRooms, parsedTeachers, parsedGroups],
      report,
    };
  }
}
