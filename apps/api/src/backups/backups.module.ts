import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  RoomLabel,
  SessionEntity,
  Setting,
  TeacherName,
  Timetable,
} from '../entities/timetable.entity.js';
import { BackupsController } from './backups.controller.js';
import { BackupsService } from './backups.service.js';
import { MaintenanceGuard, MaintenanceService } from './maintenance.guard.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Timetable,
      SessionEntity,
      Setting,
      TeacherName,
      RoomLabel,
    ]),
  ],
  controllers: [BackupsController],
  providers: [BackupsService, MaintenanceService, MaintenanceGuard],
  exports: [BackupsService, MaintenanceService, MaintenanceGuard],
})
export class BackupsModule {}

