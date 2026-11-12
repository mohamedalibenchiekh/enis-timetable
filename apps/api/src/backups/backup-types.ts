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
  createdAt: string; // ISO 8601 UTC
  counts: BackupCounts;
  sha256: Record<string, string>; // e.g. "data/timetables.ndjson": "hex"
}

export interface BackupSettings {
  enabled: boolean;
  retention: number; // 3 to 50
}

export interface AutoBackupItem {
  id: string; // opaque token / filename
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

export interface CompatibilityVerdict {
  compatible: boolean;
  upgradeRequired: boolean;
  message: string;
}

export interface TimetableSummary {
  id: string;
  name: string;
  sessionCount: number;
  days: string[];
}

export interface InspectResult {
  uploadToken?: string;
  id?: string;
  manifest: BackupManifest;
  compatibility: CompatibilityVerdict;
  summary: {
    timetables: TimetableSummary[];
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

export interface Clock {
  now(): Date;
  setTimeout(handler: () => void, ms: number): any;
  clearTimeout(id: any): void;
}

