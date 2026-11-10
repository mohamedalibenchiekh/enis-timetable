import { Body, Controller, Delete, Get, ParseUUIDPipe, Put, Query, Param, Post } from '@nestjs/common';
import { NamesService } from './names.service.js';

@Controller('names')
export class NamesController {
  constructor(private readonly names: NamesService) {}

  @Get('teachers')
  teachers(@Query('timetableId', ParseUUIDPipe) timetableId: string) {
    return this.names.list('teachers', timetableId);
  }

  @Get('rooms')
  rooms(@Query('timetableId', ParseUUIDPipe) timetableId: string) {
    return this.names.list('rooms', timetableId);
  }

  @Put('teachers')
  saveTeachers(@Body() body: unknown) {
    return this.names.save('teachers', body);
  }

  @Put('rooms')
  saveRooms(@Body() body: unknown) {
    return this.names.save('rooms', body);
  }

  @Delete('teachers/:key')
  deleteTeacher(@Param('key') key: string) {
    return this.names.remove('teachers', key);
  }

  @Delete('rooms/:key')
  deleteRoom(@Param('key') key: string) {
    return this.names.remove('rooms', key);
  }

  @Get('export')
  exportNames() {
    return this.names.exportNames();
  }

  @Post('import')
  importNames(@Body() body: unknown) {
    return this.names.importNames(body);
  }
}
