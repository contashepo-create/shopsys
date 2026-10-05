/**
 * عملية Electron الرئيسية — تنفيذ «مرحلة القاعدة المحلية» (وثيقة §101):
 *   • القاعدة: userData/shopsys.db عبر better-sqlite3 (WAL) — كاتب واحد
 *   • الجسور: shopsysDesktop.database (عقد المُصيّر القائم) + shopsysPrint
 *     وshopsysPrinters (§102 تعدد الطابعات) + shopsysUpdater
 *   • التحديث: electron-updater من GitHub Releases — فحص عند الإقلاع وزر يدوي
 *   • النسخ الدوّارة: ساعي 24 · يومي 30 · أسبوعي 12 (Backup API الساخنة)
 * لا منطق أعمال هنا إطلاقاً — كل البوابات تعمل في المُصيّر كما هي.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { ShopsysDatabase, type OutboxEventDto, type SaveSnapshotInput, type SnapshotDto } from './sqlite/storage.ts'
import { initLanHostIpc } from './hostServerMain.ts'

type ClaimOutboxInput = { now?: string; limit?: number }
type DeleteSnapshotInput = { storeName: string; expectedRevision: number }
type EnqueueOutboxInput = Parameters<ShopsysDatabase['enqueueOutbox']>[0]
type CompleteOutboxInput = Parameters<ShopsysDatabase['completeOutbox']>[0]

/* eslint-disable no-console */

let mainWindow: BrowserWindow | null = null
let database: ShopsysDatabase | null = null
let deviceEncryptionKey: Buffer = Buffer.alloc(0)
let printWindow: BrowserWindow | null = null

const isDev = !!process.env.ELECTRON_START_URL

/* ── سجل تشخيصي ملفي (بلاغ v1.0.0: شاشة بيضاء بلا أثر) — كل حدث مهم يُكتب
      في userData/main.log ليتحقق منه الدعم الفني على جهاز العميل ── */
function logLine(tag: string, message: string): void {
  const stamp = new Date().toISOString()
  const line = `[${stamp}] [${tag}] ${message}\n`
  /* eslint-disable no-console */
  console.log(`[shopsys] ${line.trim()}`)
  try {
    appendFileSync(join(app.getPath('userData'), 'main.log'), line, 'utf8')
  } catch {
    /* مجلد المستخدم غير جاهز بعد — السطر طُبع على المخرجات فقط */
  }
}

/** صفحة خطأ عربية مضمّنة بدل الشاشة البيضاء — تعرض سبب الفشل ومسار السجل */
function errorPageHtml(reason: string, logPath: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>تَحَكَّم — تعذّر التحميل</title>
<style>body{font-family:Tahoma,Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{max-width:560px;padding:32px;background:#1e293b;border:1px solid #334155;border-radius:16px}
h1{font-size:20px;color:#f87171;margin:0 0 12px}p{font-size:14px;line-height:1.9;margin:8px 0}
code{background:#0f172a;padding:2px 8px;border-radius:6px;font-size:12px;color:#7dd3fc;direction:ltr;display:inline-block;max-width:100%;word-break:break-all}
.hint{color:#94a3b8;font-size:12px}</style></head><body><div class="card">
<h1>⚠ تعذّر تحميل واجهة التطبيق</h1>
<p>السبب المسجَّل: <b>${esc(reason)}</b></p>
<p>تفاصيل التشخيص محفوظة في ملف السجل:<br><code>${esc(logPath)}</code></p>
<p class="hint">أرسل ملف السجل هذا للدعم الفني وسيتابع فوراً — بياناتك المحلية سليمة ولم تتأثر.</p>
</div></body></html>`
}

function showLoadError(win: BrowserWindow, reason: string): void {
  const logPath = join(app.getPath('userData'), 'main.log')
  logLine('load-error', reason)
  const html = errorPageHtml(reason, logPath)
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => undefined)
}

/* ── النافذة ── */
function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 640,
    title: 'تَحَكَّم',
    autoHideMenuBar: true,
    icon: join(__dirname, '../dist/app-icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  /* قنوات التشخيص الميداني: فشل التحميل يعرض صفحة خطأ عربية بدل شاشة بيضاء،
     وأخطاء المُصيّر تُسجَّل في main.log — أين المشكلة يصبح معروفاً فوراً */
  win.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame) return
    showLoadError(win, `فشل تحميل الصفحة (${code}): ${desc} — ${failedUrl}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    logLine('renderer-gone', `reason=${details.reason} exitCode=${details.exitCode}`)
    showLoadError(win, `توقف محرك الواجهة (${details.reason} / ${details.exitCode})`)
  })
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) logLine('renderer-console', `${message} (${sourceId}:${line})`)
  })
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    logLine('preload-error', `${preloadPath}: ${error}`)
  })
  if (isDev) void win.loadURL(process.env.ELECTRON_START_URL!)
  else {
    void win.loadFile(join(__dirname, '../dist/index.html')).catch((err: unknown) => {
      showLoadError(win, `loadFile: ${(err as Error).message}`)
    })
  }
  return win
}

