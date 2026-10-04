/**
 * جسر Preload (contextIsolation) — ينفذ العقد الذي ينتظره المُصيّر:
 *   • window.shopsysDesktop.database — عقد SQLite الكامل
 *     (مطابق حرفياً لـ src/data/desktopBridge.ts — المصدر: المُصيّر)
 *   • globalThis.shopsysPrint / shopsysPrinters — تعدد الطابعات (§102)
 *   • globalThis.shopsysUpdater — فحص وتثبيت التحديثات
 * لا يُكشف أي شيء من Node/Electron خارج هذه الواجهات الثلاث.
 */
import { contextBridge, ipcRenderer } from 'electron'

const database = {
  getSnapshot: (storeName: string) => ipcRenderer.invoke('database:getSnapshot', storeName),
  saveSnapshot: (input: unknown) => ipcRenderer.invoke('database:saveSnapshot', input),
  deleteSnapshot: (input: unknown) => ipcRenderer.invoke('database:deleteSnapshot', input),
  enqueueOutbox: (input: unknown) => ipcRenderer.invoke('database:enqueueOutbox', input),
  claimOutbox: (input?: unknown) => ipcRenderer.invoke('database:claimOutbox', input),
  completeOutbox: (input: unknown) => ipcRenderer.invoke('database:completeOutbox', input),
  integrityCheck: () => ipcRenderer.invoke('database:integrityCheck'),
  schemaVersion: () => ipcRenderer.invoke('database:schemaVersion'),
}

contextBridge.exposeInMainWorld('shopsysDesktop', { runtime: 'electron', database })

contextBridge.exposeInMainWorld('shopsysPrint', (html: string, silent: boolean, printerName?: string) =>
  ipcRenderer.invoke('print:print', html, silent, printerName))

contextBridge.exposeInMainWorld('shopsysPrinters', () => ipcRenderer.invoke('print:printers'))

contextBridge.exposeInMainWorld('shopsysUpdater', {
  state: () => ipcRenderer.invoke('updater:state'),
  check: () => ipcRenderer.invoke('updater:check'),
  install: () => ipcRenderer.invoke('updater:install'),
  onState: (listener: (state: unknown) => void) => {
    const wrapped = (_event: unknown, state: unknown) => listener(state)
    ipcRenderer.on('updater:state', wrapped)
    return () => ipcRenderer.removeListener('updater:state', wrapped)
  },
})

contextBridge.exposeInMainWorld('shopsysAppInfo', () => ipcRenderer.invoke('app:info'))
contextBridge.exposeInMainWorld('shopsysBackupNow', () => ipcRenderer.invoke('app:backupNow'))

/* §102 — مضيف شبكة المحل: تشغيل خادم ws + أحداث الأجهزة (المنطق في المُصيّر) */
contextBridge.exposeInMainWorld('shopsysLanHost', {
  start: (opts: { port: number }) => ipcRenderer.invoke('lan-host:start', opts),
  stop: () => ipcRenderer.invoke('lan-host:stop'),
  status: () => ipcRenderer.invoke('lan-host:status'),
  send: (payload: { connectionId: number; msg: unknown }) => ipcRenderer.invoke('lan-host:send', payload),
  onWsOpen: (listener: (e: { connectionId: number }) => void) => {
    const wrapped = (_event: unknown, e: { connectionId: number }) => listener(e)
    ipcRenderer.on('lan-host:ws-open', wrapped)
    return () => ipcRenderer.removeListener('lan-host:ws-open', wrapped)
  },
  onWsMessage: (listener: (e: { connectionId: number; msg: unknown }) => void) => {
    const wrapped = (_event: unknown, e: { connectionId: number; msg: unknown }) => listener(e)
    ipcRenderer.on('lan-host:ws-message', wrapped)
    return () => ipcRenderer.removeListener('lan-host:ws-message', wrapped)
  },
  onWsClose: (listener: (e: { connectionId: number }) => void) => {
    const wrapped = (_event: unknown, e: { connectionId: number }) => listener(e)
    ipcRenderer.on('lan-host:ws-close', wrapped)
    return () => ipcRenderer.removeListener('lan-host:ws-close', wrapped)
  },
})
