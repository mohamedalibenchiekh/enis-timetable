import type { MenuItemConstructorOptions } from 'electron';

export interface ApplicationMenuActions {
  openGuide: () => void;
  saveGuidePdf: () => void;
  showAbout: () => void;
  checkForUpdates: () => void;
  openConfig: () => void;
  openBackups: () => void;
  openBackupsScreen: () => void;
  showChangelog: () => void;
}

export function buildApplicationMenu(actions: ApplicationMenuActions): MenuItemConstructorOptions[] {
  return [
    { label: 'Fichier', submenu: [
      { label: 'Sauvegardes\u2026', click: actions.openBackupsScreen },
      { label: 'Fichier de configuration (base de donn\u00e9es)\u2026', click: actions.openConfig },
      { label: 'Rechercher des mises \u00e0 jour\u2026', click: actions.checkForUpdates },
      { label: 'Ouvrir le dossier des sauvegardes', click: actions.openBackups },
      { role: 'quit', label: 'Quitter' },
    ] },
    { label: '\u00c9dition', submenu: [{ role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' }, { role: 'selectAll', label: 'Tout s\u00e9lectionner' }] },
    { label: 'Affichage', submenu: [{ role: 'reload', label: 'Recharger' }, { role: 'toggleDevTools', label: 'Outils de d\u00e9veloppement' }, { role: 'togglefullscreen', label: 'Plein \u00e9cran' }] },
    { label: 'Aide', submenu: [
      { label: 'Guide d\u2019utilisation', accelerator: 'F1', click: actions.openGuide },
      { label: 'Enregistrer le guide en PDF\u2026', click: actions.saveGuidePdf },
      { type: 'separator' },
      { label: 'Nouveaut\u00e9s\u2026', click: actions.showChangelog },
      { type: 'separator' },
      { label: '\u00c0 propos', click: actions.showAbout },
    ] },
  ];
}
