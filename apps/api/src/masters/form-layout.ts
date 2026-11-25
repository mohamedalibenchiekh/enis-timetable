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

const DAYS = ['Lundi', 'Mardi', 'Mercredi (M)', 'Jeudi', 'Vendredi (V)', 'Samedi (S)'];
const VALID_MARKERS = new Set(['---', '-X-', '']);

function sessionTextSize(session: ProgramSession): number {
  return `${session.title} ${session.teachers.join(' ')} ${session.room ?? ''}`.length;
}

export function buildFormLayout(program: ProgramAnalysis, settings: FormSettings = {}): FormLayout {
  const academicYear = program.academicYear || settings.academicYear || '2026-2027';
  const safeTitle = (program.title || program.code).replace(/20\d{2}\s*[-–/]\s*20\d{2}/gu, academicYear);
  const slots = Array.from({ length: 6 }, (_, index) => program.slots?.find((slot) => slot.index === index) ?? {
    index, label: '', rawLabel: '', base: '', dayOverrides: {}, note: '',
  });
  const marker = settings.emptyMarker !== undefined && VALID_MARKERS.has(settings.emptyMarker) ? settings.emptyMarker : '---';
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
  const footer = settings.footerFormat === 'compact'
    ? `Emploi du temps, ${settings.institution || 'ENISo'} ${academicYear}, ${settings.formDate || ''}`.trim()
    : program.footerText || `${settings.institution || 'ENISo'}, le ${settings.formDate || ''}, v${program.version || '1'} A partir du Semaine du ${program.effectiveFrom || ''}`.trim();
  return {
    program: { ...program, title: safeTitle, academicYear },
    institution: settings.institution || 'École Nationale d’Ingénieurs de Sousse',
    headerTitle: settings.headerTitle || 'Emploi du Temps', formDate: settings.formDate || '',
    days: DAYS, slots, cells, footer, marker,
    roomColor: settings.roomColor || 'FF0000', warnings, fontSize,
  };
}

export function displayRoom(session: ProgramSession): string {
  return session.roomUnassigned ? 'Salle XX' : session.room ? (/^(?:(?:salle\s+)?(?:paq|dgse)|salle\s+paq\/dgse)$/iu.test(session.room) ? 'Salle PAQ/DGSE' : (/^salle\s+/iu.test(session.room) ? session.room : `Salle ${session.room}`)) : '';
}
