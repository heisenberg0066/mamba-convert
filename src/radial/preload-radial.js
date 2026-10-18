'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('rapi', {
  on: (ch, cb) => ipcRenderer.on(ch, (_e, d) => cb(d)),
  send: (ch, d) => ipcRenderer.send(ch, d),
  pathFor: (f) => webUtils.getPathForFile(f),
});
