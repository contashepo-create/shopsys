/**
 * جسر Preload (contextIsolation) — ينفذ العقد الذي ينتظره المُصيّر:
 *   • window.shopsysDesktop.database — عقد SQLite الكامل
 *     (مطابق حرفياً لـ src/data/desktopBridge.ts — المصدر: المُصيّر)
 *   • globalThis.shopsysPrint / shopsysPrinters — تعدد الطابعات (§102)
 *   • globalThis.shopsysUpdater — فحص التحديثات يدوياً وحالة التنزيل (شريط التقدم)
 * لا يُكشف أي شيء من Node/Electron خارج هذه الواجهات.
 */
import { contextBridge, ipcRenderer } from 'electron'

const database = {
  getEncryptionKey: (): Promise<Uint8Array | null> => ipcRenderer.invoke('device:getEncryptionKey'),
  getSnapshot: (storeName: string) => ipcRenderer.invoke('database:getSnapshot', storeName),
  saveSnapshot: (input: unknown) => ipcRenderer.invoke('database:saveSnapshot', input),
  deleteSnapshot: (input: unknown) => ipcRenderer.invoke('database:deleteSnapshot', input),
  enqueueOutbox: (input: unknown) => ipcRenderer.invoke('database:enqueueOutbox', input),
  claimOutbox: (input?: unknown) => ipcRenderer.invoke('database:claimOutbox', input),
  completeOutbox: (input: unknown) => ipcRenderer.invoke('database:completeOutbox', input),
  integrityCheck: () => ipcRenderer.invoke('database:integrityCheck'),
  schemaVersion: () => ipcRenderer.invoke('database:schemaVersion'),
  /* نوافذ الأقمار الحرة: إشعار «نافذة أخرى حفظت لقطة» لتطبيق أحدث حالة فوراً */
  onSnapshotChanged: (listener: (e: { storeName: string; revision: number }) => void) => {
    const wrapped = (_event: unknown, e: { storeName: string; revision: number }) => listener(e)
    ipcRenderer.on('database:snapshot-changed', wrapped)
    return () => ipcRenderer.removeListener('database:snapshot-changed', wrapped)
  },
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
  retryStartup: (): Promise<boolean> => ipcRenderer.invoke('keyRecovery:retry-startup'),
  startFresh: () => ipcRenderer.invoke('keyRecovery:start-fresh'),
}

const persistence = {
  onFlush: (listener: () => Promise<void>): void => {
    ipcRenderer.on('persistence:flush', (_event, token: string) => {
      void Promise.resolve().then(listener).then(
        () => ipcRenderer.invoke('persistence:flushed', token, null),
        (error: unknown) => ipcRenderer.invoke('persistence:flushed', token, error instanceof Error ? error.message : String(error)),
      )
    })
  },
  onResume: (listener: () => void): void => { ipcRenderer.on('persistence:resume', () => listener()) },
}
/* نوافذ الأقمار الحرة (قرار المالك 2026-10-22): إنشاء نوافذ نظام مستقلة لكل
   قسم/مستند/منتقٍ، وقناة ردود النداء بين القمر وأمه، ومصافحة الإغلاق الآمنة.
   العقد الكامل في desktop/satelliteWindows.ts ونظيره في src/data/desktopBridge.ts */
