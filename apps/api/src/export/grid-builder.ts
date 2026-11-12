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

export interface DayGrid {
  day: number;
  dayName: string;
  /** Header of each slot column (lines). */
  headers: string[][];
  blocs: BlocGrid[];
  sessionCount: number;
  /** Page groups — present only when more than one page is configured. */
  pages?: DayPage[];
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
  };
}

export function buildDayGrid(
  sessions: Pick<ParsedSession, 'day' | 'slot' | 'room' | 'teachers' | 'groups' | 'subjectCode' | 'subject' | 'frequency'>[],
  meta: TimetableMeta,
  day: number,
  options: ExportOptions,
  nameResolver: NameResolver = createNameResolver(new Map(), new Map()),
): DayGrid {
  const nSlots = meta.slots.length;
  const daySessions = sessions.filter((s) => s.day === day && s.room);
  const key = (room: string) => clean(room).toLowerCase();
  const legacyCells = isLegacyTemplate(options.cellTemplate);

  // ----- cell content ------------------------------------------------------------------------
  // cellMap: `${room}|${slot}` → rendered entries (one per session, deduplicated).
  const cellMap = new Map<string, CellSession[]>();
  for (const s of daySessions) {
    const k = `${key(s.room)}|${s.slot}`;
    const list = cellMap.get(k) ?? [];
    if (legacyCells) {
      // Historical behaviour: one entry per (session, teacher), deduplicated, joined " / ".
      for (const t of s.teachers.split(',')) {
        const name = nameResolver.teacher(t, options.abbreviateBen);
        if (!name) continue;
        const text = options.showFrequency && s.frequency ? `${name} ${s.frequency}` : name;
        if (!list.some((e) => e.lines[0] === text)) list.push({ lines: [text] });
      }
    } else {
      const lines = renderTemplate(options.cellTemplate, cellFields(s, options, nameResolver));
      const text = lines.join('\n');
      if (text && !list.some((e) => e.lines.join('\n') === text)) list.push({ lines });
    }
    cellMap.set(k, list);
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
  const allRooms = Array.from(new Set([...meta.rooms, ...daySessions.map((s) => clean(s.room))]));
  const used = new Set<string>();
  // Build blocs together with their configured page, then drop empty ones.
  const built: { bloc: BlocGrid; page: number }[] = options.blocs.map((b) => {
    const regs = b.patterns.map((p) => new RegExp(p, 'i'));
    // Order: first by the pattern that matched (so "Amphi" can follow the numbered rooms), then naturally.
    const rank = (r: string) => regs.findIndex((re) => re.test(r));
    const rooms = allRooms
      .filter((r) => rank(r) >= 0 && !used.has(key(r)))
      .sort((a, b2) => rank(a) - rank(b2) || naturalCmp(a, b2));
    rooms.forEach((r) => used.add(key(r)));
    const rows: RoomRow[] = rooms
      .map((room) => {
        const slotEntries = Array.from({ length: nSlots }, (_, i) => cellMap.get(`${key(room)}|${i}`) ?? []);
        const row: RoomRow = {
          room,
          label: nameResolver.room(room),
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

  return {
    day,
    dayName: meta.days[day] ?? `Jour ${day + 1}`,
    headers,
    blocs,
    sessionCount: daySessions.length,
    pages,
  };
}
