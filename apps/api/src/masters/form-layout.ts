import type { ProgramAnalysis, ProgramSession, ProgramSlot } from './types.js';

export interface FormCell {
  session: ProgramSession | null;
  day: number;
  slot: number;
  daySpan: number;
  slotSpan: number;
  covered: boolean;
  pause: boolean;
  marker: string;
  fill: string;
}

export interface FormLayout {
  program: Pick<ProgramAnalysis, 'code' | 'title' | 'kind' | 'academicYear' | 'semester' | 'coordinator' | 'formRef' | 'effectiveFrom' | 'footerText' | 'version'>;
  institution: string;
  headerTitle: string;
  formDate: string;
  days: string[];
  slots: ProgramSlot[];
  cells: FormCell[][];
  footer: string;
  marker: string;
  roomColor: string;
  tableWidthTwips: number;
  columnWidthsTwips: number[];
  warnings: string[];
  fontSize: number;
}

export interface FormSettings {
  institution?: string;
  academicYear?: string;
  formDate?: string;
  headerTitle?: string;
  emptyMarker?: string;
  roomColor?: string;
  footerFormat?: 'legacy' | 'compact';
}

export const DEFAULT_FORM_SETTINGS: Required<FormSettings> = {
  institution: 'École Nationale d’Ingénieurs de Sousse',
  academicYear: '2026-2027',
  formDate: '',
  headerTitle: 'Emploi du Temps',
  emptyMarker: '---',
  roomColor: 'FF0000',
  footerFormat: 'legacy',
};

const DAYS = ['Lundi', 'Mardi', 'Mercredi (M)', 'Jeudi', 'Vendredi (V)', 'Samedi (S)'];
const VALID_MARKERS = new Set(['---', '-X-', '']);

function sessionTextSize(session: ProgramSession): number {
  const visibleTags = session.tags.filter((tag) => tag !== 'DS' && tag !== 'teacher-italic' && !/devoir surveill[eé]/iu.test(tag));
  return [
    isDs(session.tags) ? 'Devoir Surveillé' : '', session.customTime ?? '', session.code, session.title,
    session.frequency, ...visibleTags, ...session.teachers, displayRoom(session), session.locationNote,
  ].filter(Boolean).join(' ').length;
}

function isDs(tags: string[]) { return tags.some((tag) => tag === 'DS' || /devoir surveill[eé]/iu.test(tag)); }

export function buildFormLayout(program: ProgramAnalysis, settings: FormSettings = {}): FormLayout {
  const config = { ...DEFAULT_FORM_SETTINGS, ...settings };
  const academicYear = program.academicYear || config.academicYear;
  const safeTitle = (program.title || program.code).replace(/20\d{2}\s*[-–/]\s*20\d{2}/gu, academicYear);
  const slots = Array.from({ length: 6 }, (_, index) => program.slots?.find((slot) => slot.index === index) ?? {
    index, label: '', rawLabel: '', base: '', dayOverrides: {}, note: '',
  });
  const marker = VALID_MARKERS.has(config.emptyMarker) ? config.emptyMarker : DEFAULT_FORM_SETTINGS.emptyMarker;
  const occupied = new Map<string, ProgramSession>();
  for (const session of program.sessions ?? []) {
    if (session.day < 0 || session.day > 5 || session.slot < 0 || session.slot > 5) continue;
    occupied.set(`${session.day}:${session.slot}`, session);
    for (let d = 0; d < session.daySpan; d++) for (let s = 0; s < session.slotSpan; s++) {
      if (d || s) occupied.set(`${session.day + d}:${session.slot + s}`, session);
    }
  }
  const cells = Array.from({ length: 6 }, (_, slot) => Array.from({ length: 6 }, (_, day) => {
    const session = occupied.get(`${day}:${slot}`) ?? null;
    const anchor = session?.day === day && session.slot === slot;
    return {
      session: anchor ? session : null,
      day, slot, daySpan: anchor ? Math.min(session.daySpan, 6 - day) : 1,
      slotSpan: anchor ? Math.min(session.slotSpan, 6 - slot) : 1,
      covered: Boolean(session && !anchor),
      pause: slot === 2 && !session,
      marker: session ? '' : marker,
      fill: session?.tags.some((tag) => tag === 'DS' || /devoir surveill[eé]/iu.test(tag)) ? 'FFF2CC' : (session?.color ?? ''),
    } satisfies FormCell;
  }));
  const longest = Math.max(0, ...(program.sessions ?? []).map(sessionTextSize));
  const fontSize = Math.max(7, Math.min(10, Math.floor(10 - Math.max(0, longest - 54) / 18)));
  const warnings: string[] = [];
  if (longest > 108) warnings.push(`Le programme ${program.code} dépasse la capacité prévue sur une page, même à 7 pt.`);
  const footer = config.footerFormat === 'compact'
    ? `Emploi du temps, ${config.institution} ${academicYear}, ${config.formDate}`.trim()
    : program.footerText || `${config.institution}, le ${config.formDate}, v${program.version || '1'} A partir du Semaine du ${program.effectiveFrom || ''}`.trim();
  return {
    program: { ...program, title: safeTitle, academicYear },
    institution: config.institution,
    headerTitle: config.headerTitle, formDate: config.formDate,
    days: DAYS, slots, cells, footer, marker,
    roomColor: config.roomColor, warnings, fontSize,
    tableWidthTwips: 16838 - 500 - 500,
    columnWidthsTwips: [1500, 2389, 2389, 2389, 2389, 2389, 2393],
  };
}

export function displayRoom(session: ProgramSession): string {
  return session.roomUnassigned ? 'Salle XX' : session.room ? (/^(?:(?:salle\s+)?(?:paq|dgse)|salle\s+paq\/dgse)$/iu.test(session.room) ? 'Salle PAQ/DGSE' : (/^salle\s+/iu.test(session.room) ? session.room : `Salle ${session.room}`)) : '';
}
