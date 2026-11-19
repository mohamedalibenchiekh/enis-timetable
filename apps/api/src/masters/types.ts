export interface ProgramSlot {
  index: number;
  label: string;
  rawLabel: string;
  base: string;
  dayOverrides: Record<number, string>;
  note: string;
}

export interface StyleHints {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  highlight?: string;
  fill?: string;
}

export interface ProgramSession {
  id?: string;
  programId?: string;
  day: number;
  slot: number;
  slotSpan: number;
  daySpan: number;
  title: string;
  code: string;
  teachers: string[];
  teacherKeys: string[];
  room: string | null;
  roomUnassigned: boolean;
  locationNote: string;
  frequency: string;
  tags: string[];
  customTime: string | null;
  color: string | null;
  note: string;
  rawText: string;
  confidence: number;
  reasons: string[];
  source: 'docx' | 'pdf' | 'manual';
}

export interface ProgramAnalysis {
  code: string;
  title: string;
  kind: string;
  academicYear: string;
  semester: string;
  coordinator: string;
  formRef: string;
  effectiveFrom: string;
  footerText: string;
  version: string;
  slots: ProgramSlot[];
  sessions: ProgramSession[];
  warnings: string[];
  confidence: number;
  rawSnapshot: Record<string, unknown>;
  source: 'docx' | 'pdf';
}

export interface CellCatalogs {
  rooms?: string[];
  teachers?: string[];
  teacherAliases?: Record<string, string>;
  roomAliases?: Record<string, string>;
}

