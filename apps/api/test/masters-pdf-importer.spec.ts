import { describe, expect, it } from 'vitest';
import { isGeneratedPdfPauseMarker } from '../src/masters/pdf-importer.js';

describe('PDF pause marker recognition', () => {
  it('filters generated pause cells individually while preserving real sessions in the lunch row', () => {
    expect(isGeneratedPdfPauseMarker(2, 'Pause', 5)).toBe(true);
    expect(isGeneratedPdfPauseMarker(2, 'Cours réel', 5)).toBe(false);
    expect(isGeneratedPdfPauseMarker(2, 'Pause', 1)).toBe(false);
    expect(isGeneratedPdfPauseMarker(1, 'Pause', 5)).toBe(false);
  });
});
