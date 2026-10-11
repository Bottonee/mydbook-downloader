const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mydbook', Object.freeze({
  getState: () => ipcRenderer.invoke('app:state'),
  selectProvider: id => ipcRenderer.invoke('provider:select', id),
  login: () => ipcRenderer.invoke('provider:login'),
  disconnect: () => ipcRenderer.invoke('provider:disconnect'),
  loadBooks: data => ipcRenderer.invoke('books:load', data),
  forgetToken: () => ipcRenderer.invoke('token:forget'),
  chooseOutput: () => ipcRenderer.invoke('output:choose'),
  download: data => ipcRenderer.invoke('download:start', data),
  cancel: () => ipcRenderer.invoke('download:cancel'),
  onDownload: callback => { const listener = (_event, data) => callback(data); ipcRenderer.on('download:event', listener); return () => ipcRenderer.removeListener('download:event', listener); },
  onAccount: callback => { const listener = (_event, data) => callback(data); ipcRenderer.on('account:event', listener); return () => ipcRenderer.removeListener('account:event', listener); },
}));
