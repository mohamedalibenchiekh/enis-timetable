import {
  areSessionsOverlapping,
  canonicalTeacherKey,
  doIntervalsOverlap,
  getRoomBloc,
  getSlotInterval,
  isGenericTeacher,
  normalizeText,
  parseCustomTime,
  resolveCanonicalRoom,
  SEEDED_ROOM_ALIASES,
} from './normalization.js';
import {
  Conflict,
  ConflictSessionRef,
  ConflictType,
  FreeRoomSuggestion,
  FreeSlotSuggestion,
  OccupancyCatalogs,
  SessionInfo,
} from './types.js';

export interface OccupancyState {
  sessions: SessionInfo[];
  programSessions: SessionInfo[];
  byDaySlotRoom: Map<string, SessionInfo[]>;
  byDaySlotTeacher: Map<string, SessionInfo[]>;
  byDayRoom: Map<string, SessionInfo[]>;
  byDayTeacher: Map<string, SessionInfo[]>;
  byDayProgramSlot: Map<string, SessionInfo[]>;
  knownRoomsCatalog: string[];
  knownRoomsSet: Set<string>;
}

export interface BuildOccupancyOptions {
  catalogs?: OccupancyCatalogs;
}

const DEFAULT_KNOWN_ROOMS = [
  'A 0-1', 'A 0-2', 'A 0-3', 'A 0-4', 'A 1-1', 'A 1-2', 'A 1-3', 'A 1-4', 'A 2-1', 'A 2-2', 'A 2-3', 'A 2-4',
  'B 0-1', 'B 0-2', 'B 0-3', 'B 0-4', 'B 1-1', 'B 1-2', 'B 1-3', 'B 1-4', 'B 2-1', 'B 2-2', 'B 2-3', 'B 2-4',
  'R 0-1', 'R 0-2', 'R 1-1', 'R 1-2', 'R 2-1', 'R 2-2',
  'Amphi',
  'PAQ/DGSE',
];

/**
 * Builds normalized session list and fast lookup indices from FET and Program sessions.
 */
