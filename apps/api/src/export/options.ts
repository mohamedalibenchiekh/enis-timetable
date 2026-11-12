export const OPTIONS_VERSION = 2;

export interface BlocConfig {
  /** Stable identifier (assigned on save; optional for legacy stored data). */
  id?: string;
  /** 1-based page number this bloc is printed on (missing = 1). */
  page?: number;
  /** Text of the yellow band, e.g. « BLOC « A » ». */
  title: string;
  /** Regular expressions (case-insensitive) a room name must match to belong to this bloc. */
  patterns: string[];
}

export type SubjectMode = 'full' | 'code' | 'both';
export type Orientation = 'portrait' | 'landscape';

export interface ExportOptions {
  optionsVersion: number;
  blocs: BlocConfig[];
  /** "BEN RHOUMA Asma" → "B Rhouma Asma" (convention used in the reference Jeudi.docx). */
  abbreviateBen: boolean;
  /** Append "1/15" after the teacher when the session is held once every two weeks. */
  showFrequency: boolean;
  /** Label of the lunch-break column when nothing is scheduled in it. */
  pauseLabel: string;
  /** List rooms of the blocs even if they are empty that day (as in the reference file). */
  includeEmptyRooms: boolean;
  /** Cell template with tokens {teacher} {group} {subjectCode} {subject} {frequency}; \n = new line. */
  cellTemplate: string;
  /** Course name display mode for the {subject} token. */
  subjectMode: SubjectMode;
  /** Max length of the course name (0 = unlimited); longer names get an ellipsis. */
  subjectMaxLength: number;
  /** Separator used when several groups share a slot. */
  groupSeparator: string;
  /** Font size of timetable cells, in points (7–12). */
  cellFontSize: number;
  /** Italic style for the secondary lines of a cell (group + course line). */
  detailItalic: boolean;
  /** Smaller style for the secondary lines of a cell (group + course line). */
  detailSmaller: boolean;
  /** Page orientation of the generated document. */
  orientation: Orientation;
  /** Repeat the day header row at the top of every page. */
  repeatDayHeader: boolean;
  /** Show a bold page title (bloc titles) above each page table. */
  showPageTitle: boolean;
}

/** Template used by the default preset — reproduces the historical cell content exactly. */
export const DEFAULT_CELL_TEMPLATE = '{teacher}';

export interface CellPreset {
  id: string;
  label: string;
  template: string;
}

export const CELL_PRESETS: CellPreset[] = [
  { id: 'teacher', label: 'Enseignant seulement', template: '{teacher}' },
  { id: 'teacherGroup', label: 'Enseignant + groupe', template: '{teacher}\n{group}' },
  { id: 'teacherGroupSubject', label: 'Enseignant + groupe + matière', template: '{teacher}\n{group} — {subjectCode} {subject}' },
  { id: 'groupSubject', label: 'Groupe + matière', template: '{group} — {subjectCode} {subject}' },
  { id: 'custom', label: 'Personnalisé', template: DEFAULT_CELL_TEMPLATE },
];

export const DEFAULT_OPTIONS: ExportOptions = {
  optionsVersion: OPTIONS_VERSION,
  blocs: [
    { id: 'bloc-a', page: 1, title: 'BLOC « A »', patterns: ['^A\\d\\d'] },
    { id: 'bloc-b', page: 1, title: 'BLOC « B »', patterns: ['^B\\d\\d'] },
    { id: 'bloc-r', page: 1, title: 'BLOC « R »', patterns: ['^R\\d\\d', '^Amphi$'] },
  ],
  abbreviateBen: true,
  showFrequency: true,
  pauseLabel: 'Pause',
  includeEmptyRooms: true,
  cellTemplate: DEFAULT_CELL_TEMPLATE,
  subjectMode: 'full',
  subjectMaxLength: 0,
  groupSeparator: ', ',
  cellFontSize: 10,
  detailItalic: false,
  detailSmaller: false,
  orientation: 'portrait',
  repeatDayHeader: true,
  showPageTitle: false,
};

// ---------------------------------------------------------------------------
// Validation helpers (French error messages)
// ---------------------------------------------------------------------------

const MAX_PATTERN_LENGTH = 200;
const MAX_TEMPLATE_LENGTH = 500;
const MAX_TITLE_LENGTH = 80;
const MAX_NAME_LENGTH = 60;
const MAX_PAGES = 50;

export const CELL_TOKENS = ['teacher', 'group', 'subjectCode', 'subject', 'frequency'] as const;
export type CellToken = (typeof CELL_TOKENS)[number];

const TOKEN_RE = /\{([^{}]*)\}/g;

