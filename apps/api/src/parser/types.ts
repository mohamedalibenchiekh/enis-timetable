export type SourceKind = 'rooms' | 'teachers' | 'groups';

/** One teaching session, normalised from a cell of a FET "days_horizontal" HTML export. */
export interface ParsedSession {
  /** Name of the table (room / teacher / group) this session was read from. */
  owner: string;
  /** 0 = Lundi … 5 = Samedi (index in the header row). */
  day: number;
  /** Row index of the time slot (0..5). */
  slot: number;
  groups: string;
  teachers: string;
  subjectCode: string;
  subject: string;
  room: string;
  /** e.g. "1/15" for a session held once every two weeks. */
  frequency: string;
}

export interface SlotLabel {
  /** Raw text of the row header, e.g. "13:00-14:30 (V: 14:00-15:30)". */
  raw: string;
  /** Default time range, e.g. "13:00-14:30". */
  base: string;
  /** Per-day overrides (day index → time range). */
  overrides: Record<number, string>;
  /** Free-text note found in parentheses, e.g. "Rat.". */
  note: string;
}

export interface ParsedFile {
  kind: SourceKind;
  institution: string;
  comment: string;
  generatedAt: string;
  days: string[];
  slots: SlotLabel[];
  /** Names of every table (room / teacher / group), even those with no session. */
  owners: string[];
  sessions: ParsedSession[];
}
