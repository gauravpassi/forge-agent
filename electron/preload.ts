import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('forge', {
  send: (message: string) => ipcRenderer.invoke('forge:send', message),
  status: () => ipcRenderer.invoke('forge:status'),
  openExternal: (url: string) => ipcRenderer.invoke('forge:open-external', url),
  onLog: (callback: (log: { type: string; message: string }) => void) => {
    ipcRenderer.on('forge:log', (_event, log) => callback(log));
  }
});