/* ── مفتاح تشفير الجهاز (v1.0.7 — تشفير قاعدة البيانات بمفتاح الجهاز) ──
   يولَّد مرة واحدة في userData/device.key (32 بايت عشوائية). لقطات المتاجر
   تُشفَّر بـ AES-GCM في المُصيّر قبل وصولها إلى SQLite عبر IPC، فتُقرأ القاعدة
   على هذا الجهاز فقط — نسخ shopsys.db إلى جهاز آخر يعطي بيانات غير قابلة
   للفك. اللقطات النصية القديمة تُقرأ كما هي وتُرحَّل مشفرة عند أول حفظ. */
function ensureDeviceEncryptionKey(): Buffer {
  const keyPath = join(app.getPath('userData'), 'device.key')
  try {
    const existing = readFileSync(keyPath)
    if (existing.length === 32) return existing
    logLine('device-key', `ملف مفتاح بحجم غير متوقع (${existing.length}) — يُستبدل`)
  } catch { /* لا ملف بعد — أول تشغيل */ }
  const key = randomBytes(32)
  writeFileSync(keyPath, key, { mode: 0o600 })
  logLine('device-key', `وُلّد مفتاح تشفير الجهاز (${keyPath})`)
  return key
}

/* ── القاعدة ── */
async function openDatabase(): Promise<ShopsysDatabase> {
  const dbPath = join(app.getPath('userData'), 'shopsys.db')
  try {
    const db = await ShopsysDatabase.open(dbPath, { backupsDir: join(app.getPath('userData'), 'backups') })
    logLine('db', `قاعدة SQLite جاهزة: ${dbPath} (مخطط ${db.schemaVersion()})`)
    return db
  } catch (error) {
    const message = (error as Error).message
    logLine('db-fatal', `فشل فتح القاعدة (${dbPath}): ${message}`)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dialog } = require('electron') as typeof import('electron')
    dialog.showErrorBox('تَحَكَّم — فشل تشغيل القاعدة', `تعذّر فتح قاعدة البيانات:\n${message}\n\nسجل التشخيص:\n${join(app.getPath('userData'), 'main.log')}`)
    app.exit(1)
    throw error
  }
}

/* ── الطباعة (§102): نسخة إلى طابعة مسماة أو الافتراضية، صامتة أو بحوار ── */
async function printHtml(html: string, silent: boolean, printerName?: string): Promise<void> {
  const tmp = join(app.getPath('userData'), 'print-tmp.html')
  writeFileSync(tmp, html, 'utf8')
  if (!printWindow || printWindow.isDestroyed()) {
    printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } })
  }
  await new Promise<void>((resolve) => {
    printWindow!.webContents.once('did-finish-load', () => resolve())
    void printWindow!.loadFile(tmp)
  })
  await printWindow.webContents.print({ silent, deviceName: printerName || undefined, printBackground: true, margins: { marginType: 'default' } }, () => undefined)
}

async function listPrinters(): Promise<string[]> {
  const win = mainWindow ?? printWindow ?? createMainWindow()
  /* Electron 34+: getPrinters صارت وعداً (getPrintersAsync سابقاً ثم getPrinters) */
  const printers = await win.webContents.getPrintersAsync()
  return printers.map((printer) => printer.name)
}

/* ── التحديث التلقائي: فحص إقلاعي + يدوي + تثبيت عند الإغلاق ── */
type UpdaterState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'not-available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

let updaterState: UpdaterState = { status: 'idle' }

function pushUpdaterState(state: UpdaterState): void {
  updaterState = state
  if (state.status === 'error') logLine('updater', `خطأ تحديث: ${state.message}`)
  if (state.status === 'downloaded') logLine('updater', `جاهز للتثبيت عند الإغلاق: ${state.version}`)
  mainWindow?.webContents.send('updater:state', state)
}

function wireUpdater(): void {
  if (!app.isPackaged) {
    pushUpdaterState({ status: 'not-available', version: app.getVersion() })
    return
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => pushUpdaterState({ status: 'checking' }))
    autoUpdater.on('update-available', (info) => pushUpdaterState({ status: 'available', version: info.version }))
    autoUpdater.on('update-not-available', (info) => pushUpdaterState({ status: 'not-available', version: info.version }))
    autoUpdater.on('download-progress', (progress) => pushUpdaterState({ status: 'downloading', percent: Math.round(progress.percent) }))
    autoUpdater.on('update-downloaded', (info) => pushUpdaterState({ status: 'downloaded', version: info.version }))
    autoUpdater.on('error', (error) => pushUpdaterState({ status: 'error', message: error.message }))
    void autoUpdater.checkForUpdatesAndNotify()
  } catch (error) {
    pushUpdaterState({ status: 'error', message: (error as Error).message })
  }
}

