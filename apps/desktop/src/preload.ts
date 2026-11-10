import { contextBridge, ipcRenderer } from 'electron';
import type { UpdateStatus } from './updater';

const UPDATE_STATUS_NAMES: Record<UpdateStatus['status'], true> = {
  checking: true,
  available: true,
  progress: true,
  downloaded: true,
  error: true,
  none: true,
};

function isUpdateStatus(value: unknown): value is UpdateStatus {
  if (!value || typeof value !== 'object' || !('status' in value)
    || typeof value.status !== 'string' || !Object.hasOwn(UPDATE_STATUS_NAMES, value.status)) return false;
  const status = value as UpdateStatus;
  switch (status.status) {
    case 'checking':
    case 'none':
      return true;
    case 'available':
    case 'downloaded':
      return typeof status.version === 'string';
    case 'progress':
      return typeof status.version === 'string' && typeof status.percent === 'number'
        && Number.isFinite(status.percent) && status.percent >= 0 && status.percent <= 100;
    case 'error':
      return typeof status.message === 'string';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

// Minimal, explicit bridge: the web UI never gets direct access to Node or the file system.
contextBridge.exposeInMainWorld('enis', {
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('choose-folder'),
  showInFolder: (p: string): Promise<void> => ipcRenderer.invoke('show-in-folder', p),
  getVersion: (): Promise<string> => ipcRenderer.invoke('get-version'),
  getUpdateStatus: (): Promise<UpdateStatus | null> => ipcRenderer.invoke('get-update-status'),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('check-for-updates'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    if (typeof callback !== 'function') throw new TypeError('Le rappel de mise à jour doit être une fonction.');
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isUpdateStatus(value)) callback(value);
    };
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
});
