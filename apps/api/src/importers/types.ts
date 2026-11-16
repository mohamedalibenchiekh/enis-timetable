import { ParsedFile, SourceKind } from '../parser/types.js';

export type ImportOrigin = 'html' | 'csv' | 'pdf';

export interface DetectionResult {
  origin: ImportOrigin;
  kind?: SourceKind;
  confidence: number;
  reason: string;
}

export interface CellIssue {
  row?: number;
  page?: number;
  day?: number;
  slot?: number;
  owner?: string;
  reason: string;
  text?: string;
  level: 'warning' | 'error';
}

export interface FileReport {
  fileName: string;
  origin: ImportOrigin;
  kind?: SourceKind;
  ownersCount: number;
  sessionsCount: number;
  warnings: string[];
  errors: string[];
  issues: CellIssue[];
  stats?: {
    totalRows?: number;
    totalPages?: number;
    emptyCells?: number;
    splitCells?: number;
    spanningCells?: number;
    unparseableCells?: number;
  };
}

export interface DateMismatchInfo {
  isMismatch: boolean;
  dates: string[];
  details: string[];
  detectedDates?: { fileName: string; date: string; origin: ImportOrigin }[];
  message?: string;
}

export interface CrossCheckSummary {
  matchedSessions: number;
  discrepancies: string[];
  isParityOk: boolean;
}

export interface ImportReport {
  canImport: boolean;
  canProceed: boolean;
  hasErrors: boolean;
  hasWarnings: boolean;
  blockingMessage?: string;
  blockingErrors: string[];
  warnings: string[];
  files: FileReport[];
  dateMismatch: DateMismatchInfo;
  crossCheck?: CrossCheckSummary;
  summary: {
    totalSessions: number;
    distinctRooms: number;
    distinctTeachers: number;
    distinctGroups: number;
    originKind: string;
  };
  catalogs?: {
    rooms: string[];
    teachers: string[];
    groups: string[];
  };
}

export interface UploadedInputFile {
  originalname: string;
  buffer: Buffer;
}

export interface ImportContext {
  previousTimetableId?: string;
  confirmDateMismatch?: boolean;
  onProgress?: (progress: { current: number; total: number; stage: string }) => void;
  signal?: AbortSignal;
}

export interface ImporterResult {
  parsed: ParsedFile[];
  report: FileReport;
}

export interface Importer {
  readonly id: ImportOrigin;
  detect(file: UploadedInputFile): DetectionResult | null;
  parse(file: UploadedInputFile, ctx?: ImportContext): Promise<ImporterResult>;
}
