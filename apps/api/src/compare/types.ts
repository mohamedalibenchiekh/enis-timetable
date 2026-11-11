import type { SlotLabel, SourceKind } from '../parser/types.js';
import type { SourceFileInfo } from '../entities/timetable.entity.js';

export type CompareSource = SourceKind;
export type ChangeType = 'added' | 'removed' | 'moved' | 'room_changed' | 'group_changed' | 'teachers_changed';

/** Minimal session shape needed by the comparison (SessionEntity satisfies it). */
export interface SessionLike {
  day: number;
  slot: number;
  room: string;
  teachers: string;
  groups: string;
  subjectCode: string;
  subject: string;
  frequency: string;
}

export interface TimetableMeta {
  days: string[];
  slots: SlotLabel[];
  rooms: string[];
}

export interface TimetableSummary {
  id: string;
  name: string;
  institution: string;
  comment: string;
  generatedAt: string;
  createdAt: string;
  files: SourceFileInfo[];
}

export interface CompareInput {
  summary: TimetableSummary;
  meta: TimetableMeta;
  sessions: SessionLike[];
}

/** Normalized identity keys of an activity (teachers set, groups, subject, frequency). */
export interface ActivityKeys {
  teachersKey: string;
  groupsKey: string;
  subjectCodeKey: string;
  subjectKey: string;
  frequencyKey: string;
}

/** Human-readable activity fields (raw source values, formatted later). */
export interface ActivityDisplay {
  teachers: string;
  groups: string;
  subjectCode: string;
  subject: string;
  frequency: string;
}

export type Activity = ActivityDisplay & ActivityKeys;

/** Consecutive slots of the same session on the same day and room merged into one block. */
export interface Block {
  day: number;
  firstSlot: number;
  lastSlot: number;
  /** Raw room name as found in the source (first session of the block). */
  room: string;
  roomKey: string;
  activity: Activity;
}

export interface BlockSnapshot {
  day: number;
  dayName: string;
  firstSlot: number;
  lastSlot: number;
  /** e.g. "08:00-09:30" or "08:00-10:30" for a multi-slot block (per-day overrides applied). */
  timeRange: string;
  /** Display room label (NameResolver + automatic formatting). */
  room: string;
  roomKey: string;
  activity: ActivityDisplay;
}

export interface Change {
  type: ChangeType;
  /** Display activity: the "after" side when present, else the "before" side. */
  activity: ActivityDisplay;
  before: BlockSnapshot | null;
  after: BlockSnapshot | null;
  /** Affected day names, ordered by day index. */
  days: string[];
}

export interface DayCellChange {
  room: string;
  slotHeader: string;
  before: string;
  after: string;
}

export interface DayImpact {
  day: number;
  dayName: string;
  cells: DayCellChange[];
}

export interface CompareSummary {
  total: number;
  byType: Record<ChangeType, number>;
  /** Distinct teachers appearing in at least one change. */
  teachers: number;
  /** Distinct rooms appearing in at least one change. */
  rooms: number;
  /** unchanged blocks / max(base blocks, target blocks), 0..1. */
  similarity: number;
  /** French warning when more than 50% of blocks changed, else null. */
  warning: string | null;
  baseBlocks: number;
  targetBlocks: number;
  unchanged: number;
  changed: number;
}

export interface CompareResult {
  base: TimetableSummary;
  target: TimetableSummary;
  source: CompareSource;
  summary: CompareSummary;
  changes: Change[];
  /** Only days whose room × slot cells differ ("Jours à rééditer"). */
  days: DayImpact[];
}
