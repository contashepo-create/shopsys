const { app, BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const STORE_NAME = 'shopsys-data'
const SCHEMA_VERSION = 1
let db

const schemaStatements = [
  'PRAGMA foreign_keys = ON',
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS store_state (store_name TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0), payload_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (key TEXT PRIMARY KEY NOT NULL, operation TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS outbox_events (id TEXT PRIMARY KEY NOT NULL, aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')), attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0), next_attempt_at TEXT, created_at TEXT NOT NULL, sent_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(status, next_attempt_at, created_at)`,
  `CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, aggregate_type TEXT, aggregate_id TEXT, details_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_events(created_at)`,
]

function migrateDatabase() {
  db.transaction(() => {
    for (const statement of schemaStatements) db.prepare(statement).run()
    db.prepare('INSERT INTO schema_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('schema_version', String(SCHEMA_VERSION))
  })()
}

function openDatabase() {
  const filename = path.join(app.getPath('userData'), 'shopsys.sqlite')
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  db = new Database(filename)
  migrateDatabase()
}

function registerDatabaseIpc() {
  ipcMain.handle('shopsys:db:get-snapshot', (_event, storeName) => {
    const row = db.prepare('SELECT store_name AS storeName, revision, payload_json AS payloadJson, updated_at AS updatedAt FROM store_state WHERE store_name = ?').get(String(storeName))
    return row ?? { storeName: String(storeName), revision: 0, payloadJson: null, updatedAt: null }
  })

  ipcMain.handle('shopsys:db:save-snapshot', (_event, input) => {
    const storeName = String(input?.storeName ?? '')
    const payloadJson = String(input?.payloadJson ?? '')
    const expectedRevision = Number(input?.expectedRevision)
    if (!storeName || !payloadJson || !Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('لقطة قاعدة البيانات غير صالحة')
    JSON.parse(payloadJson)
    const updatedAt = new Date().toISOString()
    const save = db.transaction(() => {
      const current = db.prepare('SELECT revision FROM store_state WHERE store_name = ?').get(storeName)
      const revision = current ? Number(current.revision) : 0
      if (revision !== expectedRevision) throw new Error('تعارض إصدار قاعدة البيانات — أعد القراءة قبل الحفظ')
      const nextRevision = revision + 1
      db.prepare(`INSERT INTO store_state(store_name, revision, payload_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(store_name) DO UPDATE SET revision = excluded.revision, payload_json = excluded.payload_json, updated_at = excluded.updated_at`).run(storeName, nextRevision, payloadJson, updatedAt)
      return { revision: nextRevision, updatedAt }
    })
    return save()
  })

  ipcMain.handle('shopsys:db:integrity-check', () => {
    const result = db.pragma('integrity_check', { simple: true })
    return { ok: result === 'ok', message: result === 'ok' ? 'قاعدة SQLite سليمة' : String(result) }
  })

  ipcMain.handle('shopsys:db:schema-version', () => {
    const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get()
    return Number(row?.value ?? 0)
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const devServer = process.env.SHOPSYS_DEV_SERVER
  if (devServer) window.loadURL(devServer)
  else window.loadFile(path.join(__dirname, '../app/dist/index.html'))
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  openDatabase()
  registerDatabaseIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('will-quit', () => { if (db) db.close() })