export function buildOccupancyState(
  fetSessions: Array<{
    id?: string | number;
    day: number;
    slot: number;
    room?: string | null;
    teachers?: string[] | string;
    subject?: string;
    groups?: string;
    title?: string;
  }>,
  programSessions: Array<{
    id?: string | number;
    programId?: string;
    programCode?: string;
    day: number;
    slot: number;
    slotSpan?: number;
    daySpan?: number;
    title?: string;
    code?: string;
    teachers?: string[];
    room?: string | null;
    roomUnassigned?: boolean;
    locationNote?: string;
    customTime?: string | null;
    color?: string | null;
    tags?: string[];
    frequency?: string;
  }>,
  options: BuildOccupancyOptions = {},
): OccupancyState {
  const roomAliases = options.catalogs?.roomAliases ?? {};
  const teacherAliases = options.catalogs?.teacherAliases ?? {};

  // Build known rooms catalog
  const knownCatalogRaw = new Set<string>();
  for (const r of DEFAULT_KNOWN_ROOMS) knownCatalogRaw.add(r);
  for (const r of options.catalogs?.rooms ?? []) {
    const { canonicalRoom } = resolveCanonicalRoom(r, roomAliases);
    if (canonicalRoom) knownCatalogRaw.add(canonicalRoom);
  }
  for (const canonical of Object.values(SEEDED_ROOM_ALIASES)) {
    knownCatalogRaw.add(canonical);
  }

  const sessions: SessionInfo[] = [];

  // 1. Process FET sessions
  for (let idx = 0; idx < fetSessions.length; idx++) {
    const fet = fetSessions[idx];
    const teachersList: string[] = Array.isArray(fet.teachers)
      ? fet.teachers
      : typeof fet.teachers === 'string'
        ? fet.teachers.split(',').map((t) => t.trim()).filter(Boolean)
        : [];

    // Teachers with aligned key mapping
    const teacherMap: Array<{ name: string; key: string }> = [];
    for (const t of teachersList) {
      const k = canonicalTeacherKey(t, teacherAliases);
      if (k) {
        teacherMap.push({ name: t, key: k });
      }
    }
    const teacherKeys = teacherMap.map((tm) => tm.key);

    const { canonicalRoom } = resolveCanonicalRoom(fet.room, roomAliases);
    if (canonicalRoom) knownCatalogRaw.add(canonicalRoom);

    const title = fet.title || fet.subject || 'Séance FET';
    const sId = fet.id ?? `fet-${idx}`;
    const sess: SessionInfo = {
      id: sId,
      idStr: String(sId),
      source: 'fet',
      title,
      subject: fet.subject,
      groups: fet.groups,
      teachers: teachersList,
      teacherKeys,
      room: fet.room ?? null,
      canonicalRoom,
      normCanonicalRoom: canonicalRoom ? normalizeText(canonicalRoom) : '',
      normSubject: normalizeText(fet.subject || title),
      roomUnassigned: false,
      day: fet.day,
      slot: fet.slot,
      slotSpan: 1,
      daySpan: 1,
      ref: {
        id: sId,
        source: 'fet',
        title,
        room: fet.room ?? null,
        canonicalRoom,
        teachers: teachersList,
        day: fet.day,
        slot: fet.slot,
      },
    };
    sessions.push(sess);
  }

  // 2. Process Program sessions
  const programSessionsList: SessionInfo[] = [];
  for (let idx = 0; idx < programSessions.length; idx++) {
    const p = programSessions[idx];
    const teachersList = p.teachers ?? [];
    // Teachers with aligned key mapping
    const teacherMap: Array<{ name: string; key: string }> = [];
    for (const t of teachersList) {
      const k = canonicalTeacherKey(t, teacherAliases);
      if (k) {
        teacherMap.push({ name: t, key: k });
      }
    }
    const teacherKeys = teacherMap.map((tm) => tm.key);

    const { canonicalRoom, roomUnassigned } = resolveCanonicalRoom(p.room, roomAliases);
    const effectiveRoomUnassigned = Boolean(p.roomUnassigned || roomUnassigned);
    const title = p.title || p.code || 'Séance mastère';
    const sId = p.id ?? `prog-${idx}`;
    const progCode = p.programCode ?? 'MASTERE';
    const roomVal = effectiveRoomUnassigned ? null : (p.room ?? null);
    const canonRoomVal = effectiveRoomUnassigned ? null : canonicalRoom;

    const sess: SessionInfo = {
      id: sId,
      idStr: String(sId),
      programId: p.programId,
      programCode: progCode,
      source: progCode,
      title,
      code: p.code,
      teachers: teachersList,
      teacherKeys,
      room: roomVal,
      canonicalRoom: canonRoomVal,
      normCanonicalRoom: canonRoomVal ? normalizeText(canonRoomVal) : '',
      normSubject: normalizeText(p.code || title),
      roomUnassigned: effectiveRoomUnassigned,
      day: p.day,
      slot: p.slot,
      slotSpan: Math.max(1, p.slotSpan ?? 1),
      daySpan: Math.max(1, p.daySpan ?? 1),
      customTime: p.customTime ?? null,
      color: p.color ?? null,
      tags: p.tags ?? [],
      frequency: p.frequency ?? '',
      ref: {
        id: sId,
        programId: p.programId,
        programCode: progCode,
        source: progCode,
        title,
        room: roomVal,
        canonicalRoom: canonRoomVal,
        teachers: teachersList,
        day: p.day,
        slot: p.slot,
      },
    };
    sessions.push(sess);
    programSessionsList.push(sess);
  }

  const knownRoomsCatalog = [...knownCatalogRaw].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const knownRoomsSet = new Set(knownRoomsCatalog.map((r) => normalizeText(r)));

  // 3. Index sessions for fast collision detection
  const byDaySlotRoom = new Map<string, SessionInfo[]>();
  const byDaySlotTeacher = new Map<string, SessionInfo[]>();
  const byDayRoom = new Map<string, SessionInfo[]>();
  const byDayTeacher = new Map<string, SessionInfo[]>();
  const byDayProgramSlot = new Map<string, SessionInfo[]>();

  for (const s of sessions) {
    const dSpan = s.daySpan ?? 1;
    const sSpan = s.slotSpan ?? 1;

    // Index by day and room
    if (s.canonicalRoom && !s.roomUnassigned) {
      const roomNorm = s.normCanonicalRoom || normalizeText(s.canonicalRoom);
      for (let d = 0; d < dSpan; d++) {
        const curDay = s.day + d;
        const dayRoomKey = `${curDay}:${roomNorm}`;
        let drList = byDayRoom.get(dayRoomKey);
        if (!drList) {
          drList = [];
          byDayRoom.set(dayRoomKey, drList);
        }
        drList.push(s);

        // If session has customTime, it can overlap any slot touched by its interval
        let startSlot = s.slot;
        let endSlot = Math.min(5, s.slot + sSpan - 1);
        if (s.customTime) {
          const parsed = parseCustomTime(s.customTime);
          if (parsed) {
            startSlot = 0;
            endSlot = 5;
            for (let sl = 0; sl < 6; sl++) {
              const slotInt = getSlotInterval(curDay, sl, 1);
              if (doIntervalsOverlap(parsed, slotInt)) {
                const dsrKey = `${curDay}:${sl}:${roomNorm}`;
                let dsrList = byDaySlotRoom.get(dsrKey);
                if (!dsrList) {
                  dsrList = [];
                  byDaySlotRoom.set(dsrKey, dsrList);
                }
                dsrList.push(s);
              }
            }
          }
        } else {
          for (let sl = startSlot; sl <= endSlot; sl++) {
            const dsrKey = `${curDay}:${sl}:${roomNorm}`;
            let dsrList = byDaySlotRoom.get(dsrKey);
            if (!dsrList) {
              dsrList = [];
              byDaySlotRoom.set(dsrKey, dsrList);
            }
            dsrList.push(s);
          }
        }
      }
    }

    // Index by day and teacher
    for (const tKey of s.teacherKeys) {
      for (let d = 0; d < dSpan; d++) {
        const curDay = s.day + d;
        const dayTeacherKey = `${curDay}:${tKey}`;
        let dtList = byDayTeacher.get(dayTeacherKey);
        if (!dtList) {
          dtList = [];
          byDayTeacher.set(dayTeacherKey, dtList);
        }
        dtList.push(s);

        if (s.customTime) {
          const parsed = parseCustomTime(s.customTime);
          if (parsed) {
            for (let sl = 0; sl < 6; sl++) {
              const slotInt = getSlotInterval(curDay, sl, 1);
              if (doIntervalsOverlap(parsed, slotInt)) {
                const dstKey = `${curDay}:${sl}:${tKey}`;
                let dstList = byDaySlotTeacher.get(dstKey);
                if (!dstList) {
                  dstList = [];
                  byDaySlotTeacher.set(dstKey, dstList);
                }
                dstList.push(s);
              }
            }
          }
        } else {
          for (let sl = 0; sl < sSpan; sl++) {
            const curSlot = s.slot + sl;
            const dstKey = `${curDay}:${curSlot}:${tKey}`;
            let dstList = byDaySlotTeacher.get(dstKey);
            if (!dstList) {
              dstList = [];
              byDaySlotTeacher.set(dstKey, dstList);
            }
            dstList.push(s);
          }
        }
      }
    }

    // Index by day, slot, and program (for internal program overlap)
    if (s.source !== 'fet') {
      for (let d = 0; d < dSpan; d++) {
        for (let sl = 0; sl < sSpan; sl++) {
          const progKey = `${s.day + d}:${s.slot + sl}:${s.source}`;
          let progList = byDayProgramSlot.get(progKey);
          if (!progList) {
            progList = [];
            byDayProgramSlot.set(progKey, progList);
          }
          progList.push(s);
        }
      }
    }
  }

  return {
    sessions,
    programSessions: programSessionsList,
    byDaySlotRoom,
    byDaySlotTeacher,
    byDayRoom,
    byDayTeacher,
    byDayProgramSlot,
    knownRoomsCatalog,
    knownRoomsSet,
  };
}

