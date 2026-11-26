import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { ProgramsService } from '../src/masters/programs.service.js';
import type { ProgramAnalysis } from '../src/masters/types.js';

function program(id: string, code: string): ProgramAnalysis & { id: string } {
  return {
    id, code, title: code, kind: 'Mastère', academicYear: '2026-2027', semester: '1', coordinator: '', formRef: '',
    effectiveFrom: '', footerText: '', version: '1', slots: [], sessions: [], warnings: [], confidence: 1,
    rawSnapshot: {}, source: 'docx',
  };
}

describe('program ZIP export', () => {
  it('reuses listed programs and preserves entries when sanitized codes collide', async () => {
    const rows = [
      program('550e8400-e29b-41d4-a716-446655440001', 'G/T'),
      program('550e8400-e29b-41d4-a716-446655440002', 'G-T'),
    ];
    const service = Object.assign(Object.create(ProgramsService.prototype), {
      list: vi.fn().mockResolvedValue(rows),
      settings: { getMastersFormSettings: vi.fn().mockResolvedValue(undefined) },
      get: vi.fn(),
    }) as ProgramsService;

    const archive = await service.exportZip();
    const zip = await JSZip.loadAsync(archive);
    const names = Object.keys(zip.files).filter((name) => name.endsWith('.docx'));
    expect(names).toHaveLength(2);
    expect(names[0]).not.toBe(names[1]);
    expect(names.some((name) => name.includes('550e8400'))).toBe(true);
    expect(service.list).toHaveBeenCalledTimes(1);
    expect(service.get).not.toHaveBeenCalled();
  });
});
