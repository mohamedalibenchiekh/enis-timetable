import { describe, expect, it } from 'vitest';
import {
  areSessionsOverlapping,
  buildOccupancyState,
  canonicalTeacherKey,
  detectConflicts,
  findBestRoom,
  findFreeRooms,
  findFreeSlots,
  parseCustomTime,
  resolveCanonicalRoom,
} from '../src/occupancy/index.js';

describe('Occupancy and Conflict Engine', () => {
  describe('Room and Teacher Normalization', () => {
    it('resolves "Salle PAQ" and "Salle DGSE" to the same canonical room "PAQ/DGSE"', () => {
      const paq = resolveCanonicalRoom('Salle PAQ');
      const dgse = resolveCanonicalRoom('Salle DGSE');
      const barePaq = resolveCanonicalRoom('paq');
      const bareDgse = resolveCanonicalRoom('dgse');

      expect(paq.canonicalRoom).toBe('PAQ/DGSE');
      expect(dgse.canonicalRoom).toBe('PAQ/DGSE');
      expect(barePaq.canonicalRoom).toBe('PAQ/DGSE');
      expect(bareDgse.canonicalRoom).toBe('PAQ/DGSE');
      expect(paq.roomUnassigned).toBe(false);
    });

    it('identifies "Salle XX", "XX", "Salle ??", "Salle xx" as roomUnassigned placeholders', () => {
      for (const variant of ['Salle XX', 'XX', 'Salle ??', 'Salle xx', '??', 'Salle à rechercher']) {
        const res = resolveCanonicalRoom(variant);
        expect(res.roomUnassigned).toBe(true);
        expect(res.canonicalRoom).toBeNull();
      }
    });

    it('resolves teacher written in reverse order to the exact same key without confirmation', () => {
      const key1 = canonicalTeacherKey('Martin Alice');
      const key2 = canonicalTeacherKey('ALICE Martin');
      const key3 = canonicalTeacherKey('  alice   MARTIN  ');

      expect(key1).toBe('alice martin');
      expect(key2).toBe('alice martin');
      expect(key3).toBe('alice martin');
    });

    it('ignores generic teacher tokens like "Externes", "Internes", "Externes + internes"', () => {
      expect(canonicalTeacherKey('Externes')).toBeNull();
      expect(canonicalTeacherKey('Internes')).toBeNull();
      expect(canonicalTeacherKey('Externes + internes')).toBeNull();
      expect(canonicalTeacherKey('Intervenant')).toBeNull();
      expect(canonicalTeacherKey('-')).toBeNull();
    });
  });

  describe('Custom Time and Overlap Calculation', () => {
    it('parses custom time intervals in minutes from midnight', () => {
      const t1 = parseCustomTime('10H30 - 12H30');
      expect(t1).toEqual({ start: 630, end: 750 });

      const t2 = parseCustomTime('14:00 - 15:30');
      expect(t2).toEqual({ start: 840, end: 930 });
    });

    it('checks overlap between sessions with custom times', () => {
      // 10:30-12:30 vs 12:00-13:00 -> overlap from 12:00 to 12:30
      expect(
        areSessionsOverlapping(0, 1, 1, '10H30 - 12H30', 0, 2, 1, '12:00 - 13:00'),
      ).toBe(true);

      // 10:30-11:30 vs 11:30-12:30 -> no overlap (touching boundary)
      expect(
        areSessionsOverlapping(0, 1, 1, '10H30 - 11H30', 0, 1, 1, '11:30 - 12:30'),
      ).toBe(false);

      // Different days -> never overlap
      expect(
        areSessionsOverlapping(0, 1, 1, '10H30 - 12H30', 1, 1, 1, '10H30 - 12H30'),
      ).toBe(false);
    });
  });

  describe('Conflict Detection', () => {
    it('detects room_double_booked when two different sessions occupy the same room at the same time', () => {
      const state = buildOccupancyState(
        [
          { id: 'fet-1', day: 0, slot: 0, room: 'A 0-2', subject: 'Automatique', teachers: 'Prof Alpha' },
        ],
        [
          { id: 'prog-1', day: 0, slot: 0, room: 'A02', title: 'Systèmes Temps Réel', teachers: ['Prof Beta'], programCode: 'GT-M1' },
        ],
      );

      const conflicts = detectConflicts(state);
      const roomConflicts = conflicts.filter((c) => c.type === 'room_double_booked');
      expect(roomConflicts).toHaveLength(1);
      expect(roomConflicts[0].resource).toBe('A 0-2');
      expect(roomConflicts[0].message).toContain('réservée simultanément');
    });

    it('detects conflict between "Salle PAQ" and "Salle DGSE" in the same slot', () => {
      const state = buildOccupancyState(
        [],
        [
          { id: 'prog-1', day: 1, slot: 2, room: 'Salle PAQ', title: 'Séance 1', programCode: 'GT-M1' },
          { id: 'prog-2', day: 1, slot: 2, room: 'Salle DGSE', title: 'Séance 2', programCode: 'I4DE-M1' },
        ],
      );

      const conflicts = detectConflicts(state);
      const roomConflicts = conflicts.filter((c) => c.type === 'room_double_booked');
      expect(roomConflicts).toHaveLength(1);
      expect(roomConflicts[0].resource).toBe('PAQ/DGSE');
    });

    it('does NOT report conflict for two "Salle XX" sessions in the same slot', () => {
      const state = buildOccupancyState(
        [],
        [
          { id: 'prog-1', day: 2, slot: 1, room: 'Salle XX', title: 'Séance A', programCode: 'GT-M1' },
          { id: 'prog-2', day: 2, slot: 1, room: 'Salle XX', title: 'Séance B', programCode: 'GT-M2' },
        ],
      );

      const conflicts = detectConflicts(state);
      const roomDouble = conflicts.filter((c) => c.type === 'room_double_booked');
      expect(roomDouble).toHaveLength(0);

      const toFind = conflicts.filter((c) => c.type === 'room_to_find');
      expect(toFind).toHaveLength(2);
    });

    it('same-activity exception: two parallel sessions of the same activity do NOT conflict', () => {
      const state = buildOccupancyState(
        [
          { id: 'fet-1', day: 0, slot: 3, room: 'Amphi', subject: 'Mathématiques', teachers: 'Prof Gamma', groups: 'G1' },
          { id: 'fet-2', day: 0, slot: 3, room: 'Amphi', subject: 'Mathématiques', teachers: 'Prof Gamma', groups: 'G2' },
        ],
        [],
      );

      const conflicts = detectConflicts(state);
      expect(conflicts).toHaveLength(0);
    });

    it('detects teacher_double_booked conflict', () => {
      const state = buildOccupancyState(
        [
          { id: 'fet-1', day: 3, slot: 1, room: 'A 0-1', subject: 'Thermodynamique', teachers: 'Dupont Jean' },
        ],
        [
          { id: 'prog-1', day: 3, slot: 1, room: 'B 1-2', title: 'Transferts thermiques', teachers: ['Jean DUPONT'], programCode: 'MasTech-M1' },
        ],
      );

      const conflicts = detectConflicts(state);
      const teacherConflicts = conflicts.filter((c) => c.type === 'teacher_double_booked');
      expect(teacherConflicts).toHaveLength(1);
      expect(teacherConflicts[0].message).toContain('Dupont Jean');
    });

    it('ignores generic teachers for teacher_double_booked', () => {
      const state = buildOccupancyState(
        [
          { id: 'fet-1', day: 4, slot: 3, room: 'A 0-1', subject: 'Séminaire', teachers: 'Externes' },
        ],
        [
          { id: 'prog-1', day: 4, slot: 3, room: 'B 1-2', title: 'Conférence', teachers: ['Externes + internes'], programCode: 'GT-M1' },
        ],
      );

      const conflicts = detectConflicts(state);
      const teacherConflicts = conflicts.filter((c) => c.type === 'teacher_double_booked');
      expect(teacherConflicts).toHaveLength(0);
    });

    it('reports room_missing when room is empty and not marked à rechercher', () => {
      const state = buildOccupancyState(
        [],
        [
          { id: 'prog-1', day: 0, slot: 0, room: '', roomUnassigned: false, title: 'Séance sans salle', programCode: 'GT-M1' },
        ],
      );

      const conflicts = detectConflicts(state);
      const missing = conflicts.filter((c) => c.type === 'room_missing');
      expect(missing).toHaveLength(1);
      expect(missing[0].severity).toBe('warning');
    });

    it('reports room_unknown for non-FET, non-seeded rooms (informational only)', () => {
      const state = buildOccupancyState(
        [],
        [
          { id: 'prog-1', day: 0, slot: 0, room: 'EH5', title: 'Cours externe', programCode: 'GT-M1' },
        ],
      );

      const conflicts = detectConflicts(state);
      const unknown = conflicts.filter((c) => c.type === 'room_unknown');
      expect(unknown).toHaveLength(1);
      expect(unknown[0].severity).toBe('info');
      expect(unknown[0].message).toContain('hors FET');
    });

    it('guarantees symmetric conflict results regardless of session input order', () => {
      const s1 = { id: 'prog-1', day: 1, slot: 0, room: 'A 0-1', title: 'Cours 1', programCode: 'GT-M1' };
      const s2 = { id: 'prog-2', day: 1, slot: 0, room: 'A 0-1', title: 'Cours 2', programCode: 'GT-M2' };

      const stateForward = buildOccupancyState([], [s1, s2]);
      const conflictsForward = detectConflicts(stateForward);

      const stateReverse = buildOccupancyState([], [s2, s1]);
      const conflictsReverse = detectConflicts(stateReverse);

      expect(conflictsForward.map((c) => c.id)).toEqual(conflictsReverse.map((c) => c.id));
      expect(conflictsForward.map((c) => c.message)).toEqual(conflictsReverse.map((c) => c.message));
    });

    it('produces deterministic ordering of conflicts', () => {
      const state = buildOccupancyState(
        [],
        [
          { id: 'p3', day: 2, slot: 1, room: 'A 0-1', title: 'C', programCode: 'GT-M1' },
          { id: 'p4', day: 2, slot: 1, room: 'A 0-1', title: 'D', programCode: 'GT-M2' },
          { id: 'p1', day: 0, slot: 4, room: 'B 0-1', title: 'A', programCode: 'GT-M1' },
          { id: 'p2', day: 0, slot: 4, room: 'B 0-1', title: 'B', programCode: 'GT-M2' },
        ],
      );

      const conflicts = detectConflicts(state);
      expect(conflicts[0].day).toBe(0);
      expect(conflicts[1].day).toBe(2);
    });
  });

  describe('Suggestions: freeRooms, freeSlots, bestRoomFor', () => {
    it('freeRooms returns only rooms that are not occupied at that slot, with target bloc prioritized', () => {
      const state = buildOccupancyState(
        [
          { day: 0, slot: 0, room: 'A 0-1' },
          { day: 0, slot: 0, room: 'A 0-2' },
        ],
        [],
      );

      const free = findFreeRooms(0, 0, state, { targetBloc: 'Bloc A' });
      const freeNames = free.map((r) => r.room);

      expect(freeNames).not.toContain('A 0-1');
      expect(freeNames).not.toContain('A 0-2');
      expect(freeNames).toContain('A 0-3');
      // Bloc A rooms should appear first
      expect(free[0].bloc).toBe('Bloc A');
    });

    it('moving a session to a slot returned by findFreeSlots never creates a conflict', () => {
      const session = {
        id: 'moving-session',
        day: 0,
        slot: 0,
        slotSpan: 1,
        daySpan: 1,
        room: 'A 0-1',
        title: 'Séance à déplacer',
        teachers: ['Prof Delta'],
        programCode: 'GT-M1',
      };

      const otherSessions = [
        { id: 'other-1', day: 0, slot: 1, room: 'A 0-1', title: 'Autre', programCode: 'GT-M2' },
        { id: 'other-2', day: 1, slot: 0, teachers: ['Prof Delta'], title: 'Autre enseignant', programCode: 'GT-M2' },
      ];

      const state = buildOccupancyState([], [session, ...otherSessions]);
      const normalizedSession = state.sessions.find((s) => s.id === 'moving-session')!;

      const freeSlots = findFreeSlots(normalizedSession, state);
      expect(freeSlots.length).toBeGreaterThan(0);

      // Verify each suggested free slot does not create a conflict
      for (const slotCandidate of freeSlots.slice(0, 5)) {
        const movedSession = { ...session, day: slotCandidate.day, slot: slotCandidate.slot };
        const testState = buildOccupancyState([], [movedSession, ...otherSessions]);
        const testConflicts = detectConflicts(testState);
        const relevantConflicts = testConflicts.filter(
          (c) => c.severity === 'error' && c.sessions.some((s) => s.id === 'moving-session'),
        );
        expect(relevantConflicts).toHaveLength(0);
      }
    });

    it('findBestRoom never returns a busy room', () => {
      const state = buildOccupancyState(
        [
          { day: 1, slot: 1, room: 'A 0-1' },
          { day: 1, slot: 1, room: 'A 0-2' },
          { day: 1, slot: 1, room: 'A 0-3' },
        ],
        [
          { id: 'unassigned-1', day: 1, slot: 1, room: 'Salle XX', title: 'Cours XX', programCode: 'GT-M1' },
        ],
      );

      const session = state.sessions.find((s) => s.id === 'unassigned-1')!;
      const best = findBestRoom(session, state);

      expect(best).not.toBeNull();
      expect(['A 0-1', 'A 0-2', 'A 0-3']).not.toContain(best);
    });

    it('recomputing conflicts after an undo restores the exact original conflict set', () => {
      const initialProgram = [
        { id: 's1', day: 0, slot: 0, room: 'A 0-1', title: 'C1', programCode: 'GT-M1' },
      ];
      const state1 = buildOccupancyState([], initialProgram);
      const conflicts1 = detectConflicts(state1);

      // Mutate: move into conflict
      const mutatedProgram = [
        { id: 's1', day: 0, slot: 1, room: 'A 0-1', title: 'C1', programCode: 'GT-M1' },
        { id: 's2', day: 0, slot: 1, room: 'A 0-1', title: 'C2', programCode: 'GT-M2' },
      ];
      const state2 = buildOccupancyState([], mutatedProgram);
      const conflicts2 = detectConflicts(state2);
      expect(conflicts2.some((c) => c.type === 'room_double_booked')).toBe(true);

      // Undo: restore initial
      const state3 = buildOccupancyState([], initialProgram);
      const conflicts3 = detectConflicts(state3);
      expect(conflicts3).toEqual(conflicts1);
    });
  });

  describe('Performance Guard (<100 ms for 3,000 sessions)', () => {
    it('indexes and detects conflicts for 3,000 sessions in under 100 ms', () => {
      const fetSessions = [];
      const programSessions = [];
      const rooms = Array.from({ length: 60 }, (_, i) => `A ${Math.floor(i / 10)}-${i % 10}`);
      const teachers = Array.from({ length: 120 }, (_, i) => `Professeur Test${i}`);

      for (let i = 0; i < 1500; i++) {
        fetSessions.push({
          id: `fet-${i}`,
          day: i % 6,
          slot: Math.floor(i / 6) % 6,
          room: rooms[i % rooms.length],
          teachers: teachers[i % teachers.length],
          subject: `Matiere ${i % 40}`,
        });
      }

      for (let i = 0; i < 1500; i++) {
        programSessions.push({
          id: `prog-${i}`,
          day: i % 6,
          slot: Math.floor(i / 6) % 6,
          room: rooms[(i + 1) % rooms.length],
          teachers: [teachers[(i + 1) % teachers.length]],
          title: `Cours mastère ${i % 50}`,
          programCode: `PROG-${i % 7}`,
        });
      }

      // Warm up V8 JIT compiler
      const warmupState = buildOccupancyState(fetSessions.slice(0, 300), programSessions.slice(0, 300));
      detectConflicts(warmupState);

      const state = buildOccupancyState(fetSessions, programSessions);
      const start = performance.now();
      const conflicts = detectConflicts(state);
      const duration = performance.now() - start;

      expect(conflicts.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(100);
    });
  });
});
