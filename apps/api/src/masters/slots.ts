import { ProgramSlot } from './types.js';

export const DEFAULT_PROGRAM_REFERENCE = {
  slots: ['08:30-10:00', '10:15-11:45', '12:00-13:00', '13:00-14:30', '14:45-16:15', '16:30-18:00'],
  dayOverrides: { 3: { 4: '14:00-15:30' } },
} as const;
export const DEFAULT_PROGRAM_SLOTS = DEFAULT_PROGRAM_REFERENCE.slots;
export const DAY_CODES = ['L', 'M', 'Me', 'J', 'V', 'S'] as const;

export interface ParsedSlotLabel { base: string; overrides: Record<number, string>; }
const normTime = (value: string) => value.replace(/[.]/gu, ':').replace(/\s+/gu, '').replace(/(\d{1,2}):(\d{2})/gu, (_m, h: string, m: string) => `${h.padStart(2, '0')}:${m}`);

export function parseSlotLabel(raw: string): ParsedSlotLabel {
  const text = raw.replace(/\(\s*Rat\s*\)/giu, '').replace(/\s+/gu, ' ').trim();
  const timePattern = '(\\d{1,2}\\s*[:.]\\s*\\d{2}\\s*[-–]\\s*\\d{1,2}\\s*[:.]\\s*\\d{2})';
  const matches = [...text.matchAll(new RegExp(`(?:\\(\\s*([^():]+?)\\s*[:.]?\\s*)?${timePattern}\\s*\\)?`, 'giu'))];
  if (matches.length === 0) throw new Error(`Libellé de créneau illisible : ${raw}`);
  const overrides: Record<number, string> = {};
  let base = '';
  for (const m of matches) {
    const time = normTime(m[2]);
    const scope = (m[1] ?? '').toLocaleLowerCase('fr');
    if (!scope) { base = time; continue; }
    if (!base) base = time;
    const days = new Set<number>();
    if (/\b(?:l|lun|lundi)\b/u.test(scope)) days.add(0);
    if (/(?:^|[^a-z])m(?:$|[^a-z])|\bmardi\b/u.test(scope)) days.add(1);
    if (/\b(?:me|merc|mercredi)\b/u.test(scope)) days.add(2);
    if (/\b(?:j|jeu|jeudi)\b/u.test(scope)) days.add(3);
    if (/\b(?:v|ven|vendredi)\b/u.test(scope)) days.add(4);
    if (/\b(?:s|sam|samedi)\b/u.test(scope)) days.add(5);
    for (const day of days) overrides[day] = time;
  }
  return { base, overrides };
}

export function normalizeProgramSlots(rawLabels: string[], reference: readonly string[] = DEFAULT_PROGRAM_SLOTS, referenceOverrides: Record<number, Record<number, string>> = DEFAULT_PROGRAM_REFERENCE.dayOverrides): { slots: ProgramSlot[]; warnings: string[] } {
  const warnings: string[] = [];
  const slots = rawLabels.slice(0, 6).map((rawLabel, index) => {
    let parsed: ParsedSlotLabel;
    try { parsed = parseSlotLabel(rawLabel); }
    catch { parsed = { base: reference[index] ?? '', overrides: {} }; warnings.push(`Créneau ${index + 1} illisible, valeur de référence appliquée.`); }
    const dayOverrides: Record<number, string> = {};
    for (const [dayText, value] of Object.entries(parsed.overrides)) {
      const day = Number(dayText);
      const expected = referenceOverrides[index]?.[day] ?? (day === 4 && index === 3 && reference[index] === DEFAULT_PROGRAM_REFERENCE.slots[index]
        ? DEFAULT_PROGRAM_REFERENCE.dayOverrides[3][4]
        : reference[index] ?? '');
      if (value === expected) continue;
      if (day === 4 && index === 3 && expected === DEFAULT_PROGRAM_REFERENCE.dayOverrides[3][4]) {
        warnings.push(`Libellé du vendredi corrigé : ${value} → ${expected}`);
        dayOverrides[day] = expected;
      } else if (referenceOverrides[index]?.[day]) {
        warnings.push(`Libellé du ${['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][day]} corrigé : ${value} → ${expected}`);
        dayOverrides[day] = expected;
      } else if (day === 4) {
        warnings.push(`Libellé du vendredi à confirmer : ${value}`);
        dayOverrides[day] = value;
      } else {
        dayOverrides[day] = value;
      }
    }
    if (!Object.keys(parsed.overrides).length && parsed.base && parsed.base !== reference[index]) {
      if (index === 3 && reference[index] === '14:00-15:30') warnings.push(`Libellé du vendredi corrigé : ${parsed.base} → ${reference[index]}`);
      parsed.base = reference[index] ?? parsed.base;
    }
    const base = (Object.keys(parsed.overrides).length ? reference[index] : parsed.base) || reference[index] || '';
    return { index, label: base, rawLabel, base, dayOverrides, note: '' };
  });
  while (slots.length < 6) {
    const index = slots.length;
    slots.push({ index, label: reference[index], rawLabel: reference[index], base: reference[index], dayOverrides: {}, note: '' });
  }
  return { slots, warnings: [...new Set(warnings)] };
}

