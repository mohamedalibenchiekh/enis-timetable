import { contextBridge, ipcRenderer } from 'electron';

// Minimal, explicit bridge: the web UI never gets direct access to Node or the file system.
contextBridge.exposeInMainWorld('enis', {
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('choose-folder'),
  showInFolder: (p: string): Promise<void> => ipcRenderer.invoke('show-in-folder', p),
});
