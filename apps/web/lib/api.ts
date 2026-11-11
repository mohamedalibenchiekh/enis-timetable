export type SourceKind = 'rooms' | 'teachers' | 'groups';

export interface SlotLabel { raw: string; base: string; overrides: Record<number, string>; note: string }
export interface SourceFileInfo { kind: SourceKind; fileName: string; owners: number; sessions: number }
export interface Timetable {
  id: string; name: string; institution: string; comment: string; generatedAt: string;
  days: string[]; slots: SlotLabel[]; rooms: string[]; files: SourceFileInfo[]; createdAt: string;
  previousTimetableId?: string | null;
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
export interface DayGrid {
  day: number; dayName: string; headers: string[][]; sessionCount: number;
  blocs: { title: string; rows: { room: string; label: string; cells: string[] }[] }[];
}
export interface BlocConfig { title: string; patterns: string[] }
export interface ExportOptions {
  blocs: BlocConfig[]; abbreviateBen: boolean; showFrequency: boolean; pauseLabel: string; includeEmptyRooms: boolean;
}
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
  list: () => req<Timetable[]>('/api/timetables'),
  get: (id: string) => req<Timetable>(`/api/timetables/${id}`),
  remove: (id: string) => req<{ ok: true }>(`/api/timetables/${id}`, { method: 'DELETE' }),
  upload: (files: File[], opts: { name?: string; timetableId?: string; previousTimetableId?: string }) => {
    const fd = new FormData();
    if (opts.name) fd.append('name', opts.name);
    if (opts.timetableId) fd.append('timetableId', opts.timetableId);
    if (opts.previousTimetableId) fd.append('previousTimetableId', opts.previousTimetableId);
    files.forEach((f) => fd.append('files', f));
    return req<UploadResult>('/api/timetables', { method: 'POST', body: fd });
  },
  compare: (id: string, otherId: string, source?: string) =>
    req<CompareResult>(`/api/timetables/${id}/compare/${otherId}${source && source !== 'auto' ? `?source=${source}` : ''}`),
  compareDocxUrl: (id: string, otherId: string, source?: string) =>
    `/api/timetables/${id}/compare/${otherId}/export.docx${source && source !== 'auto' ? `?source=${source}` : ''}`,
  compareCsvUrl: (id: string, otherId: string, source?: string) =>
    `/api/timetables/${id}/compare/${otherId}/export.csv${source && source !== 'auto' ? `?source=${source}` : ''}`,
  preview: (id: string, day: number) => req<DayGrid>(`/api/timetables/${id}/days/${day}/preview`),
  docxUrl: (id: string, day: number) => `/api/timetables/${id}/days/${day}/docx`,
  zipUrl: (id: string) => `/api/timetables/${id}/export.zip`,
  exportToFolder: (id: string, dir: string) =>
    req<{ dir: string; files: string[] }>(`/api/timetables/${id}/export-to-folder`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir }),
    }),
  getOptions: () => req<ExportOptions>('/api/settings/export'),
  saveOptions: (o: ExportOptions) =>
    req<ExportOptions>('/api/settings/export', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) }),
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

export const KIND_LABEL: Record<SourceKind, string> = { rooms: 'Salles', teachers: 'Enseignants', groups: 'Groupes' };
