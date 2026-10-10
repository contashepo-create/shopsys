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
  getEncryptionKey: (): Promise<Uint8Array> => ipcRenderer.invoke('device:getEncryptionKey'),
  getSnapshot: (storeName: string) => ipcRenderer.invoke('database:getSnapshot', storeName),
  saveSnapshot: (input: unknown) => ipcRenderer.invoke('database:saveSnapshot', input),
  deleteSnapshot: (input: unknown) => ipcRenderer.invoke('database:deleteSnapshot', input),
  enqueueOutbox: (input: unknown) => ipcRenderer.invoke('database:enqueueOutbox', input),
  claimOutbox: (input?: unknown) => ipcRenderer.invoke('database:claimOutbox', input),
  completeOutbox: (input: unknown) => ipcRenderer.invoke('database:completeOutbox', input),
  integrityCheck: () => ipcRenderer.invoke('database:integrityCheck'),
  schemaVersion: () => ipcRenderer.invoke('database:schemaVersion'),
}

/* v1.0.8: إدارة مكان قاعدة البيانات والنسخ الاحتياطية المزدوجة (طلب المالك) */
const databaseStorage = {
  getStorageInfo: () => ipcRenderer.invoke('database:getStorageInfo'),
  chooseDbLocation: () => ipcRenderer.invoke('database:chooseDbLocation'),
  chooseSecondaryBackupDir: () => ipcRenderer.invoke('database:chooseSecondaryBackupDir'),
  /* v1.0.9: درع البيانات — استرداد تلقائي + استعادة نسخة ملفية من داخل التطبيق */
  recoveryNotice: () => ipcRenderer.invoke('database:recoveryNotice'),
  listFileBackups: () => ipcRenderer.invoke('database:listFileBackups'),
  restoreFileBackup: (path: string) => ipcRenderer.invoke('database:restoreFileBackup', { path }),
  /* v1.0.22: نسخة كاملة من القاعدة بحوار حفظ (تنزيل SQLite) */
  exportCopy: () => ipcRenderer.invoke('database:exportCopy'),
}

/* بند 10 (تدقيق 2026-10-08): إشعار نظام التشغيل لتنبيهات المطوّر المهمة/العاجلة.
   يمر عبر IPC فقط — لا يُكشف Notification ولا أي API آخر للمُصيّر. */
const notifications = {
  show: (title: string, body: string): Promise<boolean> => ipcRenderer.invoke('notify:show', { title, body }),
}

/* v1.0.22: مفتاح الاسترداد — تصدير بكلمة مرور واستيراد عند فقدان المفتاح */
const keyRecovery = {
  status: () => ipcRenderer.invoke('keyRecovery:status'),
  export: (args: { passphrase: string; deviceId: string }) => ipcRenderer.invoke('keyRecovery:export', args),
  import: (args: { passphrase: string }) => ipcRenderer.invoke('keyRecovery:import', args),
}

contextBridge.exposeInMainWorld('shopsysDesktop', { runtime: 'electron', database, databaseStorage, notifications, keyRecovery })

contextBridge.exposeInMainWorld('shopsysPrint', (html: string, silent: boolean, printerName?: string) =>
  ipcRenderer.invoke('print:print', html, silent, printerName))

contextBridge.exposeInMainWorld('shopsysPrinters', () => ipcRenderer.invoke('print:printers'))

/* v1.0.13 — إرسال مستند PDF عبر واتساب: يولّد الملف بالسطح المكتب ويفتح المحادثة */
contextBridge.exposeInMainWorld('shopsysPdfShare', (html: string, fileName: string, waLink?: string) =>
  ipcRenderer.invoke('pdf:export-share', html, fileName, waLink))

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

/* v1.0.8: مرساة التجربة خارج القاعدة — تمنع إعادة التجربة بمسح البيانات */
contextBridge.exposeInMainWorld('shopsysTrialAnchor', (args: { firstTrialAt?: string; lastSeenAt?: string }) => ipcRenderer.invoke('trial:anchor', args ?? {}))

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