/**
 * Checks if two overlapping sessions represent the exact same pedagogical activity
 * (e.g. combined groups sharing the same teacher and subject).
 */
function isSameActivity(a: SessionInfo, b: SessionInfo): boolean {
  if (a.id && b.id && a.id === b.id) return true;

  const aSubject = a.normSubject ?? normalizeText(a.subject || a.title);
  const bSubject = b.normSubject ?? normalizeText(b.subject || b.title);
  if (!aSubject || !bSubject || aSubject !== bSubject) return false;

  // Have at least one common teacher
  if (a.teacherKeys.length && b.teacherKeys.length) {
    const commonTeacher = a.teacherKeys.some((k) => b.teacherKeys.includes(k));
    if (commonTeacher) return true;
  }

  // Same room and same subject code
  if (
    a.canonicalRoom &&
    b.canonicalRoom &&
    a.canonicalRoom === b.canonicalRoom &&
    a.code &&
    b.code &&
    (a.code === b.code || normalizeText(a.code) === normalizeText(b.code))
  ) {
    return true;
  }

  return false;
}

function makeSessionRef(s: SessionInfo): ConflictSessionRef {
  if (s.ref) return s.ref;
  return {
    id: s.id,
    programId: s.programId,
    programCode: s.programCode,
    source: s.source,
    title: s.title,
    room: s.room,
    canonicalRoom: s.canonicalRoom,
    teachers: s.teachers,
    day: s.day,
    slot: s.slot,
  };
}

