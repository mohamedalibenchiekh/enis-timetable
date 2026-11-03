import { Column, CreateDateColumn, Entity, Index, ManyToOne, OneToMany, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { SlotLabel, SourceKind } from '../parser/types';

export interface SourceFileInfo {
  kind: SourceKind;
  fileName: string;
  owners: number;
  sessions: number;
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
