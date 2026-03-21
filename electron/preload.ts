import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('forge', {
  send: (
    message: string,
    image?: { base64: string; mediaType: string; name: string },
    doc?: { base64?: string; text?: string; name: string; docType: 'pdf' | 'text' }
  ) => ipcRenderer.invoke('forge:send', message, image, doc),
  cancel: () => ipcRenderer.invoke('forge:cancel'),
  status: () => ipcRenderer.invoke('forge:status'),
  openExternal: (url: string) => ipcRenderer.invoke('forge:open-external', url),
  onLog: (callback: (log: Record<string, string>) => void) => {
    ipcRenderer.on('forge:log', (_event, log) => callback(log));
  }
});
