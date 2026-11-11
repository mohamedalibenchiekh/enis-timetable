import { normalizeName } from '../names/name-normalization.js';
import type { ActivityKeys, SessionLike } from './types.js';

const normCache = new Map<string, string>();

/** Memoized normalizeName: timetable sessions share few distinct names, so this is a big win. */
function norm(value: string): string {
  let k = normCache.get(value);
  if (k === undefined) {
    k = normalizeName(value);
    if (normCache.size < 20000) normCache.set(value, k);
  }
  return k;
}

/** Shared key function: trim, collapse spaces, lowercase, strip diacritics. */
export const nameKey = (value: string): string => norm(value);

/** Fast deterministic string comparison (localeCompare is too slow in hot sort paths). */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Key for a possibly multi-value field ("A, B" → sorted normalized tokens). JSON keeps the key injective even if a name contains the separator. */
export function listKey(value: string): string {
  return JSON.stringify(
    value
      .split(',')
      .map((part) => norm(part))
      .filter(Boolean)
      .sort(),
  );
}

export function roomKey(value: string): string {
  return norm(value);
}

export function activityKeys(session: Pick<SessionLike, 'teachers' | 'groups' | 'subjectCode' | 'subject' | 'frequency'>): ActivityKeys {
  return {
    teachersKey: listKey(session.teachers),
    groupsKey: listKey(session.groups),
    subjectCodeKey: norm(session.subjectCode),
    subjectKey: norm(session.subject),
    frequencyKey: norm(session.frequency),
  };
}

/** Full activity identity: teachers set + groups + subject code + subject + frequency. */
export function activityKey(activity: ActivityKeys): string {
  return JSON.stringify([
    activity.teachersKey,
    activity.groupsKey,
    activity.subjectCodeKey,
    activity.subjectKey,
    activity.frequencyKey,
  ]);
}