/**
 * Pure conflict detection engine.
 * Derives conflicts on demand, deterministic, O(n log n), < 100ms for 3000 sessions.
 */
export function detectConflicts(
  state: OccupancyState,
  options: { targetProgramCode?: string; targetProgramId?: string } = {},
): Conflict[] {
  const buckets: Conflict[][] = Array.from({ length: 36 }, () => []);
  const addConflict = (c: Conflict) => {
    const bIdx = Math.max(0, Math.min(35, c.day * 6 + c.slot));
    buckets[bIdx].push(c);
  };
  const processedRoomPairs = new Set<string>();
  const processedTeacherPairs = new Set<string>();

  // 1. Check room double bookings using byDaySlotRoom
  for (const [dsrKey, sessionsInSlot] of state.byDaySlotRoom.entries()) {
    if (sessionsInSlot.length < 2) continue;
    const [dayStr, slotStr, roomNorm] = dsrKey.split(':');
    const curConflictDay = parseInt(dayStr, 10);
    const curConflictSlot = parseInt(slotStr, 10);

    for (let i = 0; i < sessionsInSlot.length; i++) {
      for (let j = i + 1; j < sessionsInSlot.length; j++) {
        const s1 = sessionsInSlot[i];
        const s2 = sessionsInSlot[j];

        if (s1.id === s2.id || s1.roomUnassigned || s2.roomUnassigned) continue;

        const id1 = s1.idStr ?? String(s1.id ?? i);
        const id2 = s2.idStr ?? String(s2.id ?? j);
        const hasSpans = (s1.slotSpan ?? 1) > 1 || (s2.slotSpan ?? 1) > 1 || (s1.daySpan ?? 1) > 1 || (s2.daySpan ?? 1) > 1;
        const pairKey = hasSpans ? `${curConflictDay}:${curConflictSlot}:${id1 < id2 ? `${id1}:${id2}` : `${id2}:${id1}`}` : (id1 < id2 ? `${id1}:${id2}` : `${id2}:${id1}`);

        if (hasSpans) {
          if (processedRoomPairs.has(pairKey)) continue;
        }

        // Check time overlap
        if (s1.customTime || s2.customTime) {
          if (
            !areSessionsOverlapping(
              curConflictDay,
              s1.slot,
              s1.slotSpan ?? 1,
              s1.customTime,
              curConflictDay,
              s2.slot,
              s2.slotSpan ?? 1,
              s2.customTime,
            )
          ) {
            continue;
          }
        }

        if (isSameActivity(s1, s2)) continue;

        if (hasSpans) processedRoomPairs.add(pairKey);
        const roomDisplayName = s1.canonicalRoom ?? s2.canonicalRoom ?? roomNorm;

        // Order sessions symmetrically by id or title
        const [first, second] = id1 < id2 ? [s1, s2] : [s2, s1];

        addConflict({
          id: `room-double-${pairKey}`,
          type: 'room_double_booked',
          severity: 'error',
          day: curConflictDay,
          slot: curConflictSlot,
          resource: roomDisplayName,
          message: `La salle ${roomDisplayName} est réservée simultanément par « ${first.title} » (${first.source}) et « ${second.title} » (${second.source}).`,
          sessions: [first.ref ?? makeSessionRef(first), second.ref ?? makeSessionRef(second)],
        });
      }
    }
  }

  // 2. Check teacher double bookings using byDaySlotTeacher
  for (const [dstKey, sessionsForTeacher] of state.byDaySlotTeacher.entries()) {
    if (sessionsForTeacher.length < 2) continue;
    const [dayStr, slotStr, teacherKey] = dstKey.split(':');
    const curConflictDay = parseInt(dayStr, 10);
    const curConflictSlot = parseInt(slotStr, 10);

    for (let i = 0; i < sessionsForTeacher.length; i++) {
      for (let j = i + 1; j < sessionsForTeacher.length; j++) {
        const s1 = sessionsForTeacher[i];
        const s2 = sessionsForTeacher[j];

        if (s1.id === s2.id) continue;

        const id1 = s1.idStr ?? String(s1.id ?? i);
        const id2 = s2.idStr ?? String(s2.id ?? j);
        const hasSpans = (s1.slotSpan ?? 1) > 1 || (s2.slotSpan ?? 1) > 1 || (s1.daySpan ?? 1) > 1 || (s2.daySpan ?? 1) > 1;
        const pairKey = hasSpans ? `${curConflictDay}:${curConflictSlot}:${teacherKey}:${id1 < id2 ? `${id1}:${id2}` : `${id2}:${id1}`}` : `${teacherKey}:${id1 < id2 ? `${id1}:${id2}` : `${id2}:${id1}`}`;

        if (hasSpans) {
          if (processedTeacherPairs.has(pairKey)) continue;
        }

        if (s1.customTime || s2.customTime) {
          if (
            !areSessionsOverlapping(
              curConflictDay,
              s1.slot,
              s1.slotSpan ?? 1,
              s1.customTime,
              curConflictDay,
              s2.slot,
              s2.slotSpan ?? 1,
              s2.customTime,
            )
          ) {
            continue;
          }
        }

        if (isSameActivity(s1, s2) || (s1.canonicalRoom && s1.canonicalRoom === s2.canonicalRoom)) {
          continue;
        }

        if (hasSpans) processedTeacherPairs.add(pairKey);
        const tIdx1 = s1.teacherKeys.indexOf(teacherKey);
        const teacherName =
          tIdx1 !== -1
            ? s1.teachers[tIdx1]
            : (s2.teachers[s2.teacherKeys.indexOf(teacherKey)] ?? teacherKey);

        const [first, second] = id1 < id2 ? [s1, s2] : [s2, s1];

        addConflict({
          id: `teacher-double-${pairKey}`,
          type: 'teacher_double_booked',
          severity: 'error',
          day: curConflictDay,
          slot: curConflictSlot,
          resource: teacherName,
          message: `L'enseignant(e) ${teacherName} est programmé(e) simultanément sur « ${first.title} » (${first.source}) et « ${second.title} » (${second.source}).`,
          sessions: [first.ref ?? makeSessionRef(first), second.ref ?? makeSessionRef(second)],
        });
      }
    }
  }

  // 3. Program-specific checks: room_missing, room_to_find, room_unknown
  const progs = state.programSessions ?? state.sessions;
  for (const s of progs) {
    if (s.source === 'fet') continue; // Only report to-dos and warnings for editable master programs

    // Filter by program if requested
    if (options.targetProgramCode && s.source !== options.targetProgramCode) continue;
    if (options.targetProgramId && s.programId && s.programId !== options.targetProgramId) continue;

    // Room to find: Salle XX placeholder
    if (s.roomUnassigned) {
      addConflict({
        id: `room-to-find-${s.id}`,
        type: 'room_to_find',
        severity: 'info',
        day: s.day,
        slot: s.slot,
        resource: 'Salle à rechercher',
        message: `Salle à rechercher pour la séance « ${s.title} » (${s.source}).`,
        sessions: [makeSessionRef(s)],
      });
      continue;
    }

    // Room missing: neither a room nor marked unassigned
    if (!s.room || !s.room.trim()) {
      addConflict({
        id: `room-missing-${s.id}`,
        type: 'room_missing',
        severity: 'warning',
        day: s.day,
        slot: s.slot,
        resource: '',
        message: `Aucune salle affectée pour la séance « ${s.title} » (${s.source}).`,
        sessions: [makeSessionRef(s)],
      });
      continue;
    }

    // Room unknown: not in FET and not a seeded alias (e.g. EH5)
    if (s.canonicalRoom) {
      const norm = s.normCanonicalRoom || normalizeText(s.canonicalRoom);
      const isSeeded = Boolean(SEEDED_ROOM_ALIASES[norm]);
      if (!isSeeded && !state.knownRoomsSet.has(norm)) {
        addConflict({
          id: `room-unknown-${s.id}`,
          type: 'room_unknown',
          severity: 'info',
          day: s.day,
          slot: s.slot,
          resource: s.room,
          message: `Salle hors FET « ${s.room} » pour la séance « ${s.title} » (${s.source}).`,
          sessions: [makeSessionRef(s)],
        });
      }
    }
  }

  // Deterministic sorting per bucket, then flatten
  const typeRank: Record<ConflictType, number> = {
    room_double_booked: 0,
    teacher_double_booked: 1,
    room_missing: 2,
    room_to_find: 3,
    room_unknown: 4,
  };

  const conflicts: Conflict[] = [];
  for (let b = 0; b < 36; b++) {
    const list = buckets[b];
    if (list.length > 1) {
      list.sort((a, b) => {
        const aSev = a.severity === 'error' ? 0 : a.severity === 'warning' ? 1 : 2;
        const bSev = b.severity === 'error' ? 0 : b.severity === 'warning' ? 1 : 2;
        if (aSev !== bSev) return aSev - bSev;
        const typeDiff = typeRank[a.type] - typeRank[b.type];
        if (typeDiff !== 0) return typeDiff;
        if (a.resource !== b.resource) return a.resource < b.resource ? -1 : 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
    }
    for (let i = 0; i < list.length; i++) conflicts.push(list[i]);
  }

  return conflicts;
}

/**
 * Finds all free rooms for a given day and slot across all sources.
 * A room is free if NO session occupies it during that slot (accounting for spans and custom times).
 * Ranked: rooms of the same target bloc first, then Bloc A, B, R, Amphi, PAQ/DGSE, Autre.
 */
export function findFreeRooms(
  day: number,
  slot: number,
  state: OccupancyState,
  options: {
    slotSpan?: number;
    daySpan?: number;
    customTime?: string | null;
    targetBloc?: string;
    excludeSessionId?: string | number;
  } = {},
): FreeRoomSuggestion[] {
  const span = Math.max(1, options.slotSpan ?? 1);
  const dSpan = Math.max(1, options.daySpan ?? 1);
  const freeRooms: FreeRoomSuggestion[] = [];

  const blocPriority: Record<string, number> = {
    'Bloc A': 10,
    'Bloc B': 20,
    'Bloc R': 30,
    Amphi: 40,
    'PAQ/DGSE': 50,
    Autre: 60,
  };

  for (const room of state.knownRoomsCatalog) {
    const roomNorm = normalizeText(room);
    let isOccupied = false;

    for (let d = 0; d < dSpan; d++) {
      const curDay = day + d;
      const occupiedSessions = state.byDayRoom.get(`${curDay}:${roomNorm}`) ?? [];

      const dayOccupied = occupiedSessions.some((s) => {
        if (options.excludeSessionId !== undefined && s.id === options.excludeSessionId) return false;
        return areSessionsOverlapping(
          curDay,
          slot,
          span,
          options.customTime,
          s.day,
          s.slot,
          s.slotSpan ?? 1,
          s.customTime,
        );
      });

      if (dayOccupied) {
        isOccupied = true;
        break;
      }
    }

    if (!isOccupied) {
      const bloc = getRoomBloc(room);
      const isSameBloc = Boolean(options.targetBloc && bloc === options.targetBloc);
      let score = blocPriority[bloc] ?? 99;
      if (isSameBloc) {
        score -= 100; // Prefer target bloc heavily
      }
      freeRooms.push({
        room,
        bloc,
        isSameBloc,
        isKnown: true,
        score,
      });
    }
  }

  freeRooms.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.room.localeCompare(b.room, 'fr');
  });

  return freeRooms;
}

