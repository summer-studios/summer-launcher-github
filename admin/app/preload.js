const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('setup', { save: (token) => ipcRenderer.invoke('setup:save', token) });
