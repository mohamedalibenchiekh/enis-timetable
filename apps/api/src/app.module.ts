import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoomLabel, Setting, SessionEntity, TeacherName, Timetable } from './entities/timetable.entity.js';
import { SettingsController } from './settings/settings.controller.js';
import { SettingsService } from './settings/settings.service.js';
import { TimetablesController } from './timetables/timetables.controller.js';
import { TimetablesService } from './timetables/timetables.service.js';
import { HealthController } from './health.controller.js';
import { NamesController } from './names/names.controller.js';
import { NamesService } from './names/names.service.js';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://enis:enis@127.0.0.1:5432/enis_timetable',
      entities: [Timetable, SessionEntity, Setting, TeacherName, RoomLabel],
      synchronize: true, // desktop app with its own database: the schema follows the code
      retryAttempts: 2,
      retryDelay: 1000,
    }),
    TypeOrmModule.forFeature([Timetable, SessionEntity, Setting, TeacherName, RoomLabel]),
  ],
  controllers: [TimetablesController, SettingsController, HealthController, NamesController],
  providers: [TimetablesService, SettingsService, NamesService],
})
export class AppModule {}
