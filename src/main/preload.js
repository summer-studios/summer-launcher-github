const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('summer', {
  init: () => ipcRenderer.invoke('app:init'),
  restore: () => ipcRenderer.invoke('auth:restore'),
  login: (gamertag) => ipcRenderer.invoke('auth:login', gamertag),
  logout: () => ipcRenderer.invoke('auth:logout'),
  listInstances: () => ipcRenderer.invoke('instances:list'),
  launch: (id) => ipcRenderer.invoke('instance:launch', id),
  onInstancesUpdated: (cb) => ipcRenderer.on('instances:updated', (_e, list) => cb(list)),
  onProgress: (cb) => ipcRenderer.on('launch:progress', (_e, d) => cb(d)),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setOverride: (p) => ipcRenderer.invoke('settings:setOverride', p),
  revokeConsent: () => ipcRenderer.invoke('consent:revoke'),
  openGameFolder: () => ipcRenderer.invoke('settings:openFolder'),
  openLink: (key) => ipcRenderer.invoke('link:open', key),
});
