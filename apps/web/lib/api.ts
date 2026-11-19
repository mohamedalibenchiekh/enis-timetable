export type SourceKind = 'rooms' | 'teachers' | 'groups';
export type ImportOrigin = 'html' | 'csv' | 'pdf';

export interface SlotLabel { raw: string; base: string; overrides: Record<number, string>; note: string }
export interface SourceFileInfo { kind: SourceKind; fileName: string; owners: number; sessions: number; origin?: ImportOrigin }
export interface Timetable {
  id: string; name: string; institution: string; comment: string; generatedAt: string;
  days: string[]; slots: SlotLabel[]; rooms: string[]; files: SourceFileInfo[]; createdAt: string;
  previousTimetableId?: string | null;
}
export interface ProgramSlot { index: number; label: string; rawLabel: string; base: string; dayOverrides: Record<number, string>; note: string; }
export interface ProgramSession {
  id?: string; day: number; slot: number; slotSpan: number; daySpan: number; title: string; code: string; teachers: string[]; teacherKeys: string[];
  room: string | null; roomUnassigned: boolean; locationNote: string; frequency: string; tags: string[]; customTime: string | null; color: string | null;
  note: string; rawText: string; confidence: number; reasons: string[]; source: 'docx' | 'pdf' | 'manual';
}
export interface ProgramAnalysis {
  id?: string; code: string; title: string; kind: string; academicYear: string; semester: string; coordinator: string; formRef: string; effectiveFrom: string;
  footerText: string; version: string; slots: ProgramSlot[]; sessions: ProgramSession[]; warnings: string[]; confidence: number;
  rawSnapshot: Record<string, unknown>; source: 'docx' | 'pdf';
}
export interface SavedProgram extends ProgramAnalysis { revision: number; isCurrent: boolean; createdAt: string; updatedAt: string; }
export interface ProgramAlias { id: number; aliasKey: string; aliasName: string; canonicalName: string; canonicalKey?: string; seeded: boolean; }
export interface CellIssue {
  file: string;
  page?: number;
  row?: number;
  day?: number;
  slot?: number;
  textSnippet: string;
  reason: string;
  severity: 'warning' | 'error';
}
export interface FileReport {
  fileName: string;
  origin: ImportOrigin;
  detectedKind?: SourceKind;
  confidence: number;
  sessionsCount: number;
  ownersCount: number;
  warnings: string[];
  errors: string[];
  issues: CellIssue[];
}
export interface DateMismatchInfo {
  isMismatch: boolean;
  dates: string[];
  details: string[];
}
export interface CrossCheckSummary {
  hasRooms: boolean;
  hasTeachers: boolean;
  hasGroups: boolean;
  roomsSessions: number;
  teachersSessions: number;
  groupsSessions: number;
  discrepancies: string[];
}
export interface ImportReport {
  canImport: boolean;
  hasErrors: boolean;
  hasWarnings: boolean;
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
  blockingMessage?: string;
}
export type ChangeType = 'added' | 'removed' | 'moved' | 'room_changed' | 'group_changed' | 'teachers_changed';
export interface CompareActivity { teachers: string; groups: string; subjectCode: string; subject: string; frequency: string }
export interface CompareSnapshot {
  day: number; dayName: string; firstSlot: number; lastSlot: number; timeRange: string;
  room: string; roomKey: string; activity: CompareActivity;
}
export interface CompareChange {
  type: ChangeType; activity: CompareActivity; before: CompareSnapshot | null; after: CompareSnapshot | null; days: string[];
}
export interface CompareDayCell { room: string; roomKey: string; slotHeader: string; before: string; after: string }
export interface CompareDay { day: number; dayName: string; cells: CompareDayCell[] }
export interface CompareSummary {
  total: number; byType: Record<ChangeType, number>; teachers: number; rooms: number;
  similarity: number; warning: string | null; baseBlocks: number; targetBlocks: number;
  unchanged: number; changed: number;
}
export interface CompareTimetableInfo {
  id: string; name: string; institution: string; comment: string; generatedAt: string; createdAt: string;
  files: SourceFileInfo[];
}
export interface CompareResult {
  base: CompareTimetableInfo; target: CompareTimetableInfo; source: SourceKind;
  summary: CompareSummary; changes: CompareChange[]; days: CompareDay[];
}
export interface UploadResult extends Timetable { comparison?: CompareSummary | null }
export interface CellSession { lines: string[] }
export interface RoomRow { room: string; label: string; cells: string[]; details?: CellSession[][] }
export interface BlocGrid { title: string; rows: RoomRow[] }
export interface DayPage { page: number; blocs: number[] }
export interface DayGrid {
  day: number; dayName: string; headers: string[][]; sessionCount: number;
  blocs: BlocGrid[];
  pages?: DayPage[];
  /** Resolved export options used to build this grid (preview only). */
  options?: ExportOptions;
}
export interface BlocConfig { id?: string; title: string; patterns: string[]; page?: number }
export type SubjectMode = 'full' | 'code' | 'both';
export type Orientation = 'portrait' | 'landscape';
export interface ExportOptions {
  optionsVersion: number;
  blocs: BlocConfig[];
  abbreviateBen: boolean;
  showFrequency: boolean;
  pauseLabel: string;
  includeEmptyRooms: boolean;
  cellTemplate: string;
  subjectMode: SubjectMode;
  subjectMaxLength: number;
  groupSeparator: string;
  cellFontSize: number;
  detailItalic: boolean;
  detailSmaller: boolean;
  orientation: Orientation;
  repeatDayHeader: boolean;
  showPageTitle: boolean;
}
export interface ExportProfile { id: string; name: string; options: ExportOptions }
export interface ExportProfilesState { optionsVersion: number; defaultId: string; profiles: ExportProfile[] }
export interface NameEntry {
  key: string;
  sourceName: string;
  autoName: string;
  displayName: string | null;
  sessions: number;
  bloc?: string | null;
}
export interface NameList { items: NameEntry[]; unused: NameEntry[] }
export type NameCategory = 'teachers' | 'rooms';
export interface NamesImportSummary {
  added: number;
  updated: number;
  ignored: number;
}

