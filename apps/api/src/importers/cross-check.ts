import { clean } from '../parser/html-parser.js';
import { ParsedFile, ParsedSession } from '../parser/types.js';
import { CrossCheckSummary, DateMismatchInfo, FileReport } from './types.js';

const norm = (s: string | undefined | null) =>
  clean(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

export function checkDateMismatch(files: { report: FileReport; parsed: ParsedFile[] }[]): DateMismatchInfo {
  const detectedDates: DateMismatchInfo['detectedDates'] = [];

  for (const { report, parsed } of files) {
    for (const p of parsed) {
      if (p.generatedAt) {
        detectedDates.push({
          fileName: report.fileName,
          date: p.generatedAt,
          origin: report.origin,
        });
        break;
      }
    }
  }

  // Normalize date string: DD/MM/YYYY or similar
  const distinctDates = Array.from(new Set(detectedDates.map((d) => d.date.split(' ')[0])));
  const isMismatch = distinctDates.length > 1;

  let message: string | undefined;
  if (isMismatch) {
    message = `Attention : des dates de génération différentes ont été détectées parmi vos fichiers (${distinctDates.join(' vs ')}). Vérifiez s'il s'agit bien de la même version d'emploi du temps.`;
  }

  const details = detectedDates.map(
    (d) => `Fichier « ${d.fileName} » (${d.origin}) : date détectée ${d.date}`,
  );

  return {
    detectedDates,
    dates: distinctDates,
    details,
    isMismatch,
    message,
  };
}

export function crossCheckSessions(
  primaryFile: ParsedFile,
  referenceFile: ParsedFile,
): CrossCheckSummary {
  const primarySessions = primaryFile.sessions;
  const refSessions = referenceFile.sessions;

  const discrepancies: string[] = [];
  let matched = 0;

  // Key function comparing day, slot, normalized room, teacher, group, subjectCode
  const makeKey = (s: ParsedSession) =>
    [s.day, s.slot, norm(s.room), norm(s.teachers), norm(s.groups), norm(s.subjectCode)].join('|');

  const refSet = new Map<string, ParsedSession>();
  for (const s of refSessions) {
    refSet.set(makeKey(s), s);
  }

  const primarySet = new Map<string, ParsedSession>();
  for (const s of primarySessions) {
    primarySet.set(makeKey(s), s);
  }

  // 1. Check primary in reference
  for (const [k, s] of primarySet.entries()) {
    if (refSet.has(k)) {
      matched++;
    } else {
      discrepancies.push(
        `Séance [Jour ${s.day + 1}, Créneau ${s.slot + 1}] ${s.subjectCode} (${s.room} / ${s.teachers} / ${s.groups}) présente dans le fichier principal mais absente dans la référence.`,
      );
    }
  }

  // 2. Symmetric check: check reference in primary
  for (const [k, s] of refSet.entries()) {
    if (!primarySet.has(k)) {
      discrepancies.push(
        `Séance [Jour ${s.day + 1}, Créneau ${s.slot + 1}] ${s.subjectCode} (${s.room} / ${s.teachers} / ${s.groups}) présente dans la référence mais absente dans le fichier principal.`,
      );
    }
  }

  return {
    matchedSessions: matched,
    discrepancies,
    isParityOk: discrepancies.length === 0,
  };
}
