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
  detectedDates: { fileName: string; date: string; origin: ImportOrigin }[];
  isMismatch: boolean;
  message?: string;
}

export interface CrossCheckSummary {
  matchedSessions: number;
  discrepancies: {
    type: 'missing_in_pdf' | 'missing_in_csv' | 'field_difference';
    detail: string;
    day?: number;
    slot?: number;
    room?: string;
    teacher?: string;
  }[];
  isParityOk: boolean;
}

export interface ImportReport {
  files: FileReport[];
  canProceed: boolean;
  blockingErrors: string[];
  warnings: string[];
  dateMismatch?: DateMismatchInfo;
  crossCheck?: CrossCheckSummary;
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