/** Throws a French error when the template contains an unknown token or is malformed. */
export function assertValidTemplate(template: unknown): asserts template is string {
  if (typeof template !== 'string') throw new Error('Le modèle de cellule doit être un texte');
  if (template.length > MAX_TEMPLATE_LENGTH) throw new Error(`Le modèle de cellule dépasse ${MAX_TEMPLATE_LENGTH} caractères`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(template)) throw new Error('Le modèle de cellule contient un caractère de contrôle');
  for (const m of template.matchAll(TOKEN_RE)) {
    const name = m[1];
    if (!(CELL_TOKENS as readonly string[]).includes(name)) {
      throw new Error(`Jeton inconnu « {${name}} » dans le modèle de cellule. Jetons disponibles : ${CELL_TOKENS.map((t) => `{${t}}`).join(' ')}.`);
    }
  }
}

function isValidRegex(pattern: string): boolean {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) return false;
  try {
    new RegExp(pattern, 'i');
    return true;
  } catch {
    return false;
  }
}

function cleanString(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback;
  const v = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim();
  return v ? v.slice(0, max) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function intInRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

// ---------------------------------------------------------------------------
// Options normalization (migration + sanitization, never throws)
// ---------------------------------------------------------------------------

function normalizeBlocs(raw: unknown, strict: boolean): BlocConfig[] {
  if (!Array.isArray(raw)) {
    if (strict && raw !== undefined) throw new Error('« blocs » doit être une liste');
    return DEFAULT_OPTIONS.blocs.map((b) => ({ ...b, patterns: [...b.patterns] }));
  }
  if (raw.length === 0) {
    if (strict) throw new Error('Au moins un bloc est requis');
    return DEFAULT_OPTIONS.blocs.map((b) => ({ ...b, patterns: [...b.patterns] }));
  }
  return raw.map((item, index) => {
    const row = (item && typeof item === 'object' && !Array.isArray(item)) ? item as Record<string, unknown> : {};
    const title = cleanString(row.title, `BLOC ${index + 1}`, MAX_TITLE_LENGTH);
    if (strict && (typeof row.title !== 'string' || !row.title.trim())) throw new Error(`Bloc ${index + 1} : le titre est obligatoire`);
    const rawPatterns = Array.isArray(row.patterns) ? row.patterns : [];
    const patterns: string[] = [];
    for (const p of rawPatterns) {
      if (typeof p !== 'string') {
        if (strict) throw new Error(`Bloc « ${title} » : chaque motif doit être un texte`);
        continue;
      }
      const trimmed = p.trim();
      if (!trimmed) continue;
      if (strict && !isValidRegex(trimmed)) throw new Error(`Bloc « ${title} » : expression régulière invalide « ${trimmed.slice(0, 40)} »`);
      if (isValidRegex(trimmed)) patterns.push(trimmed.slice(0, MAX_PATTERN_LENGTH));
    }
    if (strict && patterns.length === 0) throw new Error(`Bloc « ${title} » : au moins un motif valide est requis`);
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim().slice(0, 60) : `bloc-${index + 1}`;
    const page = intInRange(row.page, 1, 1, MAX_PAGES);
    return { id, page, title, patterns };
  });
}

/**
 * Normalizes any stored/partial options value into a valid v2 ExportOptions.
 * Old (unversioned) shapes migrate to the new shape with identical output;
 * unknown or invalid values fall back to defaults instead of crashing.
 * In strict mode (API writes) invalid values throw a French error instead.
 */
export function normalizeOptions(raw: unknown, strict = false): ExportOptions {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};

  let cellTemplate = DEFAULT_CELL_TEMPLATE;
  if (src.cellTemplate !== undefined) {
    if (strict) {
      assertValidTemplate(src.cellTemplate);
      cellTemplate = src.cellTemplate;
    } else {
      try { assertValidTemplate(src.cellTemplate); cellTemplate = src.cellTemplate; } catch { cellTemplate = DEFAULT_CELL_TEMPLATE; }
    }
  }

  return {
    optionsVersion: OPTIONS_VERSION,
    blocs: normalizeBlocs(src.blocs, strict),
    abbreviateBen: bool(src.abbreviateBen, DEFAULT_OPTIONS.abbreviateBen),
    showFrequency: bool(src.showFrequency, DEFAULT_OPTIONS.showFrequency),
    pauseLabel: cleanString(src.pauseLabel, DEFAULT_OPTIONS.pauseLabel, 40),
    includeEmptyRooms: bool(src.includeEmptyRooms, DEFAULT_OPTIONS.includeEmptyRooms),
    cellTemplate,
    subjectMode: oneOf(src.subjectMode, ['full', 'code', 'both'] as const, DEFAULT_OPTIONS.subjectMode),
    subjectMaxLength: intInRange(src.subjectMaxLength, DEFAULT_OPTIONS.subjectMaxLength, 0, 200),
    groupSeparator: cleanString(src.groupSeparator, DEFAULT_OPTIONS.groupSeparator, 10) || DEFAULT_OPTIONS.groupSeparator,
    cellFontSize: intInRange(src.cellFontSize, DEFAULT_OPTIONS.cellFontSize, 7, 12),
    detailItalic: bool(src.detailItalic, DEFAULT_OPTIONS.detailItalic),
    detailSmaller: bool(src.detailSmaller, DEFAULT_OPTIONS.detailSmaller),
    orientation: oneOf(src.orientation, ['portrait', 'landscape'] as const, DEFAULT_OPTIONS.orientation),
    repeatDayHeader: bool(src.repeatDayHeader, DEFAULT_OPTIONS.repeatDayHeader),
    showPageTitle: bool(src.showPageTitle, DEFAULT_OPTIONS.showPageTitle),
  };
}

