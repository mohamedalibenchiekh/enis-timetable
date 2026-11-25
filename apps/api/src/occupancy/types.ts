export type ConflictType =
  | 'room_double_booked'
  | 'teacher_double_booked'
  | 'room_missing'
  | 'room_to_find'
  | 'room_unknown';

export type ConflictSeverity = 'error' | 'warning' | 'info';

export interface TimeInterval {
  start: number; // minutes from midnight
  end: number;
}

export interface SessionInfo {
  id?: string | number;
  idStr?: string;
  programId?: string;
  programCode?: string;
  source: 'fet' | string; // 'fet' or program code (e.g. 'GT-M1')
  title: string;
  code?: string;
  subject?: string;
  groups?: string;
  teachers: string[];
  teacherKeys: string[];
  room: string | null;
  canonicalRoom: string | null;
  roomUnassigned?: boolean;
  day: number;
  slot: number;
  slotSpan?: number;
  daySpan?: number;
  customTime?: string | null;
  interval?: TimeInterval;
  color?: string | null;
  tags?: string[];
  frequency?: string;
  normSubject?: string;
  normCanonicalRoom?: string;
  ref?: ConflictSessionRef;
}

export interface ConflictSessionRef {
  id?: string | number;
  programId?: string;
  programCode?: string;
  source: 'fet' | string;
  title: string;
  room: string | null;
  canonicalRoom: string | null;
  teachers: string[];
  day: number;
  slot: number;
}

export interface Conflict {
  id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  day: number;
  slot: number;
  resource: string;
  message: string;
  sessions: ConflictSessionRef[];
}

export interface FreeRoomSuggestion {
  room: string;
  bloc: string;
  isSameBloc?: boolean;
  isKnown: boolean;
  score: number;
}

export interface FreeSlotSuggestion {
  day: number;
  slot: number;
  dayName?: string;
  slotLabel?: string;
  score: number;
  label?: string;
}

export interface OccupancyCatalogs {
  rooms?: string[];
  teachers?: string[];
  roomAliases?: Record<string, string>;
  teacherAliases?: Record<string, string>;
}
