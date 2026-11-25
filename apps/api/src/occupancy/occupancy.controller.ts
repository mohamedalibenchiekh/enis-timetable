import {
  BadRequestException,
  Controller,
  Get,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ProgramsService } from '../masters/programs.service.js';

@Controller('conflicts')
export class ConflictsController {
  constructor(private readonly service: ProgramsService) {}

  @Get()
  getAllConflicts(@Query('against') against?: string) {
    return this.service.getConflicts(undefined, against);
  }
}

@Controller('occupancy')
export class OccupancyController {
  constructor(private readonly service: ProgramsService) {}

  @Get('free-rooms')
  getFreeRooms(
    @Query('day', ParseIntPipe) day: number,
    @Query('slot', ParseIntPipe) slot: number,
    @Query('against') against?: string,
    @Query('targetBloc') targetBloc?: string,
    @Query('slotSpan') slotSpan?: string,
    @Query('daySpan') daySpan?: string,
    @Query('customTime') customTime?: string,
  ) {
    if (day < 0 || day > 5 || slot < 0 || slot > 5) {
      throw new BadRequestException('Jour ou créneau invalide.');
    }
    const span = slotSpan ? parseInt(slotSpan, 10) : 1;
    const dSpan = daySpan ? parseInt(daySpan, 10) : 1;
    if (isNaN(span) || span < 1 || span > 6 - slot) {
      throw new BadRequestException('slotSpan dépasse les limites de la grille.');
    }
    if (isNaN(dSpan) || dSpan < 1 || dSpan > 6 - day) {
      throw new BadRequestException('daySpan dépasse les limites de la grille.');
    }
    return this.service.getFreeRooms(day, slot, against, {
      slotSpan: span,
      daySpan: dSpan,
      customTime: customTime || null,
      targetBloc,
    });
  }
}