/**
 * Backward-compatible shallow merge used by the legacy PUT /settings/export.
 * Keeps the historical semantics: empty/missing blocs fall back to defaults.
 */
export function mergeOptions(partial?: Partial<ExportOptions> | null): ExportOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...(partial ?? {}),
    blocs: partial?.blocs?.length ? partial.blocs : DEFAULT_OPTIONS.blocs.map((b) => ({ ...b, patterns: [...b.patterns] })),
  } as ExportOptions;
}

// ---------------------------------------------------------------------------
// Export profiles
// ---------------------------------------------------------------------------

export interface ExportProfile {
  id: string;
  name: string;
  options: ExportOptions;
}

export interface ExportProfilesState {
  optionsVersion: number;
  defaultId: string;
  profiles: ExportProfile[];
}

export const DEFAULT_PROFILE_NAME = 'Standard';
export const DEFAULT_PROFILE_ID = 'default';

function normalizeProfileName(raw: unknown, strict: boolean): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    if (strict) throw new Error('Le nom du profil est obligatoire');
    return DEFAULT_PROFILE_NAME;
  }
  const name = raw.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim().slice(0, MAX_NAME_LENGTH);
  if (strict && !name) throw new Error('Le nom du profil est obligatoire');
  return name || DEFAULT_PROFILE_NAME;
}

function normalizeProfile(raw: unknown, index: number, strict: boolean): ExportProfile {
  const row = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim().slice(0, 60) : `${DEFAULT_PROFILE_ID}-${index + 1}`;
  const name = normalizeProfileName(row.name, strict);
  const options = normalizeOptions(row.options, strict);
  return { id, name, options };
}

/**
 * Normalizes the stored 'export' settings value into a profiles state.
 * A legacy single options object migrates to one profile named "Standard" (default).
 */
export function normalizeProfilesState(raw: unknown, strict = false): ExportProfilesState {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};

  // New shape: { optionsVersion, defaultId, profiles: [...] }
  if (Array.isArray(src.profiles)) {
    const profiles = src.profiles.map((p, i) => normalizeProfile(p, i, strict));
    if (profiles.length === 0) {
      if (strict) throw new Error('Au moins un profil est requis');
      profiles.push({ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, options: normalizeOptions(undefined) });
    }
    // Ensure unique ids (append suffix on collision).
    const seen = new Set<string>();
    for (const p of profiles) {
      let id = p.id;
      let n = 2;
      while (seen.has(id)) id = `${p.id}-${n++}`;
      seen.add(id);
      p.id = id;
    }
    const defaultId = typeof src.defaultId === 'string' && profiles.some((p) => p.id === src.defaultId)
      ? src.defaultId
      : profiles[0].id;
    return { optionsVersion: OPTIONS_VERSION, defaultId, profiles };
  }

  // Legacy shape: a single options object (or empty) → one "Standard" profile.
  const options = normalizeOptions(raw, strict);
  return {
    optionsVersion: OPTIONS_VERSION,
    defaultId: DEFAULT_PROFILE_ID,
    profiles: [{ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, options }],
  };
}

/** Sanitize a profile name for use in a Windows file name. */
export function sanitizeProfileFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 60);
}

/** File name for a day's document: `Jeudi.docx` for the default profile, `Jeudi - <profil>.docx` otherwise. */
export function dayFileName(dayName: string, profile: ExportProfile | null, isDefault: boolean): string {
  if (isDefault || !profile) return `${dayName}.docx`;
  const safe = sanitizeProfileFileName(profile.name);
  return safe ? `${dayName} - ${safe}.docx` : `${dayName}.docx`;
}
