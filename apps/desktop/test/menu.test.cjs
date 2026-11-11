const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildApplicationMenu } = require('../dist/menu.js');

test('Aide menu exposes the guide on F1, PDF export, and À propos actions', () => {
  const calls = [];
  const actions = Object.fromEntries(['openGuide', 'saveGuidePdf', 'showAbout', 'checkForUpdates', 'openConfig', 'openBackups']
    .map((name) => [name, () => calls.push(name)]));
  const menu = buildApplicationMenu(actions);
  const help = menu.find((item) => item.label === 'Aide');
  assert.ok(help && Array.isArray(help.submenu));
  const guide = help.submenu.find((item) => item.label === 'Guide d’utilisation');
  const pdf = help.submenu.find((item) => item.label === 'Enregistrer le guide en PDF…');
  const about = help.submenu.find((item) => item.label === 'À propos');
  assert.equal(guide.accelerator, 'F1');
  guide.click();
  pdf.click();
  about.click();
  assert.deepEqual(calls, ['openGuide', 'saveGuidePdf', 'showAbout']);
});
