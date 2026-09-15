'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeImage } = require('electron');
const exporter = require('./exporter');
const { buildMenu } = require('./menu');

const SITE_URL = 'https://thatrgb.website/';
const PROJECT_EXTENSION = 'sanim';

/** @type {BrowserWindow | null} */
let mainWindow = null;
let isDirty = false;
let forceClose = false;

function isAllowedExternal(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'thatrgb.website' || host.endsWith('.thatrgb.website');
  } catch (err) {
    return false;
  }
}

function appIcon() {
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
  if (!fs.existsSync(iconPath)) return undefined;
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? undefined : image;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#12141a',
    show: false,
    icon: appIcon(),
    title: 'Simple Animate',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // Links never navigate the app itself — the site button opens a real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (isAllowedExternal(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('close', (event) => {
    if (forceClose || !isDirty) return;
    event.preventDefault();

    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved changes',
      message: 'Save your animation before closing?',
      detail: 'Any frames you drew since the last save will be lost.'
    });

    if (choice === 1) {
      forceClose = true;
      mainWindow.close();
    } else if (choice === 0) {
      mainWindow.webContents.send('menu:command', 'save-and-close');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  Menu.setApplicationMenu(buildMenu({ siteUrl: SITE_URL, onOpenSite: () => shell.openExternal(SITE_URL) }));
}

/* ------------------------------------------------------------------ IPC --- */

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  name: app.getName(),
  platform: process.platform,
  siteUrl: SITE_URL,
  electron: process.versions.electron,
  documentsPath: safeDocumentsPath()
}));

function safeDocumentsPath() {
  try {
    return app.getPath('documents');
  } catch (err) {
    return app.getPath('home');
  }
}

ipcMain.handle('shell:open-site', (_event, url) => {
  const target = url && isAllowedExternal(url) ? url : SITE_URL;
  return shell.openExternal(target);
});

ipcMain.handle('shell:reveal', (_event, targetPath) => {
  if (typeof targetPath === 'string' && targetPath) shell.showItemInFolder(targetPath);
});

ipcMain.handle('window:set-dirty', (_event, dirty) => {
  isDirty = Boolean(dirty);
  if (mainWindow && process.platform === 'darwin') mainWindow.setDocumentEdited(isDirty);
});

ipcMain.handle('window:set-title', (_event, title) => {
  if (mainWindow) mainWindow.setTitle(title || 'Simple Animate');
});

ipcMain.handle('window:force-close', () => {
  forceClose = true;
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('project:save-dialog', async (_event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save animation',
    defaultPath: path.join(safeDocumentsPath(), `${sanitizeName(defaultName)}.${PROJECT_EXTENSION}`),
    filters: [{ name: 'Simple Animate project', extensions: [PROJECT_EXTENSION] }]
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('project:open-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open animation',
    properties: ['openFile'],
    filters: [{ name: 'Simple Animate project', extensions: [PROJECT_EXTENSION] }]
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  return { filePath, json: await fs.promises.readFile(filePath, 'utf8') };
});

ipcMain.handle('project:read', async (_event, filePath) => {
  return { filePath, json: await fs.promises.readFile(filePath, 'utf8') };
});

ipcMain.handle('project:write', async (_event, filePath, json) => {
  // Write to a sibling temp file first so a failure never truncates the
  // previous save.
  const tmp = `${filePath}.tmp-${process.pid}`;
  await fs.promises.writeFile(tmp, json, 'utf8');
  await fs.promises.rename(tmp, filePath);
  return { filePath };
});

ipcMain.handle('export:choose-path', async (_event, { format, defaultName, extension }) => {
  if (format === 'png-sequence') {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a folder for the PNG sequence',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return path.join(result.filePaths[0], sanitizeName(defaultName));
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export animation',
    defaultPath: path.join(safeDocumentsPath(), `${sanitizeName(defaultName)}.${extension}`),
    filters: [{ name: extension.toUpperCase() + ' video', extensions: [extension] }]
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('export:start', (event, options) => {
  return exporter.startExport(options, (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send('export:event', payload);
  });
});

ipcMain.handle('export:frame', async (_event, id, buffer) => exporter.writeFrame(id, buffer));
ipcMain.handle('export:finish', async (_event, id) => exporter.finishExport(id));
ipcMain.handle('export:cancel', (_event, id) => exporter.cancelExport(id));

ipcMain.handle('dialog:message', async (_event, options) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: options.type || 'info',
    title: options.title || 'Simple Animate',
    message: options.message || '',
    detail: options.detail || '',
    buttons: options.buttons || ['OK'],
    defaultId: options.defaultId || 0,
    cancelId: typeof options.cancelId === 'number' ? options.cancelId : undefined
  });
  return result.response;
});

function sanitizeName(name) {
  const cleaned = String(name || 'animation').replace(/[\\/:*?"<>|]/g, '-').trim();
  return cleaned || 'animation';
}

/* ------------------------------------------------------------- lifecycle -- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.on('window-all-closed', () => {
  exporter.cancelAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  exporter.cancelAll();
});

// Block any attempt to attach a preload or open a window we did not create.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
});
