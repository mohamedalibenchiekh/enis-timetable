export function normalizeName(value: string): string {
  return value
    .replace(/[\s\u00a0]+/gu, ' ')
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

export function validateDisplayName(value: unknown, row: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`Ligne ${row} : le nom affiché doit être un texte ou vide`);
  const displayName = value.trim();
  if (!displayName) return null;
  if (displayName.length > 60) throw new Error(`Ligne ${row} : le nom affiché dépasse 60 caractères`);
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(displayName)) {
    throw new Error(`Ligne ${row} : le nom affiché contient un caractère de contrôle`);
  }
  return displayName;
}
