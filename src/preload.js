'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { pathToFileURL } = require('url');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  pathFor: (file) => webUtils.getPathForFile(file),
  fileUrl: (p) => pathToFileURL(p).href,
  getSettings: inv('get-settings'), setSettings: inv('set-settings'),
  pickFiles: inv('pick-files'), pickFolder: inv('pick-folder'), catalog: inv('catalog'), describe: inv('describe'),
  imagePreview: inv('image-preview'), imageInfo: inv('image-info'), probe: inv('probe'), videoFrame: inv('video-frame'), pdfPages: inv('pdf-pages'),
  enqueue: inv('enqueue'), cancel: inv('cancel'), retry: inv('retry'), showItem: inv('show-item'), openPath: inv('open-path'), openOutputFolder: inv('open-output-folder'),
  onJob: (cb) => ipcRenderer.on('job-update', (_e, d) => cb(d)),
});
