import { formatTeacher, roomLabel } from './formatters.js';
import { normalizeName } from '../names/name-normalization.js';

export interface NameResolver {
  teacher(sourceName: string, abbreviateBen: boolean): string;
  room(sourceName: string): string;
}

export function createNameResolver(
  teacherOverrides: ReadonlyMap<string, string>,
  roomOverrides: ReadonlyMap<string, string>,
): NameResolver {
  return {
    teacher: (sourceName, abbreviateBen) =>
      teacherOverrides.get(normalizeName(sourceName)) ?? formatTeacher(sourceName, abbreviateBen),
    room: (sourceName) => roomOverrides.get(normalizeName(sourceName)) ?? roomLabel(sourceName),
  };
}
