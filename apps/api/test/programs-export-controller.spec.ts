import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parseProgramExportIds } from '../src/masters/programs.controller.js';

describe('program export ids', () => {
  it('accepts omitted ids and comma-separated canonical UUIDs', () => {
    expect(parseProgramExportIds(undefined)).toBeUndefined();
    expect(parseProgramExportIds('550e8400-e29b-41d4-a716-446655440000,6ba7b810-9dad-41d1-80b4-00c04fd430c8'))
      .toEqual(['550e8400-e29b-41d4-a716-446655440000', '6ba7b810-9dad-41d1-80b4-00c04fd430c8']);
  });

  it('rejects repeated query keys and malformed UUIDs with a 400', () => {
    expect(() => parseProgramExportIds(['550e8400-e29b-41d4-a716-446655440000'])).toThrow(BadRequestException);
    expect(() => parseProgramExportIds('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toThrow(BadRequestException);
    expect(() => parseProgramExportIds('550e8400e29b41d4a716446655440000')).toThrow(BadRequestException);
  });
});
