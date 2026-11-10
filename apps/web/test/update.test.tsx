import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backupBeforeUpgrade } from '../../desktop/src/backup';
import { assertEmbeddedDatabaseVersion, DatabaseVersionMismatchError } from '../../desktop/src/database';
import { AutoUpdater, createUpdater, UpdateDialog, UpdateInfo, UpdateProgress, UpdateStatus } from '../../desktop/src/updater';
import { UpdateBanner } from '../components/UpdateBanner';

class FakeAutoUpdater extends EventEmitter implements AutoUpdater {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  allowDowngrade = true;
  check = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
  quitAndInstall = vi.fn();

  checkForUpdates(): Promise<unknown> {
    return this.check();
  }

  emitChecking(): void {
    this.emit('checking-for-update');
  }

  emitAvailable(info: UpdateInfo): void {
    this.emit('update-available', info);
  }

  emitNotAvailable(info: UpdateInfo): void {
    this.emit('update-not-available', info);
  }

  emitProgress(progress: UpdateProgress): void {
    this.emit('download-progress', progress);
  }

  emitDownloaded(info: UpdateInfo): void {
    this.emit('update-downloaded', info);
  }
}

function createTestUpdater(overrides: {
  isPackaged?: boolean;
  enabled?: boolean;
  supportedPlatform?: boolean;
  dialogResponse?: number;
} = {}) {
  const updater = new FakeAutoUpdater();
  const dialog: UpdateDialog & { showMessageBox: ReturnType<typeof vi.fn> } = {
    showMessageBox: vi.fn().mockResolvedValue({ response: overrides.dialogResponse ?? 1 }),
  };
  const statuses: UpdateStatus[] = [];
  const stopBeforeInstall = vi.fn().mockResolvedValue(undefined);
  const service = createUpdater({
    app: { isPackaged: overrides.isPackaged ?? true, getVersion: () => '1.0.0' },
    updater,
    dialog,
    enabled: overrides.enabled ?? true,
    supportedPlatform: overrides.supportedPlatform ?? true,
    log: vi.fn(),
    sendStatus: (status) => statuses.push(status),
    openReleasePage: vi.fn().mockResolvedValue(undefined),
    stopBeforeInstall,
  });
  return { updater, dialog, statuses, service, stopBeforeInstall };
}

function tempDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'enis-update-test-'));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('update service', () => {
  it('does not check when the app is not packaged', async () => {
    const { updater, service } = createTestUpdater({ isPackaged: false });
    vi.useFakeTimers();
    service.start();
    service.onMainWindowShown();
    await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000);
    expect(updater.check).not.toHaveBeenCalled();
    expect(updater.autoDownload).toBe(false);
  });

  it('keeps automatic offline errors silent', async () => {
    const { updater, dialog, service, statuses } = createTestUpdater();
    vi.useFakeTimers();
    service.start();
    service.onMainWindowShown();
    await vi.advanceTimersByTimeAsync(20_000);
    updater.emit('error', new Error('offline'));
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(statuses).toContainEqual({ status: 'error', message: 'offline' });
  });

  it('does not check when autoUpdate is false', async () => {
    const { updater, dialog, service } = createTestUpdater({ enabled: false });
    vi.useFakeTimers();
    service.start();
    service.onMainWindowShown();
    await vi.advanceTimersByTimeAsync(20_000);
    await service.checkForUpdates(true);
    expect(updater.check).not.toHaveBeenCalled();
    expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('désactivées'),
    }));
  });

  it('shows the downloaded update dialog and does not install when Later is chosen', async () => {
    const { updater, dialog, service, statuses, stopBeforeInstall } = createTestUpdater({ dialogResponse: 1 });
    service.start();
    updater.emitAvailable({ version: '1.0.1' });
    updater.emitProgress({ percent: 45 });
    updater.emitDownloaded({ version: '1.0.1' });
    await Promise.resolve();
    expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      message: 'La version 1.0.1 est prête. Redémarrer maintenant pour l’installer ?',
      buttons: ['Redémarrer maintenant', 'Plus tard'],
    }));
    expect(statuses).toEqual([
      { status: 'available', version: '1.0.1' },
      { status: 'progress', version: '1.0.1', percent: 45 },
      { status: 'downloaded', version: '1.0.1' },
    ]);
    expect(stopBeforeInstall).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('stops services before installing when restart is chosen', async () => {
    const { updater, service, stopBeforeInstall } = createTestUpdater({ dialogResponse: 0 });
    service.start();
    updater.emitDownloaded({ version: '1.0.1' });
    await vi.waitFor(() => expect(updater.quitAndInstall).toHaveBeenCalledOnce());
    expect(stopBeforeInstall).toHaveBeenCalledOnce();
  });

  it('shows the latest-version message for a manual check', async () => {
    const { updater, dialog, service } = createTestUpdater();
    await service.checkForUpdates(true);
    updater.emitNotAvailable({ version: '1.0.0' });
    expect(dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Vous avez la dernière version.',
    }));
  });
});

