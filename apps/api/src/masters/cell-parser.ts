import { CellCatalogs, ProgramSession, StyleHints } from './types.js';

const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
const words = (value: string) => normalize(value).split(' ').filter(Boolean);
const setKey = (value: string) => [...new Set(words(value))].sort().join(' ');
const roomAliasDefaults: Record<string, string> = { 'salle paq': 'PAQ/DGSE', paq: 'PAQ/DGSE', 'salle dgse': 'PAQ/DGSE', dgse: 'PAQ/DGSE' };
/** Fuzzy scores below this value are not offered as teacher candidates; every offered fuzzy candidate still needs confirmation. */
export const FUZZY_TEACHER_CONFIRMATION_THRESHOLD = 0.55;
const placeholder = /^(?:(?:salle)\s*)?(?:xx|\?\?|à\s+rechercher|a\s+rechercher)$/iu;
const frequencyPattern = /\(\s*\d+\s*\/\s*\d+\s*\)/u;
const customTimePattern = /\b\d{1,2}\s*[h:]\s*\d{2}\s*[-–]\s*\d{1,2}\s*[h:]\s*\d{2}\b/iu;

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = old;
    }
  }
  return row[b.length];
}

export interface ParsedCell extends Omit<ProgramSession, 'day' | 'slot' | 'slotSpan' | 'daySpan' | 'source'> {
  teacherCandidates: { name: string; score: number }[];
  roomCandidates: { name: string; score: number }[];
  empty: boolean;
}