const windows = {
  open: (input: unknown) => ipcRenderer.invoke('windows:open', input),
  openSection: (input: { path: string; title: string }) => ipcRenderer.invoke('windows:open-section', input),
  claim: (token: string) => ipcRenderer.invoke('windows:claim', token),
  list: () => ipcRenderer.invoke('windows:list'),
  invokeProp: (input: { requestId: string; prop: string; args: unknown[] }) => ipcRenderer.send('windows:prop-invoke', input),
  closeSelf: () => ipcRenderer.send('windows:close-self'),
  requestClose: (windowId: string) => ipcRenderer.send('windows:request-close', windowId),
  focus: (windowId: string) => ipcRenderer.send('windows:focus', windowId),
  minimize: (windowId?: string) => ipcRenderer.send('windows:minimize', windowId),
  toggleMaximize: (windowId?: string) => ipcRenderer.send('windows:toggle-maximize', windowId),
  setTitle: (title: string) => ipcRenderer.send('windows:set-title', { title }),
  setDirty: (dirty: boolean) => ipcRenderer.send('windows:set-dirty', dirty),
  respondClose: (token: string, allow: boolean) => ipcRenderer.send('windows:close-response', { token, allow }),
  onPropInvoke: (listener: (e: { requestId: string; prop: string; args: unknown[] }) => void) => {
    const wrapped = (_event: unknown, e: { requestId: string; prop: string; args: unknown[] }) => listener(e)
    ipcRenderer.on('windows:prop-invoke', wrapped)
    return () => ipcRenderer.removeListener('windows:prop-invoke', wrapped)
  },
  onRequestClose: (listener: (e: { token: string }) => void) => {
    const wrapped = (_event: unknown, e: { token: string }) => listener(e)
    ipcRenderer.on('windows:request-close', wrapped)
    return () => ipcRenderer.removeListener('windows:request-close', wrapped)
  },
  onNavigate: (listener: (e: { path: string }) => void) => {
    const wrapped = (_event: unknown, e: { path: string }) => listener(e)
    ipcRenderer.on('windows:navigate', wrapped)
    return () => ipcRenderer.removeListener('windows:navigate', wrapped)
  },
  onRegistry: (listener: (entries: unknown[]) => void) => {
    const wrapped = (_event: unknown, entries: unknown[]) => listener(entries)
    ipcRenderer.on('windows:registry', wrapped)
    return () => ipcRenderer.removeListener('windows:registry', wrapped)
  },
}

contextBridge.exposeInMainWorld('shopsysDesktop', { runtime: 'electron', database, databaseStorage, notifications, keyRecovery, persistence, windows })

contextBridge.exposeInMainWorld('shopsysPrint', (html: string, silent: boolean, printerName?: string) =>
  ipcRenderer.invoke('print:print', html, silent, printerName))

contextBridge.exposeInMainWorld('shopsysPrinters', () => ipcRenderer.invoke('print:printers'))

/* v1.0.13 — إرسال مستند PDF عبر واتساب: يولّد الملف بالسطح المكتب ويفتح المحادثة */
contextBridge.exposeInMainWorld('shopsysPdfShare', (html: string, fileName: string, waLink?: string) =>
  ipcRenderer.invoke('pdf:export-share', html, fileName, waLink))

/* واجهة التحديث اليدوية: زر «فحص التحديثات» + شريط التنزيل (كما كان قبل التحديث الصامت).
   الفحص الدوري الخلفي والتثبيت الصامت عند الإغلاق يبقيان في العملية الرئيسية بلا تغيير. */
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

/* بند 2 (طلب المالك): هوية الجهاز خارج القاعدة — تُقرأ تزامنياً عند الإقلاع
   (قبل فحص الترخيص) ⇒ معرّف الجهاز لا يتغيّر بمسح القاعدة ولا بفقد مرساة Chromium. */
contextBridge.exposeInMainWorld('shopsysDeviceIdentity', (candidate?: { deviceId?: string; firstTrialAt?: string }) =>
  ipcRenderer.sendSync('device:identity', candidate))

/* بند 5 (طلب المالك): قناة الدعم — الطلب من العملية الرئيسية (بلا Origin ⇒ لا
   رفض من سياسة المصدر في نسخة سطح المكتب file://)، والاعتماد يُحفظ خارج القاعدة
   ليبقى ثابتاً (الخادم يربط الاعتماد بالجهاز مرة واحدة ⇒ اعتماد جديد = رفض دائم). */
contextBridge.exposeInMainWorld('shopsysSupport', {
  request: (args: { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }) => ipcRenderer.invoke('support:request', args),
  getToken: () => ipcRenderer.invoke('support:tokenGet'),
  setToken: (token: string) => ipcRenderer.invoke('support:tokenSet', token),
})

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
