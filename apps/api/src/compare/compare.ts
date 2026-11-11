import { buildDayGrid } from '../export/grid-builder.js';
import type { ExportOptions } from '../export/options.js';
import type { NameResolver } from '../export/name-resolver.js';
import { normalizeName } from '../names/name-normalization.js';
import { buildBlocks } from './blocks.js';
import { matchBlocks, type BlockMatch } from './diff.js';
import type {
  ActivityDisplay,
  Block,
  BlockSnapshot,
  Change,
  ChangeType,
  CompareInput,
  CompareResult,
  CompareSource,
  CompareSummary,
  DayCellChange,
  DayImpact,
  TimetableMeta,
} from './types.js';

/** Memoize resolver lookups: grid building calls them once per session per day. */
function cachedResolver(resolver: NameResolver): NameResolver {
  const teachers = new Map<string, string>();
  const rooms = new Map<string, string>();
  return {
    teacher: (name, abbrev) => {
      const k = `${abbrev ? 1 : 0}${name}`;
      let v = teachers.get(k);
      if (v === undefined) {
        v = resolver.teacher(name, abbrev);
        teachers.set(k, v);
      }
      return v;
    },
    room: (name) => {
      let v = rooms.get(name);
      if (v === undefined) {
        v = resolver.room(name);
        rooms.set(name, v);
      }
      return v;
    },
  };
}

const TIME_RE = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/;

function slotLabel(meta: TimetableMeta, day: number, slot: number): string {
  const s = meta.slots[slot];
  if (!s) return `Créneau ${slot + 1}`;
  return s.overrides[day] ?? s.base;
}

/** Time range of a block: start of the first slot → end of the last slot (per-day overrides applied). */
function timeRange(meta: TimetableMeta, day: number, firstSlot: number, lastSlot: number): string {
  const first = slotLabel(meta, day, firstSlot);
  const last = slotLabel(meta, day, lastSlot);
  if (firstSlot === lastSlot) return first;
  const f = TIME_RE.exec(first);
  const l = TIME_RE.exec(last);
  if (f && l) return `${f[1]}-${l[2]}`;
  return `${first} / ${last}`;
}

function formatTeachers(raw: string, options: ExportOptions, resolver: NameResolver): string {
  return raw
    .split(',')
    .map((t) => resolver.teacher(t, options.abbreviateBen))
    .filter(Boolean)
    .join(', ');
}

function activityDisplay(activity: Block['activity'], options: ExportOptions, resolver: NameResolver): ActivityDisplay {
  return {
    teachers: formatTeachers(activity.teachers, options, resolver),
    groups: activity.groups,
    subjectCode: activity.subjectCode,
    subject: activity.subject,
    frequency: activity.frequency,
  };
}

function snapshot(block: Block, meta: TimetableMeta, options: ExportOptions, resolver: NameResolver): BlockSnapshot {
  return {
    day: block.day,
    dayName: meta.days[block.day] ?? `Jour ${block.day + 1}`,
    firstSlot: block.firstSlot,
    lastSlot: block.lastSlot,
    timeRange: timeRange(meta, block.day, block.firstSlot, block.lastSlot),
    room: resolver.room(block.room) || '—',
    roomKey: block.roomKey,
    activity: activityDisplay(block.activity, options, resolver),
  };
}

function toChange(match: BlockMatch, baseMeta: TimetableMeta, targetMeta: TimetableMeta, options: ExportOptions, resolver: NameResolver): Change {
  const before = match.base ? snapshot(match.base, baseMeta, options, resolver) : null;
  const after = match.target ? snapshot(match.target, targetMeta, options, resolver) : null;
  const primary = after ?? before!;
  const dayPairs = [before, after]
    .filter((s): s is BlockSnapshot => s !== null)
    .map((s) => ({ day: s.day, name: s.dayName }));
  dayPairs.sort((a, b) => a.day - b.day);
  const days: string[] = [];
  for (const p of dayPairs) if (!days.includes(p.name)) days.push(p.name);
  return {
    type: match.type,
    activity: primary.activity,
    before,
    after,
    days,
  };
}

interface CellEntry {
  room: string;
  slotHeader: string;
  text: string;
}

function gridCells(grid: ReturnType<typeof buildDayGrid>): Map<string, CellEntry> {
  const map = new Map<string, CellEntry>();
  grid.blocs.forEach((bloc, bi) => {
    for (const row of bloc.rows) {
      const roomKey = normalizeName(row.label);
      row.cells.forEach((text, slot) => {
        const header = grid.headers[slot]?.join(' ') ?? `Créneau ${slot + 1}`;
        map.set(`${roomKey}|${slot}|${bi}`, { room: row.label, slotHeader: header, text });
      });
    }
  });
  return map;
}

