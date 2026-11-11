import type { BrowserWindow, MessageBoxOptions } from 'electron';

type DialogApi = Pick<typeof import('electron').dialog, 'showMessageBox'>;

export function showMessageBoxWithOptionalParent(
  dialog: DialogApi,
  parent: BrowserWindow | undefined,
  options: MessageBoxOptions,
) {
  if (parent && !parent.isDestroyed()) return dialog.showMessageBox(parent, options);
  return dialog.showMessageBox(options);
}
