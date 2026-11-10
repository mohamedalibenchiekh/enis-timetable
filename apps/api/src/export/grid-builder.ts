import { ParsedSession, SlotLabel } from '../parser/types.js';
import { clean } from '../parser/html-parser.js';
import { ExportOptions } from './options.js';

export interface TimetableMeta {
  days: string[];
  slots: SlotLabel[];
  rooms: string[];
}

export interface RoomRow {
  room: string;
  label: string;
  /** One entry per slot column; each is the teacher text of the cell ('' when free). */
  cells: string[];
}

export interface BlocGrid {
  title: string;
  rows: RoomRow[];
}

export interface DayGrid {
  day: number;
  dayName: string;
  /** Header of each slot column (lines). */
  headers: string[][];
  blocs: BlocGrid[];
  sessionCount: number;
}

const titleCase = (w: string) =>
  w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());

export function formatTeacher(name: string, abbreviateBen: boolean): string {
  const s = clean(name);
  if (!s || s === '-') return '';
  const words = s.split(' ').map(titleCase);
  if (abbreviateBen && words.length >= 3 && words[0] === 'Ben') words[0] = 'B';
  return words.join(' ');
}

/** "A02" → "A 0-2", "B12 (Labo Anglais)" → "B 1-2", "Amphi" → "Amphi" */
export function roomLabel(room: string): string {
  const name = clean(room).replace(/\s*\(.*\)\s*$/, '');
  const m = name.match(/^([A-Za-z])(\d)(\d)$/);
  return m ? `${m[1].toUpperCase()} ${m[2]}-${m[3]}` : name;
}

const naturalCmp = (a: string, b: string) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });

export function buildDayGrid(
  sessions: Pick<ParsedSession, 'day' | 'slot' | 'room' | 'teachers' | 'frequency'>[],
  meta: TimetableMeta,
  day: number,
  options: ExportOptions,
): DayGrid {
  const nSlots = meta.slots.length;
  const daySessions = sessions.filter((s) => s.day === day && s.room);
  const key = (room: string) => clean(room).toLowerCase();

  // ----- cell content ------------------------------------------------------------------------
  const cellMap = new Map<string, string[]>(); // `${room}|${slot}` → teacher strings
  for (const s of daySessions) {
    const k = `${key(s.room)}|${s.slot}`;
    const list = cellMap.get(k) ?? [];
    for (const t of s.teachers.split(',')) {
      const name = formatTeacher(t, options.abbreviateBen);
      if (!name) continue;
      const text = options.showFrequency && s.frequency ? `${name} ${s.frequency}` : name;
      if (!list.includes(text)) list.push(text);
    }
    cellMap.set(k, list);
  }

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
  const blocs: BlocGrid[] = options.blocs.map((b) => {
    const regs = b.patterns.map((p) => new RegExp(p, 'i'));
    // Order: first by the pattern that matched (so "Amphi" can follow the numbered rooms), then naturally.
    const rank = (r: string) => regs.findIndex((re) => re.test(r));
    const rooms = allRooms
      .filter((r) => rank(r) >= 0 && !used.has(key(r)))
      .sort((a, b2) => rank(a) - rank(b2) || naturalCmp(a, b2));
    rooms.forEach((r) => used.add(key(r)));
    const rows: RoomRow[] = rooms
      .map((room) => ({
        room,
        label: roomLabel(room),
        cells: Array.from({ length: nSlots }, (_, i) => (cellMap.get(`${key(room)}|${i}`) ?? []).join(' / ')),
      }))
      .filter((r) => options.includeEmptyRooms || r.cells.some(Boolean));
    return { title: b.title, rows };
  });

  return {
    day,
    dayName: meta.days[day] ?? `Jour ${day + 1}`,
    headers,
    blocs: blocs.filter((b) => b.rows.length),
    sessionCount: daySessions.length,
  };
}