/** Days whose room × slot cells differ between the two versions' DayGrids. */
function dayImpact(base: CompareInput, target: CompareInput, options: ExportOptions, resolver: NameResolver): DayImpact[] {
  const maxSessionDay = (sessions: { day: number }[]) => sessions.reduce((m, s) => Math.max(m, s.day), -1);
  const dayCount = Math.max(
    base.meta.days.length,
    target.meta.days.length,
    maxSessionDay(base.sessions) + 1,
    maxSessionDay(target.sessions) + 1,
  );
  // Pre-group sessions by day so buildDayGrid does not rescan the full list per day.
  const byDay = (sessions: CompareInput['sessions']) => {
    const map = new Map<number, CompareInput['sessions']>();
    for (const s of sessions) {
      const arr = map.get(s.day);
      if (arr) arr.push(s);
      else map.set(s.day, [s]);
    }
    return map;
  };
  const baseByDay = byDay(base.sessions);
  const targetByDay = byDay(target.sessions);
  const cached = cachedResolver(resolver);
  const impacts: DayImpact[] = [];
  for (let day = 0; day < dayCount; day++) {
    const baseGrid = buildDayGrid(baseByDay.get(day) ?? [], base.meta, day, options, cached);
    const targetGrid = buildDayGrid(targetByDay.get(day) ?? [], target.meta, day, options, cached);
    const baseCells = gridCells(baseGrid);
    const targetCells = gridCells(targetGrid);
    const keys = new Set([...baseCells.keys(), ...targetCells.keys()]);
    const cells: DayCellChange[] = [];
    for (const key of keys) {
      const b = baseCells.get(key);
      const t = targetCells.get(key);
      const before = b?.text ?? '';
      const after = t?.text ?? '';
      if (before === after) continue;
      cells.push({
        room: t?.room ?? b!.room,
        slotHeader: t?.slotHeader ?? b!.slotHeader,
        before,
        after,
      });
    }
    if (!cells.length) continue;
    cells.sort((a, b2) => a.slotHeader.localeCompare(b2.slotHeader, 'fr') || a.room.localeCompare(b2.room, 'fr', { numeric: true }));
    const dayName = target.meta.days[day] ?? base.meta.days[day] ?? `Jour ${day + 1}`;
    impacts.push({ day, dayName, cells });
  }
  return impacts;
}

function buildSummary(
  matches: BlockMatch[],
  unchanged: number,
  baseBlocks: number,
  targetBlocks: number,
): CompareSummary {
  const byType: Record<ChangeType, number> = {
    added: 0,
    removed: 0,
    moved: 0,
    room_changed: 0,
    group_changed: 0,
    teachers_changed: 0,
  };
  const teachers = new Set<string>();
  const rooms = new Set<string>();
  for (const m of matches) {
    byType[m.type]++;
    for (const block of [m.base, m.target]) {
      if (!block) continue;
      for (const t of block.activity.teachers.split(',')) {
        const k = normalizeName(t);
        if (k) teachers.add(k);
      }
      if (block.roomKey) rooms.add(block.roomKey);
    }
  }
  const total = matches.length;
  const maxBlocks = Math.max(baseBlocks, targetBlocks, 1);
  const changedRatio = total / maxBlocks;
  return {
    total,
    byType,
    teachers: teachers.size,
    rooms: rooms.size,
    similarity: unchanged / maxBlocks,
    warning: changedRatio > 0.5 ? 'Ces deux emplois du temps semblent très différents' : null,
    baseBlocks,
    targetBlocks,
    unchanged,
    changed: total,
  };
}

/**
 * Pure comparison entry point: blocks → deterministic matching → changes,
 * day impact (Word files to reprint) and summary. No database access.
 */
export function compareSessions(
  base: CompareInput,
  target: CompareInput,
  source: CompareSource,
  options: ExportOptions,
  resolver: NameResolver,
): CompareResult {
  const baseBlocks = buildBlocks(base.sessions);
  const targetBlocks = buildBlocks(target.sessions);
  const { matches, unchanged } = matchBlocks(baseBlocks, targetBlocks);
  const changes = matches.map((m) => toChange(m, base.meta, target.meta, options, cachedResolver(resolver)));
  return {
    base: base.summary,
    target: target.summary,
    source,
    summary: buildSummary(matches, unchanged, baseBlocks.length, targetBlocks.length),
    changes,
    days: dayImpact(base, target, options, cachedResolver(resolver)),
  };
}