export type BackupMode = 'replace' | 'merge';

export interface BackupCounts {
  timetables: number;
  sessions: number;
  settings: number;
  teacher_names: number;
  room_labels: number;
}

export interface BackupManifest {
  formatVersion: number;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  counts: BackupCounts;
  sha256: Record<string, string>;
}

export interface BackupSettings {
  enabled: boolean;
  retention: number;
}

export interface AutoBackupItem {
  id: string;
  fileName: string;
  createdAt: string;
  sizeBytes: number;
  appVersion: string;
  schemaVersion: number;
  counts: BackupCounts;
  isPreRestore: boolean;
}

export interface PreUpdateBackupItem {
  id: string;
  name: string;
  version: string;
  createdAt: string;
  sizeBytes: number;
  path: string;
}

export interface BackupsSummary {
  autoBackups: AutoBackupItem[];
  preUpdateBackups: PreUpdateBackupItem[];
  settings: BackupSettings;
  lastAutoBackup: {
    successAt: string | null;
    error: string | null;
  };
}

export interface InspectResult {
  uploadToken?: string;
  id?: string;
  manifest: BackupManifest;
  compatibility: {
    compatible: boolean;
    upgradeRequired: boolean;
    message: string;
  };
  summary: {
    timetables: { id: string; name: string; sessionCount: number; days: string[] }[];
    teacherOverridesCount: number;
    roomOverridesCount: number;
    hasSettings: boolean;
  };
}

export interface RestoreResult {
  ok: boolean;
  mode: BackupMode;
  restoredCounts: BackupCounts;
  safetyBackupPath: string;
}

export type UpdateStatus =
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'progress'; version: string; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }
  | { status: 'none' };

