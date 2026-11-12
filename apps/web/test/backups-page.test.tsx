import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SauvegardesPage from '../app/sauvegardes/page';
import { BackupsSummary, InspectResult, RestoreResult } from '../lib/api';

const mockSummary: BackupsSummary = {
  autoBackups: [
    {
      id: 'YXV0by0x',
      fileName: 'auto-20261112-100000.enisbackup',
      createdAt: '2026-11-12T10:00:00.000Z',
      sizeBytes: 25000,
      appVersion: '1.0.6',
      schemaVersion: 1,
      counts: { timetables: 2, sessions: 150, settings: 1, teacher_names: 12, room_labels: 5 },
      isPreRestore: false,
    },
  ],
  preUpdateBackups: [
    {
      id: 'database-1.0.5-20261110',
      name: 'database-1.0.5-20261110',
      version: '1.0.5',
      createdAt: '2026-11-10T12:00:00.000Z',
      sizeBytes: 15000000,
      path: '/home/dell/.config/enis/backups/database-1.0.5-20261110',
    },
  ],
  settings: {
    enabled: true,
    retention: 10,
  },
  lastAutoBackup: {
    successAt: '2026-11-12T10:00:00.000Z',
    error: null,
  },
};

const mockInspectResult: InspectResult = {
  uploadToken: 'token-123',
  manifest: {
    formatVersion: 1,
    appVersion: '1.0.6',
    schemaVersion: 1,
    createdAt: '2026-11-12T10:00:00.000Z',
    counts: { timetables: 1, sessions: 60, settings: 1, teacher_names: 8, room_labels: 4 },
    sha256: {},
  },
  compatibility: {
    compatible: true,
    upgradeRequired: false,
    message: 'Sauvegarde compatible avec cette version.',
  },
  summary: {
    timetables: [{ id: 't1', name: 'Semestre 1', sessionCount: 60, days: ['Lundi'] }],
    teacherOverridesCount: 8,
    roomOverridesCount: 4,
    hasSettings: true,
  },
};

const mockInspectAutoResult: InspectResult = {
  id: 'YXV0by0x',
  manifest: {
    formatVersion: 1,
    appVersion: '1.0.6',
    schemaVersion: 1,
    createdAt: '2026-11-12T10:00:00.000Z',
    counts: { timetables: 1, sessions: 60, settings: 1, teacher_names: 8, room_labels: 4 },
    sha256: {},
  },
  compatibility: {
    compatible: true,
    upgradeRequired: false,
    message: 'Sauvegarde compatible avec cette version.',
  },
  summary: {
    timetables: [{ id: 't1', name: 'Semestre 1', sessionCount: 60, days: ['Lundi'] }],
    teacherOverridesCount: 8,
    roomOverridesCount: 4,
    hasSettings: true,
  },
};

const mockRestoreResult: RestoreResult = {
  ok: true,
  mode: 'replace',
  restoredCounts: { timetables: 1, sessions: 60, settings: 1, teacher_names: 8, room_labels: 4 },
  safetyBackupPath: 'auto/pre-restore-20261112.enisbackup',
};

const jsonResponse = (data: unknown, ok = true, status = 200) => ({
  ok,
  status,
  statusText: ok ? 'OK' : 'Error',
  json: async () => data,
});

