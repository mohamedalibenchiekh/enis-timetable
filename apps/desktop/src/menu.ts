import type { MenuItemConstructorOptions } from 'electron';

export interface ApplicationMenuActions {
  openGuide: () => void;
  saveGuidePdf: () => void;
  showAbout: () => void;
  checkForUpdates: () => void;
  openConfig: () => void;
  openBackups: () => void;
}

export function buildApplicationMenu(actions: ApplicationMenuActions): MenuItemConstructorOptions[] {
  return [
    { label: 'Fichier', submenu: [
      { label: 'Fichier de configuration (base de données)…', click: actions.openConfig },
      { label: 'Rechercher des mises à jour…', click: actions.checkForUpdates },
      { label: 'Ouvrir le dossier des sauvegardes', click: actions.openBackups },
      { role: 'quit', label: 'Quitter' },
    ] },
    { label: 'Édition', submenu: [{ role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' }, { role: 'selectAll', label: 'Tout sélectionner' }] },
    { label: 'Affichage', submenu: [{ role: 'reload', label: 'Recharger' }, { role: 'toggleDevTools', label: 'Outils de développement' }, { role: 'togglefullscreen', label: 'Plein écran' }] },
    { label: 'Aide', submenu: [
      { label: 'Guide d’utilisation', accelerator: 'F1', click: actions.openGuide },
      { label: 'Enregistrer le guide en PDF…', click: actions.saveGuidePdf },
      { type: 'separator' },
      { label: 'À propos', click: actions.showAbout },
    ] },
  ];
}