/* ── النسخ الدوّارة (وثيقة §3.3): ساعي 24 · يومي 30 · أسبوعي 12 ── */
const ROTATION = { hourly: { keep: 24, ms: 60 * 60 * 1000 }, daily: { keep: 30, ms: 24 * 60 * 60 * 1000 }, weekly: { keep: 12, ms: 7 * 24 * 60 * 60 * 1000 } } as const
let backupTimer: NodeJS.Timeout | null = null

function pruneGeneration(kind: keyof typeof ROTATION): void {
  const dir = join(app.getPath('userData'), 'backups', kind)
  if (!existsSync(dir)) return
  const files = readdirSync(dir).filter((file) => file.endsWith('.db')).sort()
  const excess = files.length - ROTATION[kind].keep
  for (const file of files.slice(0, Math.max(0, excess))) {
    try {
      unlinkSync(join(dir, file))
    } catch {
      /* ملف مشغول — يُترك للجولة القادمة */
    }
  }
}

async function rotateBackups(): Promise<void> {
  if (!database) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const kind of Object.keys(ROTATION) as (keyof typeof ROTATION)[]) {
    const dir = join(app.getPath('userData'), 'backups', kind)
    mkdirSync(dir, { recursive: true })
    const lastKey = `backup_last_${kind}`
    const last = database.getMeta(lastKey)
    const lastMs = last ? Date.parse(last) : 0
    if (Date.now() - lastMs < ROTATION[kind].ms) continue
    const dest = join(dir, `${kind}-${stamp}.db`)
    await database.raw.backup(dest)
    /* ترقية أفضل نسخة من الجيل الأدق إلى الأعلى قبل التقليم */
    database.setMeta(lastKey, new Date().toISOString())
    pruneGeneration(kind)
  }
}

/* ── IPC ── */
function wireIpc(): void {
  const db = () => {
    if (!database) throw new Error('قاعدة البيانات غير مهيأة بعد')
    return database
  }
  ipcMain.handle('device:getEncryptionKey', (): Uint8Array => new Uint8Array(deviceEncryptionKey))
  ipcMain.handle('database:getSnapshot', (_event, storeName: string): SnapshotDto => db().getSnapshot(storeName))
  ipcMain.handle('database:saveSnapshot', (_event, input: SaveSnapshotInput) => db().saveSnapshot(input))
  ipcMain.handle('database:deleteSnapshot', (_event, input: DeleteSnapshotInput) => db().deleteSnapshot(input))
  ipcMain.handle('database:enqueueOutbox', (_event, input: EnqueueOutboxInput) => db().enqueueOutbox(input))
  ipcMain.handle('database:claimOutbox', (_event, input?: ClaimOutboxInput): OutboxEventDto[] => db().claimOutbox(input))
  ipcMain.handle('database:completeOutbox', (_event, input: CompleteOutboxInput) => db().completeOutbox(input))
  ipcMain.handle('database:integrityCheck', () => db().integrityCheck())
  ipcMain.handle('database:schemaVersion', () => db().schemaVersion())

  ipcMain.handle('print:print', async (_event, html: string, silent: boolean, printerName?: string) => {
    await printHtml(html, silent, printerName)
  })
  ipcMain.handle('print:printers', () => listPrinters())

  /* §102 — مضيف شبكة المحل: خادم ws في هذه العملية، منطق المضيف في المُصيّر */
  initLanHostIpc(() => mainWindow)

  ipcMain.handle('updater:state', () => updaterState)
  ipcMain.handle('updater:check', () => {
    if (!app.isPackaged) return updaterState
    try {
      const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
      void autoUpdater.checkForUpdates()
    } catch (error) {
      pushUpdaterState({ status: 'error', message: (error as Error).message })
    }
    return updaterState
  })
  ipcMain.handle('updater:install', () => {
    if (!app.isPackaged) return
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
    electron: process.versions.electron,
    packaged: app.isPackaged,
  }))
  ipcMain.handle('app:backupNow', async () => {
    if (!database) throw new Error('قاعدة البيانات غير مهيأة')
    const dir = join(app.getPath('userData'), 'backups', 'manual')
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, `manual-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
    await database.raw.backup(dest)
    return dest
  })
}

/* ── دورة الحياة ── */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(async () => {
    logLine('boot', `تَحَكَّم ${app.getVersion()} — electron ${process.versions.electron} — node ${process.versions.node} — userData=${app.getPath('userData')}`)
    deviceEncryptionKey = ensureDeviceEncryptionKey()
    database = await openDatabase()
    wireIpc()
    mainWindow = createMainWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
    })
    wireUpdater()
    await rotateBackups()
    backupTimer = setInterval(() => {
      void rotateBackups()
    }, 60 * 60 * 1000)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', (event) => {
    if (backupTimer) clearInterval(backupTimer)
    if (printWindow && !printWindow.isDestroyed()) printWindow.destroy()
    if (database) {
      event.preventDefault()
      const closing = database
      database = null
      void rotateBackups()
        .catch(() => undefined)
        .then(() => {
          closing.close()
          app.quit()
        })
    }
  })
}
