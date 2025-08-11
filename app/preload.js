const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getSources: ()=> ipcRenderer.invoke('get-sources'),
  sendFrame: (payload)=> ipcRenderer.send('frame', payload),
  bookmark: (label)=> ipcRenderer.send('bookmark', label),
});