describe('SauvegardesPage Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders status banner, auto backups list, and pre-update snapshots', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url === '/api/backups') return Promise.resolve(jsonResponse(mockSummary));
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    }));

    render(<SauvegardesPage />);

    expect(screen.getByText('Sauvegardes et restauration')).not.toBeNull();
    await waitFor(() => {
      expect(screen.getByText(/Dernière sauvegarde automatique :/)).not.toBeNull();
      expect(screen.getByText('auto-20261112-100000.enisbackup')).not.toBeNull();
      expect(screen.getByText('database-1.0.5-20261110')).not.toBeNull();
    });
  });

  it('saves retention settings', async () => {
    let capturedBody: unknown = null;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/backups') return Promise.resolve(jsonResponse(mockSummary));
      if (url === '/api/backups/settings' && init?.method === 'PUT') {
        capturedBody = JSON.parse(init.body as string);
        return Promise.resolve(jsonResponse({ enabled: true, retention: 20 }));
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SauvegardesPage />);
    await waitFor(() => expect(screen.getByText('auto-20261112-100000.enisbackup')).not.toBeNull());

    const retentionInput = screen.getByLabelText(/Rétention/);
    fireEvent.change(retentionInput, { target: { value: '20' } });

    const submitBtn = screen.getByRole('button', { name: 'Enregistrer les paramètres' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Paramètres de sauvegarde enregistrés.')).not.toBeNull();
    });
    expect(capturedBody).toEqual({ enabled: true, retention: 20 });
  });

  it('inspects a backup file and enables restore after confirmation checkbox in replace mode', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/backups') return Promise.resolve(jsonResponse(mockSummary));
      if (url === '/api/backups/inspect') return Promise.resolve(jsonResponse(mockInspectResult));
      if (url === '/api/backups/restore') return Promise.resolve(jsonResponse(mockRestoreResult));
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SauvegardesPage />);
    await waitFor(() => expect(screen.getByText('auto-20261112-100000.enisbackup')).not.toBeNull());

    // Upload file
    const file = new File(['fake-zip'], 'backup.enisbackup', { type: 'application/octet-stream' });
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('Détails de l’archive analysée')).not.toBeNull();
      expect(screen.getByText('Sauvegarde compatible avec cette version.')).not.toBeNull();
    });

    // In replace mode, restore button is disabled until confirmation box is checked
    const restoreBtn = screen.getByRole('button', { name: 'Restaurer les données' });
    expect((restoreBtn as HTMLButtonElement).disabled).toBe(true);

    const checkbox = screen.getByLabelText(/Je confirme vouloir remplacer toutes les données actuelles/);
    fireEvent.click(checkbox);

    expect((restoreBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(restoreBtn);

    await waitFor(() => {
      expect(screen.getByText(/Restauration terminée/)).not.toBeNull();
      expect(screen.getByText('Retourner aux emplois du temps')).not.toBeNull();
    });
  });

  it('allows merge mode restore without destructive replacement checkbox', async () => {
    let capturedRestoreBody: unknown = null;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/backups') return Promise.resolve(jsonResponse(mockSummary));
      if (url === '/api/backups/inspect') return Promise.resolve(jsonResponse(mockInspectAutoResult));
      if (url === '/api/backups/restore') {
        capturedRestoreBody = JSON.parse(init?.body as string);
        return Promise.resolve(jsonResponse({ ...mockRestoreResult, mode: 'merge' }));
      }
      return Promise.reject(new Error(`Unhandled: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SauvegardesPage />);
    await waitFor(() => expect(screen.getByText('auto-20261112-100000.enisbackup')).not.toBeNull());

    // Inspect an auto backup from table
    const restoreAutoBtn = screen.getAllByRole('button', { name: 'Restaurer' })[0];
    fireEvent.click(restoreAutoBtn);

    await waitFor(() => {
      expect(screen.getByText('Détails de l’archive analysée')).not.toBeNull();
    });

    // Select merge mode radio
    const mergeRadio = screen.getByLabelText(/Ajouter les emplois du temps de la sauvegarde/);
    fireEvent.click(mergeRadio);

    // In merge mode, replace checkbox is not rendered and button is immediately enabled
    expect(screen.queryByLabelText(/Je confirme vouloir remplacer/)).toBeNull();
    const restoreBtn = screen.getByRole('button', { name: 'Restaurer les données' });
    expect((restoreBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(restoreBtn);

    await waitFor(() => {
      expect(screen.getByText(/Restauration terminée \(Fusion\)/)).not.toBeNull();
    });

    expect(capturedRestoreBody).toEqual({ id: 'YXV0by0x', mode: 'merge' });
  });

  it('calls showInFolder when Ouvrir le dossier is clicked on pre-update backup', async () => {
    const showInFolderMock = vi.fn().mockResolvedValue(undefined);
    window.enis = {
      showInFolder: showInFolderMock,
    } as any;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(mockSummary)));

    render(<SauvegardesPage />);
    await waitFor(() => expect(screen.getByText('database-1.0.5-20261110')).not.toBeNull());

    const openFolderBtn = screen.getByRole('button', { name: 'Ouvrir le dossier' });
    fireEvent.click(openFolderBtn);

    expect(showInFolderMock).toHaveBeenCalledWith('/home/dell/.config/enis/backups/database-1.0.5-20261110');
  });
});

