import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../src/settings/settings.service.js';
import { DEFAULT_FORM_SETTINGS } from '../src/masters/form-layout.js';

describe('master form settings', () => {
  it('returns the complete shared defaults before the owner saves settings', async () => {
    const repo = { findOneBy: vi.fn().mockResolvedValue(null), save: vi.fn() };
    const service = new SettingsService(repo as never);
    expect(await service.getMastersFormSettings()).toEqual(DEFAULT_FORM_SETTINGS);
  });

  it('accepts a hash-prefixed color and rejects non-string footer formats', async () => {
    const repo = { findOneBy: vi.fn().mockResolvedValue(null), save: vi.fn(async (value) => value) };
    const service = new SettingsService(repo as never);
    const saved = await service.setMastersFormSettings({ roomColor: '#FF0000', footerFormat: 'compact' });
    expect(saved.roomColor).toBe('FF0000');
    expect(saved.formDate).toBe('');
    expect(saved.headerTitle).toBe('Emploi du Temps');
    await expect(service.setMastersFormSettings({ footerFormat: ['compact'] })).rejects.toBeInstanceOf(BadRequestException);
  });
});
