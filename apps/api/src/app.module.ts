import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Setting, SessionEntity, Timetable } from './entities/timetable.entity';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { TimetablesController } from './timetables/timetables.controller';
import { TimetablesService } from './timetables/timetables.service';
import { HealthController } from './health.controller';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://enis:enis@127.0.0.1:5432/enis_timetable',
      entities: [Timetable, SessionEntity, Setting],
      synchronize: true, // desktop app with its own database: the schema follows the code
      retryAttempts: 2,
      retryDelay: 1000,
    }),
    TypeOrmModule.forFeature([Timetable, SessionEntity, Setting]),
  ],
  controllers: [TimetablesController, SettingsController, HealthController],
  providers: [TimetablesService, SettingsService],
})
export class AppModule {}
