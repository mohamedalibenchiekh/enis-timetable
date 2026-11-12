import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupCreator } from '../src/backups/backup-creator.js';
import { BackupSchedulerService } from '../src/backups/backup-scheduler.js';
import { Clock } from '../src/backups/backup-types.js';

class FakeClock implements Clock {
  private currentTime = new Date('2026-11-12T10:00:00.000Z').getTime();
  private timers: { id: number; due: number; handler: () => void }[] = [];
  private nextId = 1;

  now(): Date {
    return new Date(this.currentTime);
  }

  setTimeout(handler: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.push({ id, due: this.currentTime + ms, handler });
    return id;
  }

  clearTimeout(id: number): void {
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  advance(ms: number): void {
    this.currentTime += ms;
    const ready = this.timers.filter((t) => t.due <= this.currentTime);
    this.timers = this.timers.filter((t) => t.due > this.currentTime);
    for (const t of ready) {
      t.handler();
    }
  }

  pendingCount(): number {
    return this.timers.length;
  }
}

describe('BackupSchedulerService with fake timers', () => {
  let tmpDir: string;
  let fakeClock: FakeClock;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enis-test-backups-'));
    fakeClock = new FakeClock();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('debounces data-change notifications by 30 seconds', async () => {
    let backupCalls = 0;
    const fakeDataSource = {} as any;
    const scheduler = new BackupSchedulerService(
      fakeDataSource,
      tmpDir,
      '1.0.6',
      async () => ({ enabled: true, retention: 10 }),
      fakeClock,
    );

    // Mock triggerAutoBackup to avoid real DB queries in unit test
    scheduler.triggerAutoBackup = async () => {
      backupCalls++;
      return 'path';
    };

    // 1st change
    scheduler.notifyDataChanged();
    expect(fakeClock.pendingCount()).toBe(1);

    // Advance 10s -> should not have fired yet
    fakeClock.advance(10_000);
    expect(backupCalls).toBe(0);

    // 2nd change (resets debounce)
    scheduler.notifyDataChanged();
    expect(fakeClock.pendingCount()).toBe(1);

    // Advance 25s (total 35s since start, but only 25s since last change)
    fakeClock.advance(25_000);
    expect(backupCalls).toBe(0);

    // Advance another 5s (total 30s since 2nd change) -> fires!
    fakeClock.advance(5_000);
    expect(backupCalls).toBe(1);
    expect(fakeClock.pendingCount()).toBe(0);
  });

  it('triggers startup backup when no backup exists or oldest is > 24h', async () => {
    let backupCalls = 0;
    const fakeDataSource = {} as any;
    const scheduler = new BackupSchedulerService(
      fakeDataSource,
      tmpDir,
      '1.0.6',
      async () => ({ enabled: true, retention: 10 }),
      fakeClock,
    );
    scheduler.triggerAutoBackup = async () => {
      backupCalls++;
      return 'path';
    };

    // 1. Empty auto dir -> should trigger
    const triggered1 = await scheduler.checkStartupBackup();
    expect(triggered1).toBe(true);
    expect(backupCalls).toBe(1);

    // 2. Add an auto backup file 2 hours old
    const autoDir = path.join(tmpDir, 'auto');
    fs.mkdirSync(autoDir, { recursive: true });
    const recentBackup = path.join(autoDir, 'auto-recent.enisbackup');
    fs.writeFileSync(recentBackup, 'fake');
    // Set mtime to 2h ago
    const twoHoursAgo = (fakeClock.now().getTime() - 2 * 3600 * 1000) / 1000;
    fs.utimesSync(recentBackup, twoHoursAgo, twoHoursAgo);

    const triggered2 = await scheduler.checkStartupBackup();
    expect(triggered2).toBe(false);
    expect(backupCalls).toBe(1); // not incremented

    // 3. Advance clock by 23 hours (now 25 hours old) -> should trigger!
    fakeClock.advance(23 * 3600 * 1000);
    const triggered3 = await scheduler.checkStartupBackup();
    expect(triggered3).toBe(true);
    expect(backupCalls).toBe(2);
  });

  it('prunes auto backups according to retention limit', () => {
    const autoDir = path.join(tmpDir, 'auto');
    fs.mkdirSync(autoDir, { recursive: true });

    // Create 6 dummy auto backups with increasing timestamps
    for (let i = 1; i <= 6; i++) {
      const file = path.join(autoDir, `auto-20261112-10000${i}.enisbackup`);
      fs.writeFileSync(file, 'data');
      const time = (fakeClock.now().getTime() + i * 1000) / 1000;
      fs.utimesSync(file, time, time);
    }

    const scheduler = new BackupSchedulerService(
      {} as any,
      tmpDir,
      '1.0.6',
      async () => ({ enabled: true, retention: 4 }),
      fakeClock,
    );

    scheduler.pruneOldBackups(4);

    const remaining = fs.readdirSync(autoDir);
    expect(remaining.length).toBe(4);
    // Oldest files (01 and 02) should be pruned
    expect(remaining).not.toContain('auto-20261112-100001.enisbackup');
    expect(remaining).not.toContain('auto-20261112-100002.enisbackup');
    expect(remaining).toContain('auto-20261112-100005.enisbackup');
    expect(remaining).toContain('auto-20261112-100006.enisbackup');
  });

  it('cleans stale temp files at start', () => {
    const autoDir = path.join(tmpDir, 'auto');
    fs.mkdirSync(autoDir, { recursive: true });
    const stale1 = path.join(autoDir, '.tmp-auto-partial.enisbackup');
    const stale2 = path.join(autoDir, 'temp-file.tmp');
    const normal = path.join(autoDir, 'auto-good.enisbackup');

    fs.writeFileSync(stale1, 'partial');
    fs.writeFileSync(stale2, 'partial');
    fs.writeFileSync(normal, 'good');

    BackupCreator.cleanStaleTempFiles(tmpDir);

    expect(fs.existsSync(stale1)).toBe(false);
    expect(fs.existsSync(stale2)).toBe(false);
    expect(fs.existsSync(normal)).toBe(true);
  });
});

