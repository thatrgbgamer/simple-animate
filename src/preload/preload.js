'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The renderer never touches Node. Everything it is allowed to ask the main
 * process for is listed here.
 */
contextBridge.exposeInMainWorld('simpleAnimate', {
  info: () => ipcRenderer.invoke('app:info'),

  openSite: (url) => ipcRenderer.invoke('shell:open-site', url),
  revealInFolder: (targetPath) => ipcRenderer.invoke('shell:reveal', targetPath),
  messageBox: (options) => ipcRenderer.invoke('dialog:message', options),

  window: {
    setDirty: (dirty) => ipcRenderer.invoke('window:set-dirty', dirty),
    setTitle: (title) => ipcRenderer.invoke('window:set-title', title),
    forceClose: () => ipcRenderer.invoke('window:force-close')
  },

  project: {
    saveDialog: (defaultName) => ipcRenderer.invoke('project:save-dialog', defaultName),
    openDialog: () => ipcRenderer.invoke('project:open-dialog'),
    read: (filePath) => ipcRenderer.invoke('project:read', filePath),
    write: (filePath, json) => ipcRenderer.invoke('project:write', filePath, json)
  },

  exporter: {
    choosePath: (options) => ipcRenderer.invoke('export:choose-path', options),
    start: (options) => ipcRenderer.invoke('export:start', options),
    frame: (id, buffer) => ipcRenderer.invoke('export:frame', id, buffer),
    finish: (id) => ipcRenderer.invoke('export:finish', id),
    cancel: (id) => ipcRenderer.invoke('export:cancel', id),
    onEvent: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('export:event', listener);
      return () => ipcRenderer.removeListener('export:event', listener);
    }
  },

  onMenuCommand: (handler) => {
    const listener = (_event, command) => handler(command);
    ipcRenderer.on('menu:command', listener);
    return () => ipcRenderer.removeListener('menu:command', listener);
  }
});