export function parseProgramCell(rawText: string, styles: StyleHints[] = [], catalogs: CellCatalogs = {}): ParsedCell {
  const raw = rawText.trim();
  const lines = raw.split(/\r?\n|\s*\/\/\s*/u).map((s) => s.trim()).filter(Boolean);
  const base = { title: '', code: '', teachers: [] as string[], teacherKeys: [] as string[], room: null as string | null, roomUnassigned: false, locationNote: '', frequency: '', tags: [] as string[], customTime: null as string | null, color: styles.map((s) => s.fill).find(Boolean) ?? null, note: '', rawText, confidence: 1, reasons: [] as string[], teacherCandidates: [] as { name: string; score: number }[], roomCandidates: [] as { name: string; score: number }[], empty: !raw || /^(-X-|---)$/iu.test(raw) };
  if (base.empty) return base;

  let remaining = raw;
  const frequency = remaining.match(frequencyPattern);
  if (frequency) { base.frequency = frequency[0].replace(/\s+/gu, ''); remaining = remaining.replace(frequency[0], ' '); }
  const customTime = remaining.match(customTimePattern);
  if (customTime) { base.customTime = customTime[0].replace(/\s+/gu, ''); remaining = remaining.replace(customTime[0], ' '); }
  if (/devoir\s+surveill[ée]/iu.test(remaining)) { base.tags.push('DS'); remaining = remaining.replace(/devoir\s+surveill[ée]/iu, ' '); }
  const periods = remaining.match(/\(\s*p[ée]riode\s*\d+\s*\)/giu) ?? [];
  base.tags.push(...periods.map((tag) => tag.replace(/\s+/gu, '')));
  for (const tag of periods) remaining = remaining.replace(tag, ' ');

  const rawLines = remaining.split(/\r?\n|\s*\/\/\s*/u).map((s) => s.trim()).filter(Boolean);
  const roomMap = new Map<string, string>();
  for (const room of catalogs.rooms ?? []) roomMap.set(normalize(room), room);
  for (const [alias, canonical] of Object.entries({ ...roomAliasDefaults, ...catalogs.roomAliases })) roomMap.set(normalize(alias), canonical);
  const roomMatch = rawLines.map((line, index) => ({ line, index, norm: normalize(line) })).reverse().find(({ line, norm }) => {
    if (placeholder.test(line)) return true;
    return roomMap.has(norm) || /^(?:salle\s+)?(?:[a-z]{1,4}\s*)?\d{1,3}[a-z]?$/iu.test(line) || /^hall\s+/iu.test(line) || /^salle\s+/iu.test(line);
  });
  if (roomMatch) {
    if (placeholder.test(roomMatch.line)) { base.roomUnassigned = true; base.locationNote = 'salle à rechercher'; }
    else {
      base.room = roomMap.get(roomMatch.norm) ?? roomMatch.line.replace(/^salle\s+/iu, '').trim();
      if (!roomMap.has(roomMatch.norm) && !(catalogs.rooms ?? []).some((r) => normalize(r) === roomMatch.norm)) base.reasons.push('Salle hors FET');
    }
    rawLines.splice(roomMatch.index, 1);
  }

  for (const line of [...rawLines]) {
    const location = line.match(/^\(([^)]*(?:novation|site|campus|bâtiment|batiment)[^)]*)\)$/iu);
    if (location) { base.locationNote = location[1]; rawLines.splice(rawLines.indexOf(line), 1); }
  }
  const codeMatch = remaining.match(/\b((?:TU|BM|TP)\s*[A-Z0-9.]+)\s*:/iu);
  if (codeMatch) { base.code = codeMatch[1].replace(/\s+/gu, ' ').trim(); }

  const teacherCatalog = catalogs.teachers ?? [];
  const aliases = catalogs.teacherAliases ?? {};
  const teacherLines: string[] = [];
  for (let i = rawLines.length - 1; i >= 0; i--) {
    const line = rawLines[i];
    const style = styles[i] ?? {};
    const tokens = line.split(/\s+/u).filter(Boolean);
    const gluedTeacher = teacherCatalog.find((name) => {
      const count = words(name).length;
      return tokens.length > count && setKey(tokens.slice(-count).join(' ')) === setKey(name);
    });
    if (gluedTeacher) {
      const prefix = tokens.slice(0, -words(gluedTeacher).length).join(' ').trim();
      teacherLines.unshift(gluedTeacher);
      if (prefix) rawLines[i] = prefix;
      else rawLines.splice(i, 1);
      continue;
    }
    const alias = aliases[normalize(line)];
    const exact = teacherCatalog.find((name) => setKey(name) === setKey(line));
    const fuzzyPossible = teacherCatalog.some((name) => {
      const score = 1 - distance(normalize(name), normalize(line)) / Math.max(normalize(name).length, normalize(line).length, 1);
      return score >= FUZZY_TEACHER_CONFIRMATION_THRESHOLD;
    });
    const teacherish = style.bold || Boolean(alias || exact || fuzzyPossible) || /^externes?\s*\+\s*internes?$/iu.test(line);
    if (teacherish) { teacherLines.unshift(alias ?? exact ?? line); rawLines.splice(i, 1); continue; }
    if (!teacherCatalog.length && i === rawLines.length - 1 && /^(?:\p{Lu}[\p{Ll}'’.-]+)\s+(?:\p{Lu}[\p{Ll}'’.-]+|\p{Lu}{2,})$/u.test(line)) {
      teacherLines.unshift(line); rawLines.splice(i, 1);
    }
  }
  base.teachers = [...new Set(teacherLines)];
  base.teacherKeys = base.teachers.map((teacher) => setKey(teacher));
  for (const teacher of base.teachers) {
    if (teacherCatalog.length && !teacherCatalog.some((candidate) => setKey(candidate) === setKey(teacher)) && !aliases[normalize(teacher)]) {
      const suggestions = teacherCatalog.map((name) => ({ name, score: 1 - distance(normalize(name), normalize(teacher)) / Math.max(normalize(name).length, normalize(teacher).length, 1) }))
        .filter((item) => item.score >= FUZZY_TEACHER_CONFIRMATION_THRESHOLD).sort((a, b) => b.score - a.score).slice(0, 4);
      base.teacherCandidates.push(...suggestions);
      if (suggestions.length) { base.confidence = Math.min(base.confidence, 0.65); base.reasons.push('Nom d’enseignant à confirmer'); }
    }
  }
  const subject = rawLines.join(' ').replace(/\s+/gu, ' ').trim();
  base.title = subject.replace(/\b((?:TU|BM|TP)\s*[A-Z0-9.]+)\s*:\s*/iu, '').trim();
  if (!base.title && !base.teachers.length && !base.room && !base.roomUnassigned) { base.title = remaining.trim(); base.confidence = 0.55; base.reasons.push('Contenu non classé'); }
  const fill = styles.map((s) => s.fill).find(Boolean);
  if (fill) base.color = fill.replace(/^#/u, '').toUpperCase();
  return base;
}

export function expandToSlots(session: Pick<ProgramSession, 'day' | 'slot' | 'slotSpan' | 'daySpan'>): { day: number; slot: number }[] {
  const out: { day: number; slot: number }[] = [];
  for (let d = 0; d < Math.max(1, session.daySpan); d++) for (let s = 0; s < Math.max(1, session.slotSpan); s++) out.push({ day: session.day + d, slot: session.slot + s });
  return out;
}

