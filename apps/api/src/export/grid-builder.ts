import { ParsedSession, SlotLabel } from '../parser/types.js';
import { clean } from '../parser/html-parser.js';
import { ExportOptions } from './options.js';
import { createNameResolver, NameResolver } from './name-resolver.js';
import { formatTeacher, roomLabel } from './formatters.js';
import { CellFields, isLegacyTemplate, joinGroups, renderTemplate, subjectDisplay } from './template.js';

export { formatTeacher, roomLabel } from './formatters.js';

export interface TimetableMeta {
  days: string[];
  slots: SlotLabel[];
  rooms: string[];
}

/** One rendered session inside a cell: the template lines for that session. */
export interface CellSession {
  lines: string[];
}

export interface RoomRow {
  room: string;
  label: string;
  /** One entry per slot column; plain-text projection of the cell ('' when free). */
  cells: string[];
  /**
   * Rich per-session cell content — present only when the profile uses a
   * non-default cell template. `details[slot]` lists the rendered sessions.
   */
  details?: CellSession[][];
}

export interface BlocGrid {
  title: string;
  rows: RoomRow[];
  /** 1-based page number — present only when the profile assigns blocs to pages. */
  page?: number;
}

/** A group of blocs printed on the same Word page (indices into `blocs`). */
export interface DayPage {
  page: number;
  blocs: number[];
}

export interface UnassignedGridSession {
  slot: number;
  slotSpan: number;
  programCode: string;
  title: string;
  teachers: string;
}

export interface MasterGridSession {
  id?: string;
  programCode: string;
  day: number;
  slot: number;
  slotSpan?: number;
  daySpan?: number;
  title: string;
  code?: string;
  teachers: string[];
  room: string | null;
  canonicalRoom?: string | null;
  roomUnassigned?: boolean;
  customTime?: string | null;
  frequency?: string;
}

export interface DayGrid {
  day: number;
  dayName: string;
  /** Header of each slot column (lines). */
  headers: string[][];
  blocs: BlocGrid[];
  sessionCount: number;
  /** Page groups — present only when more than one page is configured. */
  pages?: DayPage[];
  /** Sessions with no assigned room to be printed in the final section. */
  unassignedSessions?: UnassignedGridSession[];
}

const naturalCmp = (a: string, b: string) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });

type GridSession = Pick<ParsedSession, 'day' | 'slot' | 'room' | 'teachers' | 'groups' | 'subjectCode' | 'subject' | 'frequency'>;

/** Builds the {teacher} token: formatted names joined " / ", each with the frequency suffix. */
function teacherText(s: GridSession, options: ExportOptions, resolver: NameResolver): string {
  const names = s.teachers
    .split(',')
    .map((t) => resolver.teacher(t, options.abbreviateBen))
    .filter(Boolean);
  return names
    .map((name) => (options.showFrequency && s.frequency ? `${name} ${s.frequency}` : name))
    .join(' / ');
}

function cellFields(s: GridSession, options: ExportOptions, resolver: NameResolver): CellFields {
  return {
    teacher: teacherText(s, options, resolver),
    group: joinGroups(s.groups, options.groupSeparator),
    subjectCode: s.subjectCode,
    subject: subjectDisplay({ subjectCode: s.subjectCode, subject: s.subject }, options),
    frequency: options.showFrequency && s.frequency ? s.frequency : '',
    program: '',
  };
}

