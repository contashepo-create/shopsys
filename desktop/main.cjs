const { app, BrowserWindow, ipcMain, shell, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const Database = require('better-sqlite3')

const STORE_NAME = 'shopsys-data'
const SCHEMA_VERSION = 2
let db

const schemaStatements = [
  'PRAGMA foreign_keys = ON',
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS store_state (store_name TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0), payload_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (key TEXT PRIMARY KEY NOT NULL, operation TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON idempotency_keys(created_at)`,
  `CREATE TABLE IF NOT EXISTS outbox_events (id TEXT PRIMARY KEY NOT NULL, aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')), attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0), next_attempt_at TEXT, created_at TEXT NOT NULL, sent_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(status, next_attempt_at, created_at)`,
  `CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, aggregate_type TEXT, aggregate_id TEXT, details_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_events(created_at)`,
  `CREATE TABLE IF NOT EXISTS journal_entries (
    store_name TEXT NOT NULL,
    id INTEGER NOT NULL,
    entry_number INTEGER NOT NULL,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id INTEGER,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    reversed_by_entry_id INTEGER,
    reverses_entry_id INTEGER,
    content_hash TEXT NOT NULL,
    PRIMARY KEY (store_name, id)
  )`,
  `CREATE TABLE IF NOT EXISTS journal_lines (
    store_name TEXT NOT NULL,
    entry_id INTEGER NOT NULL,
    line_index INTEGER NOT NULL,
    account_code TEXT NOT NULL,
    debit INTEGER NOT NULL CHECK (debit >= 0),
    credit INTEGER NOT NULL CHECK (credit >= 0),
    note TEXT,
    cost_center_id INTEGER,
    PRIMARY KEY (store_name, entry_id, line_index),
    FOREIGN KEY (store_name, entry_id) REFERENCES journal_entries(store_name, id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(store_name, date, id)`,
  `CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(store_name, account_code, entry_id)`,
]

function migrateDatabase() {
  // journal_mode لا يُغيّر داخل transaction في SQLite؛ طبّق PRAGMA أولاً.
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.transaction(() => {
    for (const statement of schemaStatements.slice(3)) db.prepare(statement).run()
    db.prepare('INSERT INTO schema_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('schema_version', String(SCHEMA_VERSION))
  })()
}

function openDatabase() {
  const filename = path.join(app.getPath('userData'), 'shopsys.sqlite')
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  db = new Database(filename)
  migrateDatabase()
}

function encodePayload(payloadJson) {
  if (safeStorage.isEncryptionAvailable()) {
    return `safe:v1:${safeStorage.encryptString(payloadJson).toString('base64')}`
  }
  // بعض أنظمة Linux لا توفر keyring داخل جلسة التشغيل؛ أبقِ التوافق قائماً
  // مع وسم صريح حتى لا يُعامل النص كأنه مشفر بمفتاح النظام.
  return `plain:v1:${payloadJson}`
}

function decodePayload(stored) {
  const value = String(stored ?? '')
  if (value.startsWith('safe:v1:')) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('مفتاح النظام الآمن غير متاح لفك قاعدة SQLite')
    return safeStorage.decryptString(Buffer.from(value.slice('safe:v1:'.length), 'base64'))
  }
  if (value.startsWith('plain:v1:')) return value.slice('plain:v1:'.length)
  // لقطات الإصدار الانتقالي الأولى كانت JSON مباشرة.
  return value
}

function snapshotOperation(storeName, expectedRevision, payloadJson) {
  const digest = createHash('sha256').update(payloadJson, 'utf8').digest('hex')
  return `snapshot:${storeName}:${expectedRevision}:${digest}`
}

function normalizeAuditEvents(input) {
  const events = input == null ? [] : input
  if (!Array.isArray(events) || events.length > 3000) throw new Error('سجل التدقيق المرسل غير صالح')
  return events.map((event) => {
    const id = Number(event?.id)
    const at = String(event?.at ?? '')
    const user = String(event?.user ?? '')
    const kind = String(event?.kind ?? '')
    const title = String(event?.title ?? '')
    const refKey = event?.refKey == null ? null : String(event.refKey)
    if (!Number.isInteger(id) || id < 1 || !at || Number.isNaN(Date.parse(at)) || !user || user.length > 200 || !kind || kind.length > 80 || !title || title.length > 1000 || (refKey && refKey.length > 240)) {
      throw new Error('حدث تدقيق غير صالح')
    }
    const split = refKey?.indexOf(':') ?? -1
    return { id, at, user, kind, title, refKey, aggregateType: split > 0 ? refKey.slice(0, split) : null, aggregateId: split > 0 ? refKey.slice(split + 1) : null }
  })
}

function normalizeJournalEntries(input) {
  const entries = input == null ? [] : input
  if (!Array.isArray(entries) || entries.length > 5000) throw new Error('القيود المرسلة غير صالحة')
  return entries.map((entry) => {
    const id = Number(entry?.id)
    const entryNumber = Number(entry?.entryNumber)
    const date = String(entry?.date ?? '')
    const description = String(entry?.description ?? '')
    const sourceType = String(entry?.sourceType ?? '')
    const sourceId = entry?.sourceId == null ? null : Number(entry.sourceId)
    const createdBy = String(entry?.createdBy ?? '')
    const createdAt = String(entry?.createdAt ?? '')
    const reversedByEntryId = entry?.reversedByEntryId == null ? null : Number(entry.reversedByEntryId)
    const reversesEntryId = entry?.reversesEntryId == null ? null : Number(entry.reversesEntryId)
    const lines = Array.isArray(entry?.lines) ? entry.lines.map((line) => {
      const accountCode = String(line?.accountCode ?? '')
      const debit = Number(line?.debit)
      const credit = Number(line?.credit)
      const note = line?.note == null ? null : String(line.note)
      const costCenterId = line?.costCenterId == null ? null : Number(line.costCenterId)
      if (!accountCode || accountCode.length > 64 || !Number.isInteger(debit) || debit < 0 || !Number.isInteger(credit) || credit < 0 || (debit > 0 && credit > 0) || debit + credit <= 0 || (note && note.length > 1000) || (costCenterId != null && (!Number.isInteger(costCenterId) || costCenterId < 1))) {
        throw new Error('سطر قيد غير صالح')
      }
      return { accountCode, debit, credit, note, costCenterId }
    }) : []
    if (!Number.isInteger(id) || id < 1 || !Number.isInteger(entryNumber) || entryNumber < 0 || !/^\\d{4}-\\d{2}-\\d{2}/.test(date) || !description || description.length > 1000 || !sourceType || sourceType.length > 100 || (sourceId != null && !Number.isInteger(sourceId)) || !createdBy || createdBy.length > 200 || Number.isNaN(Date.parse(createdAt)) || (reversedByEntryId != null && (!Number.isInteger(reversedByEntryId) || reversedByEntryId < 1)) || (reversesEntryId != null && (!Number.isInteger(reversesEntryId) || reversesEntryId < 1)) || lines.length < 2) {
      throw new Error('قيد يومية غير صالح')
    }
    const normalized = { id, entryNumber, date, description, sourceType, sourceId, createdBy, createdAt, reversedByEntryId, reversesEntryId, lines }
    const contentHash = createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex')
    return { ...normalized, contentHash }
  })
}

function registerDatabaseIpc() {
  ipcMain.handle('shopsys:db:get-snapshot', (_event, storeName) => {
    const row = db.prepare('SELECT store_name AS storeName, revision, payload_json AS payloadJson, updated_at AS updatedAt FROM store_state WHERE store_name = ?').get(String(storeName))
    if (!row) return { storeName: String(storeName), revision: 0, payloadJson: null, updatedAt: null }
    return { ...row, payloadJson: decodePayload(row.payloadJson) }
  })

  ipcMain.handle('shopsys:db:save-snapshot', (_event, input) => {
    const storeName = String(input?.storeName ?? '')
    const payloadJson = String(input?.payloadJson ?? '')
    const expectedRevision = Number(input?.expectedRevision)
    const requestedKey = input?.idempotencyKey == null ? '' : String(input.idempotencyKey)
    if (!storeName || !payloadJson || !Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('لقطة قاعدة البيانات غير صالحة')
    if (requestedKey && (requestedKey.length > 240 || !/^[A-Za-z0-9:_-]+$/.test(requestedKey))) throw new Error('مفتاح منع تكرار اللقطة غير صالح')
    const auditEvents = normalizeAuditEvents(input?.auditEvents)
    const journalEntries = normalizeJournalEntries(input?.journalEntries)
    JSON.parse(payloadJson)
    const storedPayload = encodePayload(payloadJson)
    const operation = snapshotOperation(storeName, expectedRevision, payloadJson)
    const updatedAt = new Date().toISOString()
    const save = db.transaction(() => {
      if (requestedKey) {
        const previous = db.prepare('SELECT operation, result_json AS resultJson FROM idempotency_keys WHERE key = ?').get(requestedKey)
        if (previous) {
          if (previous.operation !== operation) throw new Error('مفتاح منع التكرار مستخدم لعملية مختلفة')
          return { ...JSON.parse(previous.resultJson), replayed: true }
        }
      }
      const current = db.prepare('SELECT revision FROM store_state WHERE store_name = ?').get(storeName)
      const revision = current ? Number(current.revision) : 0
      if (revision !== expectedRevision) throw new Error('تعارض إصدار قاعدة البيانات — أعد القراءة قبل الحفظ')
      const nextRevision = revision + 1
      const result = { revision: nextRevision, updatedAt }
      db.prepare(`INSERT INTO store_state(store_name, revision, payload_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(store_name) DO UPDATE SET revision = excluded.revision, payload_json = excluded.payload_json, updated_at = excluded.updated_at`).run(storeName, nextRevision, storedPayload, updatedAt)
      const insertAudit = db.prepare(`INSERT OR IGNORE INTO audit_events(id, actor_id, actor_name, action, aggregate_type, aggregate_id, details_json, created_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`)
      for (const event of auditEvents) {
        insertAudit.run(`${storeName}:${event.id}`, event.user, event.kind, event.aggregateType, event.aggregateId, JSON.stringify({ title: event.title, refKey: event.refKey }), event.at)
      }
      const findJournal = db.prepare('SELECT content_hash AS contentHash FROM journal_entries WHERE store_name = ? AND id = ?')
      const insertJournal = db.prepare(`INSERT INTO journal_entries(store_name, id, entry_number, date, description, source_type, source_id, created_by, created_at, reversed_by_entry_id, reverses_entry_id, content_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      const insertLine = db.prepare(`INSERT INTO journal_lines(store_name, entry_id, line_index, account_code, debit, credit, note, cost_center_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const entry of journalEntries) {
        const existing = findJournal.get(storeName, entry.id)
        if (existing) {
          if (existing.contentHash !== entry.contentHash) throw new Error(`القيد ${entry.id} تغيّر بعد ترحيله — السجل append-only`)
          continue
        }
        insertJournal.run(storeName, entry.id, entry.entryNumber, entry.date, entry.description, entry.sourceType, entry.sourceId, entry.createdBy, entry.createdAt, entry.reversedByEntryId, entry.reversesEntryId, entry.contentHash)
        entry.lines.forEach((line, index) => insertLine.run(storeName, entry.id, index, line.accountCode, line.debit, line.credit, line.note, line.costCenterId))
      }
      if (requestedKey) {
        db.prepare('INSERT INTO idempotency_keys(key, operation, result_json, created_at) VALUES (?, ?, ?, ?)').run(requestedKey, operation, JSON.stringify(result), updatedAt)
        // لقطات Zustand كثيرة؛ نحتفظ بآخر 256 مفتاحاً فقط حتى لا تتحول
        // إعادة المحاولة قصيرة المدى إلى نمو غير محدود في قاعدة البيانات.
        db.prepare(`DELETE FROM idempotency_keys
          WHERE key LIKE 'snapshot:%'
            AND key NOT IN (
              SELECT key FROM idempotency_keys
              WHERE key LIKE 'snapshot:%'
              ORDER BY created_at DESC, key DESC
              LIMIT 256
            )`).run()
      }
      return result
    })
    return save()
  })

  ipcMain.handle('shopsys:db:enqueue-outbox', (_event, input) => {
    const id = String(input?.id ?? '')
    const aggregateType = String(input?.aggregateType ?? '')
    const aggregateId = String(input?.aggregateId ?? '')
    const eventType = String(input?.eventType ?? '')
    const payloadJson = String(input?.payloadJson ?? '')
    if (!id || id.length > 240 || !/^[A-Za-z0-9:_-]+$/.test(id)) throw new Error('معرف حدث outbox غير صالح')
    if (!aggregateType || aggregateType.length > 120 || !aggregateId || aggregateId.length > 240 || !eventType || eventType.length > 120) throw new Error('بيانات حدث outbox غير مكتملة')
    if (!payloadJson || payloadJson.length > 4_000_000) throw new Error('حمولة حدث outbox كبيرة أو فارغة')
    JSON.parse(payloadJson)
    const createdAt = new Date().toISOString()
    const result = db.prepare(`INSERT OR IGNORE INTO outbox_events(id, aggregate_type, aggregate_id, event_type, payload_json, status, attempts, next_attempt_at, created_at, sent_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, ?, NULL)`).run(id, aggregateType, aggregateId, eventType, payloadJson, createdAt)
    return { created: result.changes === 1 }
  })

  ipcMain.handle('shopsys:db:claim-outbox', (_event, input) => {
    const now = String(input?.now ?? new Date().toISOString())
    const requestedLimit = Number(input?.limit ?? 20)
    const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 20
    const claim = db.transaction(() => {
      const rows = db.prepare(`SELECT id, aggregate_type AS aggregateType, aggregate_id AS aggregateId, event_type AS eventType,
          payload_json AS payloadJson, status, attempts, next_attempt_at AS nextAttemptAt, created_at AS createdAt, sent_at AS sentAt
        FROM outbox_events
        WHERE status IN ('pending', 'failed')
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY created_at ASC, id ASC
        LIMIT ?`).all(now, limit)
      const update = db.prepare(`UPDATE outbox_events SET status = 'sending', attempts = attempts + 1 WHERE id = ? AND status IN ('pending', 'failed')`)
      return rows.filter((row) => update.run(row.id).changes === 1).map((row) => ({ ...row, status: 'sending', attempts: Number(row.attempts) + 1 }))
    })
    return claim()
  })

  ipcMain.handle('shopsys:db:complete-outbox', (_event, input) => {
    const id = String(input?.id ?? '')
    const status = String(input?.status ?? '')
    if (!id || (status !== 'sent' && status !== 'failed')) throw new Error('حالة إغلاق outbox غير صالحة')
    const nextAttemptAt = input?.nextAttemptAt == null ? null : String(input.nextAttemptAt)
    if (nextAttemptAt && Number.isNaN(Date.parse(nextAttemptAt))) throw new Error('موعد إعادة outbox غير صالح')
    const now = new Date().toISOString()
    const result = status === 'sent'
      ? db.prepare(`UPDATE outbox_events SET status = 'sent', sent_at = ?, next_attempt_at = NULL WHERE id = ? AND status = 'sending'`).run(now, id)
      : db.prepare(`UPDATE outbox_events SET status = 'failed', sent_at = NULL, next_attempt_at = ? WHERE id = ? AND status = 'sending'`).run(nextAttemptAt, id)
    return { updated: result.changes === 1 }
  })

  ipcMain.handle('shopsys:db:delete-snapshot', (_event, input) => {
    const storeName = String(input?.storeName ?? '')
    const expectedRevision = Number(input?.expectedRevision)
    if (!storeName || !Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('طلب حذف لقطة SQLite غير صالح')
    const updatedAt = new Date().toISOString()
    const remove = db.transaction(() => {
      const current = db.prepare('SELECT revision FROM store_state WHERE store_name = ?').get(storeName)
      const revision = current ? Number(current.revision) : 0
      if (revision !== expectedRevision) throw new Error('تعارض إصدار قاعدة البيانات — أعد القراءة قبل الحذف')
      db.prepare('DELETE FROM store_state WHERE store_name = ?').run(storeName)
      return { revision: 0, updatedAt }
    })
    return remove()
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
