const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shopsysDesktop', {
  runtime: 'electron',
  database: {
    getSnapshot: (storeName) => ipcRenderer.invoke('shopsys:db:get-snapshot', storeName),
    saveSnapshot: (input) => ipcRenderer.invoke('shopsys:db:save-snapshot', input),
    integrityCheck: () => ipcRenderer.invoke('shopsys:db:integrity-check'),
    schemaVersion: () => ipcRenderer.invoke('shopsys:db:schema-version'),
  },
})
