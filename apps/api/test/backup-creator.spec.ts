import { describe, expect, it, vi } from 'vitest';
import { BackupCreator } from '../src/backups/backup-creator.js';

describe('BackupCreator', () => {
  it('uses a stable id tie-breaker for program sessions', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const creator = new BackupCreator({} as never);

    await (creator as unknown as { readTableRows: (manager: { query: typeof query }, table: 'program_sessions') => Promise<unknown[]> })
      .readTableRows({ query }, 'program_sessions');

    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM program_sessions ORDER BY "programId" ASC, day ASC, slot ASC, id ASC',
    );
  });
});
