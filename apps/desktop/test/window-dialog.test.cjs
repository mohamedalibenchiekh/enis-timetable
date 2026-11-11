const { test } = require('node:test');
const assert = require('node:assert/strict');
const { showMessageBoxWithOptionalParent } = require('../dist/window-dialog.js');

test('shows an error dialog without a parent if the window was destroyed', async () => {
  const calls = [];
  const dialog = { showMessageBox: (...args) => { calls.push(args); return Promise.resolve({ response: 0 }); } };
  const options = { type: 'error', message: 'PDF export failed' };

  await showMessageBoxWithOptionalParent(dialog, { isDestroyed: () => true }, options);

  assert.deepEqual(calls, [[options]]);
});

test('parents an error dialog to the live application window', async () => {
  const calls = [];
  const dialog = { showMessageBox: (...args) => { calls.push(args); return Promise.resolve({ response: 0 }); } };
  const parent = { isDestroyed: () => false };
  const options = { type: 'error', message: 'PDF export failed' };

  await showMessageBoxWithOptionalParent(dialog, parent, options);

  assert.deepEqual(calls, [[parent, options]]);
});