/** Bridge exposed by the Electron preload script (undefined in a normal browser). */
declare global {
  interface Window {
    enis?: {
      chooseFolder: () => Promise<string | null>;
      showInFolder: (p: string) => Promise<void>;
      getVersion: () => Promise<string>;
      getUpdateStatus: () => Promise<UpdateStatus | null>;
      checkForUpdates: () => Promise<void>;
      installUpdate: () => Promise<void>;
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
    };
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = Array.isArray(j.message) ? j.message.join(', ') : j.message ?? msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  analyzePrograms: (files: File[], referenceSlots?: string[], referenceTimetableId?: string, referenceOverrides?: Record<number, Record<number, string>>) => {
    const fd = new FormData();
    files.forEach((file) => fd.append('files', file));
    if (referenceSlots) fd.append('referenceSlots', JSON.stringify(referenceSlots));
    if (referenceTimetableId) fd.append('referenceTimetableId', referenceTimetableId);
    if (referenceOverrides) fd.append('referenceOverrides', JSON.stringify(referenceOverrides));
    return req<ProgramAnalysis[]>('/api/programs/analyze', { method: 'POST', body: fd });
  },
  saveProgram: (program: ProgramAnalysis, mode: 'replace' | 'new-version') =>
    req<SavedProgram>('/api/programs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ program, mode }) }),
  listPrograms: () => req<SavedProgram[]>('/api/programs'),
  getProgram: (id: string) => req<SavedProgram>(`/api/programs/${id}`),
  deleteProgram: (id: string) => req<{ ok: true }>(`/api/programs/${id}`, { method: 'DELETE' }),
  saveProgramAlias: (alias: { kind: 'teacher' | 'room'; aliasName: string; canonicalName: string }) =>
    req<unknown>('/api/programs/aliases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(alias) }),
  listProgramAliases: () => req<{ rooms: ProgramAlias[]; teachers: ProgramAlias[] }>('/api/programs/aliases'),
  deleteProgramAlias: (kind: 'teacher' | 'room', id: number) => req<{ ok: true }>(`/api/programs/aliases/${kind}/${id}`, { method: 'DELETE' }),
  list: () => req<Timetable[]>('/api/timetables'),
  get: (id: string) => req<Timetable>(`/api/timetables/${id}`),
  remove: (id: string) => req<{ ok: true }>(`/api/timetables/${id}`, { method: 'DELETE' }),
  upload: (files: File[], opts: { name?: string; timetableId?: string; previousTimetableId?: string; confirmDateMismatch?: boolean }) => {
    const fd = new FormData();
    if (opts.name) fd.append('name', opts.name);
    if (opts.timetableId) fd.append('timetableId', opts.timetableId);
    if (opts.previousTimetableId) fd.append('previousTimetableId', opts.previousTimetableId);
    if (opts.confirmDateMismatch) fd.append('confirmDateMismatch', 'true');
    files.forEach((f) => fd.append('files', f));
    return req<UploadResult>('/api/timetables', { method: 'POST', body: fd });
  },
  analyze: (files: File[], opts?: { previousTimetableId?: string }) => {
    const fd = new FormData();
    if (opts?.previousTimetableId) fd.append('previousTimetableId', opts.previousTimetableId);
    files.forEach((f) => fd.append('files', f));
    return req<ImportReport>('/api/timetables/analyze', { method: 'POST', body: fd });
  },
  compare: (id: string, otherId: string, source?: string) =>
    req<CompareResult>(`/api/timetables/${id}/compare/${otherId}${source && source !== 'auto' ? `?source=${source}` : ''}`),
  compareDocxUrl: (id: string, otherId: string, source?: string) =>
    `/api/timetables/${id}/compare/${otherId}/export.docx${source && source !== 'auto' ? `?source=${source}` : ''}`,
  compareCsvUrl: (id: string, otherId: string, source?: string) =>
    `/api/timetables/${id}/compare/${otherId}/export.csv${source && source !== 'auto' ? `?source=${source}` : ''}`,
  preview: (id: string, day: number, source?: SourceKind, profile?: string) => {
    const params = new URLSearchParams();
    if (source) params.set('source', source);
    if (profile) params.set('profile', profile);
    const qs = params.toString();
    return req<DayGrid>(`/api/timetables/${id}/days/${day}/preview${qs ? `?${qs}` : ''}`);
  },
  docxUrl: (id: string, day: number, profile?: string) => `/api/timetables/${id}/days/${day}/docx${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`,
  zipUrl: (id: string, profile?: string) => `/api/timetables/${id}/export.zip${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`,
  exportToFolder: (id: string, dir: string, profile?: string) =>
    req<{ dir: string; files: string[] }>(`/api/timetables/${id}/export-to-folder`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir, profile }),
    }),
  getOptions: () => req<ExportOptions>('/api/settings/export'),
  saveOptions: (o: ExportOptions) =>
    req<ExportOptions>('/api/settings/export', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) }),
  listProfiles: () => req<ExportProfilesState>('/api/settings/export-profiles'),
  createProfile: (name: string, options?: Partial<ExportOptions>) =>
    req<ExportProfilesState>('/api/settings/export-profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, options }) }),
  updateProfile: (id: string, patch: { name?: string; options?: Partial<ExportOptions>; isDefault?: boolean }) =>
    req<ExportProfilesState>(`/api/settings/export-profiles/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }),
  deleteProfile: (id: string) =>
    req<ExportProfilesState>(`/api/settings/export-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getNames: (kind: NameCategory, timetableId: string) =>
    req<NameList>(`/api/names/${kind}?timetableId=${encodeURIComponent(timetableId)}`),
  saveNames: (kind: NameCategory, items: { sourceName: string; displayName: string }[]) =>
    req<{ ok: true; saved: number }>(`/api/names/${kind}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }),
    }),
  deleteName: (kind: NameCategory, key: string) =>
    req<{ ok: true }>(`/api/names/${kind}/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  exportNames: () => req<{ version: number; teachers: unknown[]; rooms: unknown[] }>('/api/names/export'),
  importNames: (data: unknown) =>
    req<NamesImportSummary>('/api/names/import', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
    }),
  backups: {
    list: () => req<BackupsSummary>('/api/backups'),
    createUrl: () => '/api/backups?download=1',
    createAuto: () => req<{ ok: true; fileName: string; filePath?: string }>('/api/backups', { method: 'POST' }),
    downloadUrl: (id: string) => `/api/backups/${encodeURIComponent(id)}/download`,
    delete: (id: string) => req<{ ok: true }>(`/api/backups/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    inspect: (source: { file?: File; id?: string }) => {
      if (source.file) {
        const fd = new FormData();
        fd.append('file', source.file);
        return req<InspectResult>('/api/backups/inspect', { method: 'POST', body: fd });
      }
      return req<InspectResult>('/api/backups/inspect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: source.id }),
      });
    },
    restore: (payload: { id?: string; uploadToken?: string; mode: BackupMode }) =>
      req<RestoreResult>('/api/backups/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    getSettings: () => req<BackupSettings>('/api/backups/settings'),
    saveSettings: (settings: Partial<BackupSettings>) =>
      req<BackupSettings>('/api/backups/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      }),
  },
};

/** Same normalization as the API's normalizeName — used to match highlight cells. */
export function normalizeName(value: string): string {
  return value
    .replace(/[\s ]+/gu, ' ')
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

export function guessKind(name: string): SourceKind | null {
  const n = name.toLowerCase();
  if (n.includes('teacher') || n.includes('enseignant')) return 'teachers';
  if (n.includes('room') || n.includes('salle')) return 'rooms';
  if (n.includes('group')) return 'groups';
  return null;
}

export function guessOrigin(name: string): ImportOrigin | null {
  const n = name.toLowerCase();
  if (n.endsWith('.csv')) return 'csv';
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.html') || n.endsWith('.htm')) return 'html';
  return null;
}

export const KIND_LABEL: Record<SourceKind, string> = { rooms: 'Salles', teachers: 'Enseignants', groups: 'Groupes' };
export const ORIGIN_LABEL: Record<ImportOrigin, string> = { html: 'HTML', csv: 'CSV', pdf: 'PDF' };
