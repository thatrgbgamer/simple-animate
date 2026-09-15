'use strict';

const { app, Menu, BrowserWindow } = require('electron');

function send(command) {
  return () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send('menu:command', command);
  };
}

function buildMenu({ onOpenSite }) {
  const isMac = process.platform === 'darwin';

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [];

  if (isMac) {
    template.push({
      label: app.getName(),
      submenu: [
        { label: 'About Simple Animate', click: send('about') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  template.push({
    label: 'File',
    submenu: [
      { label: 'New Animation…', accelerator: 'CmdOrCtrl+N', click: send('new') },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open') },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
      { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as') },
      { type: 'separator' },
      { label: 'Export Video…', accelerator: 'CmdOrCtrl+E', click: send('export') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  });

  template.push({
    label: 'Edit',
    submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
      { label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: send('redo') },
      { type: 'separator' },
      { label: 'Cut', accelerator: 'CmdOrCtrl+X', click: send('cut') },
      { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: send('copy') },
      { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: send('paste') },
      { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: send('select-all') },
      { label: 'Deselect', accelerator: 'CmdOrCtrl+Shift+A', click: send('deselect') },
      { type: 'separator' },
      { label: 'Clear Frame', accelerator: 'CmdOrCtrl+Backspace', click: send('clear-frame') },
      { label: 'Canvas Size…', click: send('resize') }
    ]
  });

  template.push({
    label: 'Frame',
    submenu: [
      { label: 'Add Frame', accelerator: 'CmdOrCtrl+Right', click: send('frame-add') },
      { label: 'Duplicate Frame', accelerator: 'CmdOrCtrl+D', click: send('frame-duplicate') },
      { label: 'Delete Frame', accelerator: 'CmdOrCtrl+Delete', click: send('frame-delete') },
      { type: 'separator' },
      { label: 'Previous Frame   ,', click: send('frame-prev') },
      { label: 'Next Frame   .', click: send('frame-next') },
      { type: 'separator' },
      { label: 'Play / Pause   Space', click: send('play-toggle') },
      { label: 'Toggle Onion Skin', accelerator: 'CmdOrCtrl+Shift+O', click: send('onion-toggle') }
    ]
  });

  template.push({
    label: 'View',
    submenu: [
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: send('zoom-in') },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: send('zoom-out') },
      { label: 'Fit to Window', accelerator: 'CmdOrCtrl+0', click: send('zoom-fit') },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'toggleDevTools' }
    ]
  });

  template.push({
    role: 'help',
    submenu: [
      { label: 'thatRGB Website', click: () => onOpenSite && onOpenSite() },
      { label: 'Keyboard Shortcuts', click: send('shortcuts') },
      { label: 'About Simple Animate', click: send('about') }
    ]
  });

  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