describe('upgrade backup', () => {
  it('backs up existing database data when upgrading from a version without state.json', () => {
    const directory = tempDirectory();
    try {
      fs.mkdirSync(path.join(directory, 'database'));
      fs.writeFileSync(path.join(directory, 'database', 'important.db'), 'legacy data');

      const result = backupBeforeUpgrade(directory, '1.0.1', vi.fn(), {
        now: () => new Date('2026-11-10T08:30:00.000Z'),
      });

      expect(result.backupPath).toContain('database-inconnu-');
      expect(fs.readFileSync(path.join(result.backupPath!, 'important.db'), 'utf8')).toBe('legacy data');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('refuses to start a data directory from another PostgreSQL major', () => {
    const directory = tempDirectory();
    try {
      const pgData = path.join(directory, 'pgdata');
      fs.mkdirSync(pgData);
      fs.writeFileSync(path.join(pgData, 'PG_VERSION'), '17\n');
      expect(() => assertEmbeddedDatabaseVersion(directory)).not.toThrow();
      fs.writeFileSync(path.join(pgData, 'PG_VERSION'), '18\n');
      expect(() => assertEmbeddedDatabaseVersion(directory)).toThrow(DatabaseVersionMismatchError);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('backs up once when the app version changes and records the new version', () => {
    const directory = tempDirectory();
    try {
      fs.mkdirSync(path.join(directory, 'database'));
      fs.writeFileSync(path.join(directory, 'database', 'important.db'), 'user data');
      fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({ version: '1.0.0' }));
      const log = vi.fn();

      const result = backupBeforeUpgrade(directory, '1.0.1', log, { now: () => new Date('2026-11-10T08:30:00.000Z') });
      expect(result.changed).toBe(true);
      expect(result.backupPath).toBeTruthy();
      expect(fs.readFileSync(path.join(result.backupPath!, 'important.db'), 'utf8')).toBe('user data');
      expect(JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8'))).toEqual({ version: '1.0.1' });
      expect(backupBeforeUpgrade(directory, '1.0.1', log).changed).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('retains only the two newest backups', () => {
    const directory = tempDirectory();
    try {
      const backupDirectory = path.join(directory, 'backups');
      fs.mkdirSync(backupDirectory);
      for (const [name, modified] of [['database-a', 1], ['database-b', 2], ['database-c', 3]] as const) {
        const backup = path.join(backupDirectory, name);
        fs.mkdirSync(backup);
        fs.utimesSync(backup, new Date(modified), new Date(modified));
      }
      fs.mkdirSync(path.join(directory, 'database'));
      fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({ version: '1.0.0' }));

      backupBeforeUpgrade(directory, '1.0.1', vi.fn(), { now: () => new Date('2026-11-10T08:30:00.000Z') });
      const backups = fs.readdirSync(backupDirectory);
      expect(backups).toHaveLength(2);
      expect(backups).not.toContain('database-a');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('continues and reports a warning when copying the database fails', () => {
    const directory = tempDirectory();
    try {
      fs.mkdirSync(path.join(directory, 'database'));
      fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({ version: '1.0.0' }));
      const log = vi.fn();

      const result = backupBeforeUpgrade(directory, '1.0.1', log, {
        copyDirectory: () => { throw new Error('disk full'); },
      });

      expect(result.warning).toContain('a échoué');
      expect(result.backupPath).toBeUndefined();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('disk full'));
      expect(JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8'))).toEqual({ version: '1.0.1' });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('UpdateBanner', () => {
  it('renders the available, progress, and downloaded states', () => {
    const onInstall = vi.fn();
    const view = render(<UpdateBanner status={{ status: 'available', version: '1.0.1' }} onInstall={onInstall} />);
    expect(screen.getByText('Nouvelle version 1.0.1 disponible — téléchargement en cours…')).not.toBeNull();

    view.rerender(<UpdateBanner status={{ status: 'progress', version: '1.0.1', percent: 45 }} onInstall={onInstall} />);
    expect(screen.getByText('Nouvelle version 1.0.1 disponible — téléchargement 45 %…')).not.toBeNull();

    view.rerender(<UpdateBanner status={{ status: 'downloaded', version: '1.0.1' }} onInstall={onInstall} />);
    fireEvent.click(screen.getByRole('button', { name: 'Redémarrer pour installer' }));
    expect(onInstall).toHaveBeenCalledOnce();
  });
});