export function buildDayGrid(
  sessions: Pick<ParsedSession, 'day' | 'slot' | 'room' | 'teachers' | 'groups' | 'subjectCode' | 'subject' | 'frequency'>[],
  meta: TimetableMeta,
  day: number,
  options: ExportOptions,
  nameResolver: NameResolver = createNameResolver(new Map(), new Map()),
  masterSessions: MasterGridSession[] = [],
  conflicts: Array<{ day: number; slot: number; resource: string }> = [],
): DayGrid {
  const nSlots = meta.slots.length;
  const daySessions = sessions.filter((s) => s.day === day && s.room);
  const key = (room: string) => clean(room).toLowerCase();
  const legacyCells = isLegacyTemplate(options.cellTemplate);
  const unassignedSessions: UnassignedGridSession[] = [];

  const normConflictResource = (r: string) => clean(r).toLowerCase().replace(/^salle\s+/u, '');

  const checkConflict = (room: string, slot: number) => {
    if (!options.highlightConflicts) return false;
    const rKey = normConflictResource(room);
    return conflicts.some((c) => c.day === day && c.slot === slot && normConflictResource(c.resource) === rKey);
  };

  // ----- cell content ------------------------------------------------------------------------
  // cellMap: `${room}|${slot}` → rendered entries (one per session, deduplicated).
  const cellMap = new Map<string, CellSession[]>();
  for (const s of daySessions) {
    const k = `${key(s.room)}|${s.slot}`;
    const list = cellMap.get(k) ?? [];
    const hasConflict = checkConflict(s.room, s.slot);
    const prefix = hasConflict ? '⚠ ' : '';

    if (legacyCells) {
      // Historical behaviour: one entry per (session, teacher), deduplicated, joined " / ".
      for (const t of s.teachers.split(',')) {
        const name = nameResolver.teacher(t, options.abbreviateBen);
        if (!name) continue;
        let text = options.showFrequency && s.frequency ? `${name} ${s.frequency}` : name;
        if (hasConflict) text = `${prefix}${text}`;
        if (!list.some((e) => e.lines[0] === text)) list.push({ lines: [text] });
      }
    } else {
      const lines = renderTemplate(options.cellTemplate, cellFields(s, options, nameResolver));
      if (hasConflict && lines.length > 0) lines[0] = `${prefix}${lines[0]}`;
      const text = lines.join('\n');
      if (text && !list.some((e) => e.lines.join('\n') === text)) list.push({ lines });
    }
    cellMap.set(k, list);
  }

  const additionalRooms: string[] = [];

  // ----- master program sessions -------------------------------------------------------------
  if (options.includeMasters && masterSessions.length > 0) {
    for (const m of masterSessions) {
      const dSpan = m.daySpan ?? 1;
      if (day < m.day || day >= m.day + dSpan) continue;

      if (m.roomUnassigned || !m.room || !m.room.trim()) {
        unassignedSessions.push({
          slot: m.slot,
          slotSpan: m.slotSpan ?? 1,
          programCode: m.programCode,
          title: m.title || m.code || 'Séance mastère',
          teachers: m.teachers.join(', '),
        });
        continue;
      }

      // Canonical room resolution
      let canonRoom = m.room.trim();
      const normRoom = clean(canonRoom).toLowerCase();
      if (normRoom === 'salle paq' || normRoom === 'paq' || normRoom === 'salle dgse' || normRoom === 'dgse') {
        canonRoom = 'PAQ/DGSE';
      }
      additionalRooms.push(canonRoom);

      const sSpan = m.slotSpan ?? 1;
      for (let sl = m.slot; sl < Math.min(nSlots, m.slot + sSpan); sl++) {
        const k = `${key(canonRoom)}|${sl}`;
        const list = cellMap.get(k) ?? [];
        const hasConflict = checkConflict(canonRoom, sl);
        const prefix = hasConflict ? '⚠ ' : '';

        const teacherPart = m.teachers.map((t) => nameResolver.teacher(t, options.abbreviateBen)).filter(Boolean).join(' / ');
        if (legacyCells) {
          const content = teacherPart ? `${teacherPart} (${m.programCode})` : m.programCode;
          const text = `${prefix}${content}`;
          if (!list.some((e) => e.lines[0] === text)) list.push({ lines: [text] });
        } else {
          const fields: CellFields = {
            teacher: teacherPart,
            group: '',
            subjectCode: m.code ?? '',
            subject: subjectDisplay({ subjectCode: m.code ?? '', subject: m.title }, options),
            frequency: options.showFrequency && m.frequency ? m.frequency : '',
            program: m.programCode,
          };
          const lines = renderTemplate(options.cellTemplate, fields);
          if (hasConflict && lines.length > 0) lines[0] = `${prefix}${lines[0]}`;
          const text = lines.join('\n');
          if (text && !list.some((e) => e.lines.join('\n') === text)) list.push({ lines });
        }
        cellMap.set(k, list);
      }
    }
  }

  const cellText = (entries: CellSession[]): string =>
    legacyCells
      ? entries.map((e) => e.lines[0]).join(' / ')
      : entries.map((e) => e.lines.join('\n')).join('\n');

  // ----- headers -----------------------------------------------------------------------------
  const pauseSlot = meta.slots.findIndex((s) => /^12:/.test(s.base));
  const headers: string[][] = meta.slots.map((s, i) => {
    const hasSessions = daySessions.some((x) => x.slot === i);
    if (i === pauseSlot && !s.overrides[day] && !hasSessions) return [options.pauseLabel];
    const lines = [s.overrides[day] ?? s.base];
    if (s.note) lines.push(`(${s.note})`);
    return lines;
  });

  // ----- rooms per bloc ----------------------------------------------------------------------
  const allRooms = Array.from(new Set([...meta.rooms, ...daySessions.map((s) => clean(s.room)), ...additionalRooms]));
  const used = new Set<string>();
  // Build blocs together with their configured page, then drop empty ones.
  const built: { bloc: BlocGrid; page: number }[] = options.blocs.map((b) => {
    const regs = b.patterns.map((p) => new RegExp(p, 'i'));
    // Order: first by the pattern that matched (so "Amphi" can follow the numbered rooms), then naturally.
    const rank = (r: string) => {
      const idx = regs.findIndex((re) => re.test(r));
      if (idx >= 0) return idx;
      if (options.includeMasters && (b.id === 'bloc-r' || b.title.includes('R')) && (r === 'PAQ/DGSE' || r.includes('PAQ') || r.includes('DGSE'))) {
        return 999;
      }
      return -1;
    };
    const rooms = allRooms
      .filter((r) => rank(r) >= 0 && !used.has(key(r)))
      .sort((a, b2) => rank(a) - rank(b2) || naturalCmp(a, b2));
    rooms.forEach((r) => used.add(key(r)));
    const rows: RoomRow[] = rooms
      .map((room) => {
        const slotEntries = Array.from({ length: nSlots }, (_, i) => cellMap.get(`${key(room)}|${i}`) ?? []);
        let label = nameResolver.room(room);
        if (room === 'PAQ/DGSE' && label === 'PAQ/DGSE') {
          label = 'Salle PAQ/DGSE';
        }
        const row: RoomRow = {
          room,
          label,
          cells: slotEntries.map(cellText),
        };
        if (!legacyCells) row.details = slotEntries;
        return row;
      })
      .filter((r) => options.includeEmptyRooms || r.cells.some(Boolean));
    return { bloc: { title: b.title, rows }, page: b.page ?? 1 };
  });

  const visible = built.filter((b) => b.bloc.rows.length);
  const distinctPages = Array.from(new Set(visible.map((b) => b.page))).sort((a, b) => a - b);
  const multiPage = distinctPages.length > 1;

  const blocs: BlocGrid[] = visible.map((b) => {
    const bloc = b.bloc;
    if (multiPage) bloc.page = b.page;
    return bloc;
  });

  let pages: DayPage[] | undefined;
  if (multiPage) {
    pages = distinctPages.map((p) => ({
      page: p,
      blocs: visible.map((_, i) => i).filter((i) => visible[i].page === p),
    }));
  }

  const grid: DayGrid = {
    day,
    dayName: meta.days[day] ?? `Jour ${day + 1}`,
    headers,
    blocs,
    sessionCount: daySessions.length + (options.includeMasters ? masterSessions.length : 0),
    pages,
  };
  if (unassignedSessions.length > 0) {
    grid.unassignedSessions = unassignedSessions;
  }
  return grid;
}