/**
 * Finds all free slots for a given session where its teachers and room (if assigned)
 * are free, ranked by closeness to the current position.
 */
export function findFreeSlots(
  session: SessionInfo,
  state: OccupancyState,
  options: { targetBloc?: string } = {},
): FreeSlotSuggestion[] {
  const slotSpan = Math.max(1, session.slotSpan ?? 1);
  const daySpan = Math.max(1, session.daySpan ?? 1);
  const freeSlots: FreeSlotSuggestion[] = [];

  for (let d = 0; d <= 6 - daySpan; d++) {
    for (let s = 0; s <= 6 - slotSpan; s++) {
      // 1. Check if the session's program already has another session at (d, s)
    const dayName = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][d] ?? `Jour ${d + 1}`;
    const slotLabels = ['08:30-10:00', '10:15-11:45', '12:00-13:00', '13:00-14:30', '14:45-16:15', '16:30-18:00'];
    const slotLabel = slotLabels[s] ?? `Créneau ${s + 1}`;
      let programBusy = false;
      if (session.source !== 'fet') {
        for (let dayOffset = 0; dayOffset < daySpan; dayOffset++) {
          for (let slotOffset = 0; slotOffset < slotSpan; slotOffset++) {
            const checkDay = d + dayOffset;
            const checkSlot = s + slotOffset;
            const progSessions = state.byDayProgramSlot.get(`${checkDay}:${checkSlot}:${session.source}`) ?? [];
            if (progSessions.some((ps) => ps.id !== session.id)) {
              programBusy = true;
              break;
            }
          }
          if (programBusy) break;
        }
      }
      if (programBusy) continue;

      // 2. Check room availability (if assigned)
      if (session.canonicalRoom && !session.roomUnassigned) {
        const roomNorm = normalizeText(session.canonicalRoom);
        const occupied = state.byDayRoom.get(`${d}:${roomNorm}`) ?? [];
        const roomBusy = occupied.some((occ) => {
          if (occ.id === session.id) return false;
          return areSessionsOverlapping(
            d,
            s,
            slotSpan,
            session.customTime,
            occ.day,
            occ.slot,
            occ.slotSpan ?? 1,
            occ.customTime,
          );
        });
        if (roomBusy) continue;
      }

      // 3. Check teachers availability
      let teacherBusy = false;
      for (const tKey of session.teacherKeys) {
        const occupied = state.byDayTeacher.get(`${d}:${tKey}`) ?? [];
        teacherBusy = occupied.some((occ) => {
          if (occ.id === session.id) return false;
          return areSessionsOverlapping(
            d,
            s,
            slotSpan,
            session.customTime,
            occ.day,
            occ.slot,
            occ.slotSpan ?? 1,
            occ.customTime,
          );
        });
        if (teacherBusy) break;
      }
      if (teacherBusy) continue;

      // Distance score: closer to current position is better
      const distance = Math.abs(d - session.day) * 10 + Math.abs(s - session.slot);
      freeSlots.push({
        day: d,
        slot: s,
        dayName,
        slotLabel,
        score: distance,
      });
    }
  }

  freeSlots.sort((a, b) => a.score - b.score);
  return freeSlots;
}

/**
 * Finds the best free room for a session, used first for sessions marked "Salle XX".
 * Never returns a busy room!
 */
export function findBestRoom(
  session: SessionInfo,
  state: OccupancyState,
  options: { targetBloc?: string } = {},
): string | null {
  const preferredBloc =
    options.targetBloc ??
    (session.canonicalRoom ? getRoomBloc(session.canonicalRoom) : undefined);

  const freeRooms = findFreeRooms(session.day, session.slot, state, {
    slotSpan: session.slotSpan,
    customTime: session.customTime,
    targetBloc: preferredBloc,
    excludeSessionId: session.id,
  });

  return freeRooms[0]?.room ?? null;
}
