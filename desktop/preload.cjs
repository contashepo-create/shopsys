const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shopsysDesktop', {
  runtime: 'electron',
  database: {
    getSnapshot: (storeName) => ipcRenderer.invoke('shopsys:db:get-snapshot', storeName),
    saveSnapshot: (input) => ipcRenderer.invoke('shopsys:db:save-snapshot', input),
    deleteSnapshot: (input) => ipcRenderer.invoke('shopsys:db:delete-snapshot', input),
    enqueueOutbox: (input) => ipcRenderer.invoke('shopsys:db:enqueue-outbox', input),
    claimOutbox: (input) => ipcRenderer.invoke('shopsys:db:claim-outbox', input),
    completeOutbox: (input) => ipcRenderer.invoke('shopsys:db:complete-outbox', input),
    integrityCheck: () => ipcRenderer.invoke('shopsys:db:integrity-check'),
    schemaVersion: () => ipcRenderer.invoke('shopsys:db:schema-version'),
  },
})
