const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yuza', {
  login: () => ipcRenderer.invoke('login'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setServer: (url) => ipcRenderer.invoke('set-server', url),
  focus: () => ipcRenderer.send('focus-window'),
});
