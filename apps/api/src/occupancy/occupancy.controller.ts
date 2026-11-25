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
    @Query('customTime') customTime?: string,
  ) {
    const span = slotSpan ? parseInt(slotSpan, 10) : 1;
    if (isNaN(span) || span < 1) throw new BadRequestException('slotSpan invalide.');
    return this.service.getFreeRooms(day, slot, against, {
      slotSpan: span,
      customTime: customTime || null,
      targetBloc,
    });
  }
}
