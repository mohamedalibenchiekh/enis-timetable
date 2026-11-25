import { TimeInterval } from './types.js';

export const SEEDED_ROOM_ALIASES: Record<string, string> = {
  'salle paq': 'PAQ/DGSE',
  paq: 'PAQ/DGSE',
  'salle dgse': 'PAQ/DGSE',
  dgse: 'PAQ/DGSE',
};

const PLACEHOLDER_RE = /^(?:salle\s+)?(?:xx|\?\?|à\s+rechercher|a\s+rechercher)$/iu;

const GENERIC_TEACHER_RE = /^(?:externes?|internes?|externes?\s*\+\s*internes?|intervenants?|vacataires?|-|x|\?+|non\s+pr[ée]cis[ée]|a\s+pr[ée]ciser)$/iu;

const textNormCache = new Map<string, string>();

export function normalizeText(value: string): string {
  if (!value) return '';
  const cached = textNormCache.get(value);
  if (cached !== undefined) return cached;

  let res: string;
  if (!/[^\x00-\x7F]/.test(value)) {
    res = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  } else {
    res = value
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  if (textNormCache.size < 50000) {
    textNormCache.set(value, res);
  }
  return res;
}

export function isRoomUnassignedPlaceholder(room: string | null | undefined): boolean {
  if (!room) return false;
  return PLACEHOLDER_RE.test(room.trim());
}

export function isGenericTeacher(name: string | null | undefined): boolean {
  if (!name) return true;
  return GENERIC_TEACHER_RE.test(name.trim());
}

/** Standard room label formatting: "A02" → "A 0-2", "B12" → "B 1-2", "Amphi" → "Amphi" */
export function formatStandardRoomLabel(room: string): string {
  const clean = room.replace(/\s*\(.*\)\s*$/u, '').trim();
  const match = clean.match(/^([A-Za-z])(\d)(\d)$/u);
  if (match) return `${match[1].toUpperCase()} ${match[2]}-${match[3]}`;
  return clean;
}

const roomCache = new Map<string, { canonicalRoom: string | null; roomUnassigned: boolean }>();

/**
 * Resolves a room string to its canonical name after applying aliases and standard formatting.
 * "Salle XX" is resolved as roomUnassigned = true, canonicalRoom = null.
 */
export function resolveCanonicalRoom(
  room: string | null | undefined,
  roomAliases: Record<string, string> = {},
): { canonicalRoom: string | null; roomUnassigned: boolean } {
  if (!room) return { canonicalRoom: null, roomUnassigned: false };
  const trimmed = room.trim();
  const hasCustomAliases = Object.keys(roomAliases).length > 0;
  let cacheKey: string | undefined;
  if (!hasCustomAliases) {
    const cached = roomCache.get(trimmed);
    if (cached) return cached;
    cacheKey = trimmed;
  }

  // Normalize custom room aliases so keys match normalizeText (stripping punctuation etc.)
  const normalizedCustomAliases: Record<string, string> = Object.create(null);
  if (hasCustomAliases) {
    for (const [k, v] of Object.entries(roomAliases)) {
      if (Object.prototype.hasOwnProperty.call(roomAliases, k)) {
        normalizedCustomAliases[normalizeText(k)] = v;
      }
    }
  }

  let result: { canonicalRoom: string | null; roomUnassigned: boolean };

  if (isRoomUnassignedPlaceholder(trimmed)) {
    result = { canonicalRoom: null, roomUnassigned: true };
  } else {
    const norm = normalizeText(trimmed);
    const aliasMatch = (Object.prototype.hasOwnProperty.call(normalizedCustomAliases, norm) && normalizedCustomAliases[norm]) ||
      (Object.prototype.hasOwnProperty.call(SEEDED_ROOM_ALIASES, norm) && SEEDED_ROOM_ALIASES[norm]);

    // Direct alias match or match without "salle "
    if (aliasMatch) {
      result = { canonicalRoom: aliasMatch, roomUnassigned: false };
    } else {
      const strippedNorm = norm.startsWith('salle ') ? norm.slice(6) : norm;
      const strippedAlias = (Object.prototype.hasOwnProperty.call(normalizedCustomAliases, strippedNorm) && normalizedCustomAliases[strippedNorm]) ||
        (Object.prototype.hasOwnProperty.call(SEEDED_ROOM_ALIASES, strippedNorm) && SEEDED_ROOM_ALIASES[strippedNorm]);
      if (strippedAlias) {
        result = { canonicalRoom: strippedAlias, roomUnassigned: false };
      } else {
        // Standard room label
        const formatted = formatStandardRoomLabel(trimmed.replace(/^salle\s+/iu, ''));
        const formattedNorm = normalizeText(formatted);
        const formattedAlias = (Object.prototype.hasOwnProperty.call(normalizedCustomAliases, formattedNorm) && normalizedCustomAliases[formattedNorm]) ||
          (Object.prototype.hasOwnProperty.call(SEEDED_ROOM_ALIASES, formattedNorm) && SEEDED_ROOM_ALIASES[formattedNorm]);
        if (formattedAlias) {
          result = { canonicalRoom: formattedAlias, roomUnassigned: false };
        } else {
          result = { canonicalRoom: formatted, roomUnassigned: false };
        }
      }
    }
  }

  if (cacheKey && roomCache.size < 10000) {
    roomCache.set(cacheKey, result);
  }
  return result;
}

const teacherCache = new Map<string, string | null>();

/**
 * Two names containing the exact same set of normalized tokens are the same teacher.
 * Sorts tokens alphabetically so "Noeman Ammar" and "AMMAR Noeman" resolve to "ammar noeman".
 */
export function canonicalTeacherKey(
  teacher: string,
  teacherAliases: Record<string, string> = {},
): string | null {
  if (isGenericTeacher(teacher)) return null;
  const hasAliases = Object.keys(teacherAliases).length > 0;
  let cacheKey: string | undefined;
  if (!hasAliases) {
    const cached = teacherCache.get(teacher);
    if (cached !== undefined) return cached;
    cacheKey = teacher;
  }

  const norm = normalizeText(teacher);
  const resolved = (hasAliases && Object.prototype.hasOwnProperty.call(teacherAliases, norm) && teacherAliases[norm]) || teacher;
  if (isGenericTeacher(resolved)) {
    if (cacheKey) teacherCache.set(cacheKey, null);
    return null;
  }

  const words = normalizeText(resolved).split(' ').filter(Boolean);
  if (!words.length) {
    if (cacheKey) teacherCache.set(cacheKey, null);
    return null;
  }
  const result = [...new Set(words)].sort().join(' ');
  if (cacheKey && teacherCache.size < 5000) {
    teacherCache.set(cacheKey, result);
  }
  return result;
}

export function parseCustomTime(timeStr: string | null | undefined): TimeInterval | null {
  if (!timeStr) return null;
  const match = timeStr.match(/(\d{1,2})\s*[h:]\s*(\d{2})\s*[-–]\s*(\d{1,2})\s*[h:]\s*(\d{2})/iu);
  if (!match) return null;
  const startH = parseInt(match[1], 10);
  const startM = parseInt(match[2], 10);
  const endH = parseInt(match[3], 10);
  const endM = parseInt(match[4], 10);
  if (startH > 23 || endH > 23 || startM > 59 || endM > 59) return null;
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;
  if (start >= end) return null;
  return { start, end };
}

/**
 * Reference slot intervals in minutes from midnight.
 * Row indices:
 * 0: 08:30 - 10:00 (510 - 600)
 * 1: 10:15 - 11:45 (615 - 705)
 * 2: 12:00 - 13:00 (Friday: 12:00 - 14:00 Pause) (720 - 780 / Friday 720 - 840)
 * 3: 13:00 - 14:30 (Friday: 14:00 - 15:30) (780 - 870 / Friday 840 - 930)
 * 4: 14:45 - 16:15 (Friday: 15:45 - 17:15) (885 - 975 / Friday 945 - 1035)
 * 5: 16:30 - 18:00 (Friday: 17:30 - 19:00) (990 - 1080 / Friday 1050 - 1140)
 */
export function getSlotInterval(day: number, slot: number, slotSpan = 1): TimeInterval {
  const isFriday = day === 4;
  const baseSlots: [number, number][] = isFriday
    ? [
        [510, 600],
        [615, 705],
        [720, 840],
        [840, 930],
        [945, 1035],
        [1050, 1140],
      ]
    : [
        [510, 600],
        [615, 705],
        [720, 780],
        [780, 870],
        [885, 975],
        [990, 1080],
      ];

  const clampedStartSlot = Math.max(0, Math.min(5, slot));
  const clampedEndSlot = Math.max(0, Math.min(5, slot + Math.max(1, slotSpan) - 1));

  const start = baseSlots[clampedStartSlot][0];
  const end = baseSlots[clampedEndSlot][1];
  return { start, end };
}

export function doIntervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function areSessionsOverlapping(
  dayA: number,
  slotA: number,
  slotSpanA: number,
  customTimeA: string | null | undefined,
  dayB: number,
  slotB: number,
  slotSpanB: number,
  customTimeB: string | null | undefined,
): boolean {
  if (dayA !== dayB) return false;
  if (customTimeA || customTimeB) {
    const intervalA = parseCustomTime(customTimeA) ?? getSlotInterval(dayA, slotA, slotSpanA);
    const intervalB = parseCustomTime(customTimeB) ?? getSlotInterval(dayB, slotB, slotSpanB);
    return doIntervalsOverlap(intervalA, intervalB);
  }
  // Standard slot index overlap
  return slotA < slotB + slotSpanB && slotB < slotA + slotSpanA;
}

export function getRoomBloc(room: string): string {
  if (!room) return 'Autre';
  const norm = room.trim().toUpperCase();
  if (norm.startsWith('A ') || norm.startsWith('A-') || /^A\d/i.test(norm)) return 'Bloc A';
  if (norm.startsWith('B ') || norm.startsWith('B-') || /^B\d/i.test(norm)) return 'Bloc B';
  if (norm.startsWith('R ') || norm.startsWith('R-') || /^R\d/i.test(norm)) return 'Bloc R';
  if (norm.includes('AMPHI')) return 'Amphi';
  if (norm.includes('PAQ') || norm.includes('DGSE')) return 'PAQ/DGSE';
  return 'Autre';
}
