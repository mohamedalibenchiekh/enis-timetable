import { expandToSlots } from './cell-parser.js';
import { ProgramSession } from './types.js';

export interface FetSessionForConflict { day: number; slot: number; room: string; teachers: string[]; }
export interface ProgramConflict { day: number; slot: number; type: 'room' | 'teacher'; resource: string; title: string; }

const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
const tokenKey = (value: string) => [...new Set(normalize(value).split(' ').filter(Boolean))].sort().join(' ');

export function detectProgramConflicts(
  sessions: ProgramSession[],
  fetSessions: FetSessionForConflict[],
  roomAliases: Record<string, string> = {},
  teacherAliases: Record<string, string> = {},
): ProgramConflict[] {
  const canonicalRoom = (room: string) => normalize(roomAliases[normalize(room)] ?? room);
  const canonicalTeacher = (teacher: string) => tokenKey(teacherAliases[normalize(teacher)] ?? teacher);
  const conflicts: ProgramConflict[] = [];
  for (const session of sessions) {
    for (const cell of expandToSlots(session)) {
      for (const fet of fetSessions) {
        if (fet.day !== cell.day || fet.slot !== cell.slot) continue;
        if (!session.roomUnassigned && session.room && fet.room && canonicalRoom(session.room) === canonicalRoom(fet.room)) {
          conflicts.push({ day: cell.day, slot: cell.slot, type: 'room', resource: session.room, title: session.title });
        }
        for (const teacher of session.teachers) {
          if (fet.teachers.some((fetTeacher) => canonicalTeacher(fetTeacher) === canonicalTeacher(teacher))) {
            conflicts.push({ day: cell.day, slot: cell.slot, type: 'teacher', resource: teacher, title: session.title });
          }
        }
      }
    }
  }
  return conflicts;
}

