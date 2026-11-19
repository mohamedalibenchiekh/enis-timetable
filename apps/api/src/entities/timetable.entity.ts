import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { SlotLabel, SourceKind } from '../parser/types.js';

export type ImportOrigin = 'html' | 'csv' | 'pdf';

export interface SourceFileInfo {
  kind: SourceKind;
  fileName: string;
  owners: number;
  sessions: number;
  origin?: ImportOrigin;
}

@Entity('timetables')
export class Timetable {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column({ default: '' }) institution: string;
  @Column({ default: '' }) comment: string;
  @Column({ default: '' }) generatedAt: string;
  @Column('jsonb', { default: [] }) days: string[];
  @Column('jsonb', { default: [] }) slots: SlotLabel[];
  /** Every room known from the "rooms" export (also the empty ones). */
  @Column('jsonb', { default: [] }) rooms: string[];
  @Column('jsonb', { default: [] }) files: SourceFileInfo[];
  /** Older version this timetable was declared to replace ("Nouvelle version de…"). */
  @Column('uuid', { nullable: true }) previousTimetableId: string | null;
  @ManyToOne(() => Timetable, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'previousTimetableId' })
  previousTimetable: Timetable | null;
  @CreateDateColumn() createdAt: Date;
  @OneToMany(() => SessionEntity, (s) => s.timetable) sessions: SessionEntity[];
}

@Entity('sessions')
@Index(['timetableId', 'source', 'day'])
export class SessionEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column('uuid') timetableId: string;
  @ManyToOne(() => Timetable, (t) => t.sessions, { onDelete: 'CASCADE' }) timetable: Timetable;
  /** Which HTML export this row was read from. */
  @Column() source: SourceKind;
  @Column() owner: string;
  @Column('smallint') day: number;
  @Column('smallint') slot: number;
  @Column({ default: '' }) groups: string;
  @Column({ default: '' }) teachers: string;
  @Column({ default: '' }) subjectCode: string;
  @Column({ default: '' }) subject: string;
  @Column({ default: '' }) room: string;
  @Column({ default: '' }) frequency: string;
}

@Entity('settings')
export class Setting {
  @PrimaryColumn() key: string;
  @Column('jsonb') value: any;
}

abstract class NameOverride {
  @PrimaryGeneratedColumn() id: number;
  @Column('text') key: string;
  @Column({ length: 255 }) sourceName: string;
  @Column({ length: 60 }) displayName: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('teacher_names')
@Index(['key'], { unique: true })
export class TeacherName extends NameOverride {}

@Entity('room_labels')
@Index(['key'], { unique: true })
export class RoomLabel extends NameOverride {}

@Entity('known_rooms')
@Index(['name'], { unique: true })
export class KnownRoom {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 255 }) name: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() lastSeenAt: Date;
}

@Entity('programs')
@Index(['code', 'revision'], { unique: true })
export class Program {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ length: 80 }) code: string;
  @Column({ length: 255 }) title: string;
  @Column({ length: 80, default: '' }) kind: string;
  @Column({ length: 20, default: '2026-2027' }) academicYear: string;
  @Column({ length: 40, default: '' }) semester: string;
  @Column({ default: '' }) coordinator: string;
  @Column({ default: '' }) formRef: string;
  @Column({ default: '' }) effectiveFrom: string;
  @Column('text', { default: '' }) footerText: string;
  @Column({ length: 40, default: '1' }) version: string;
  @Column({ default: 1 }) revision: number;
  @Column({ default: true }) isCurrent: boolean;
  @Column('jsonb', { default: {} }) originalSnapshot: Record<string, unknown>;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
  @OneToMany(() => ProgramSlotEntity, (slot) => slot.program) slots: ProgramSlotEntity[];
  @OneToMany(() => ProgramSessionEntity, (session) => session.program) sessions: ProgramSessionEntity[];
}

@Entity('program_slots')
@Index(['programId', 'index'], { unique: true })
export class ProgramSlotEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column('uuid') programId: string;
  @ManyToOne(() => Program, (program) => program.slots, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'programId' }) program: Program;
  @Column('smallint') index: number;
  @Column() label: string;
  @Column('text') rawLabel: string;
  @Column() base: string;
  @Column('jsonb', { default: {} }) dayOverrides: Record<number, string>;
  @Column('text', { default: '' }) note: string;
}

@Entity('program_sessions')
@Index(['programId', 'day', 'slot'])
export class ProgramSessionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') programId: string;
  @ManyToOne(() => Program, (program) => program.sessions, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'programId' }) program: Program;
  @Column('smallint') day: number;
  @Column('smallint') slot: number;
  @Column('smallint', { default: 1 }) slotSpan: number;
  @Column('smallint', { default: 1 }) daySpan: number;
  @Column('text', { default: '' }) title: string;
  @Column({ default: '' }) code: string;
  @Column('jsonb', { default: [] }) teachers: string[];
  @Column('jsonb', { default: [] }) teacherKeys: string[];
  @Column('varchar', { length: 255, nullable: true }) room: string | null;
  @Column({ default: false }) roomUnassigned: boolean;
  @Column({ default: '' }) locationNote: string;
  @Column({ default: '' }) frequency: string;
  @Column('jsonb', { default: [] }) tags: string[];
  @Column('varchar', { length: 80, nullable: true }) customTime: string | null;
  @Column('varchar', { length: 6, nullable: true }) color: string | null;
  @Column('text', { default: '' }) note: string;
  @Column('text', { default: '' }) rawText: string;
  @Column('real', { default: 1 }) confidence: number;
  @Column('jsonb', { default: [] }) reasons: string[];
  @Column({ default: 'manual' }) source: 'docx' | 'pdf' | 'manual';
}

@Entity('teacher_aliases')
@Index(['aliasKey'], { unique: true })
export class TeacherAlias {
  @PrimaryGeneratedColumn() id: number;
  @Column('text') aliasKey: string;
  @Column('text') canonicalKey: string;
  @Column() aliasName: string;
  @Column() canonicalName: string;
  @Column({ default: false }) seeded: boolean;
  @CreateDateColumn() createdAt: Date;
}

@Entity('room_aliases')
@Index(['aliasKey'], { unique: true })
export class RoomAlias {
  @PrimaryGeneratedColumn() id: number;
  @Column('text') aliasKey: string;
  @Column('text') canonicalName: string;
  @Column() aliasName: string;
  @Column({ default: false }) seeded: boolean;
  @CreateDateColumn() createdAt: Date;
}
