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
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ShopsysDatabase, type OutboxEventDto, type SaveSnapshotInput, type SnapshotDto } from './sqlite/storage.ts'

type ClaimOutboxInput = { now?: string; limit?: number }
type DeleteSnapshotInput = { storeName: string; expectedRevision: number }
type EnqueueOutboxInput = Parameters<ShopsysDatabase['enqueueOutbox']>[0]
type CompleteOutboxInput = Parameters<ShopsysDatabase['completeOutbox']>[0]

/* eslint-disable no-console */

let mainWindow: BrowserWindow | null = null
let database: ShopsysDatabase | null = null
let printWindow: BrowserWindow | null = null

const isDev = !!process.env.ELECTRON_START_URL

/* ── النافذة ── */
function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 640,
    title: 'تَحَكَّم',
    autoHideMenuBar: true,
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
  if (isDev) void win.loadURL(process.env.ELECTRON_START_URL!)
  else void win.loadFile(join(__dirname, '../dist/index.html'))
  return win
}

/* ── القاعدة ── */
async function openDatabase(): Promise<ShopsysDatabase> {
  const dbPath = join(app.getPath('userData'), 'shopsys.db')
  const db = await ShopsysDatabase.open(dbPath, { backupsDir: join(app.getPath('userData'), 'backups') })
  console.log(`[shopsys] قاعدة SQLite جاهزة: ${dbPath} (مخطط ${db.schemaVersion()})`)
  return db
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
