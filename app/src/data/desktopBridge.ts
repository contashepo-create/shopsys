/**
 * عقد IPC اختياري للنسخة المكتبية.
 * المتصفح لا يستدعي localhost ولا يعرف Node؛ preload فقط يحقن هذا الجسر
 * عند التشغيل داخل Electron مع contextIsolation مفعلاً.
 */

export interface DesktopSnapshot {
  storeName: string
  revision: number
  payloadJson: string | null
  updatedAt: string | null
}

export type DesktopOutboxStatus = 'pending' | 'sending' | 'sent' | 'failed'

export interface DesktopOutboxEvent {
  id: string
  aggregateType: string
  aggregateId: string
  eventType: string
  payloadJson: string
  status: DesktopOutboxStatus
  attempts: number
  nextAttemptAt: string | null
  createdAt: string
  sentAt: string | null
}

export interface DesktopAuditEvent {
  id: number
  at: string
  user: string
  kind: string
  title: string
  refKey?: string
}

export interface DesktopJournalLine {
  accountCode: string
  debit: number
  credit: number
  note?: string
  costCenterId?: number | null
}

export interface DesktopJournalEntry {
  id: number
  entryNumber: number
  date: string
  description: string
  sourceType: string
  sourceId: number | null
  lines: readonly DesktopJournalLine[]
  createdBy: string
  createdAt: string
  reversedByEntryId: number | null
  reversesEntryId: number | null
}

export interface DesktopDatabaseBridge {
  /** v1.0.7: مفتاح تشفير هذا الجهاز — تُشفَّر به لقطات المتاجر قبل تخزينها في SQLite */
  getEncryptionKey?(): Promise<Uint8Array>
  getSnapshot(storeName: string): Promise<DesktopSnapshot>
  saveSnapshot(input: { storeName: string; expectedRevision: number; payloadJson: string; idempotencyKey?: string; auditEvents?: readonly DesktopAuditEvent[]; journalEntries?: readonly DesktopJournalEntry[] }): Promise<{ revision: number; updatedAt: string; replayed?: boolean }>
  deleteSnapshot?(input: { storeName: string; expectedRevision: number }): Promise<{ revision: number; updatedAt: string }>
  enqueueOutbox(input: { id: string; aggregateType: string; aggregateId: string; eventType: string; payloadJson: string }): Promise<{ created: boolean }>
  claimOutbox(input?: { now?: string; limit?: number }): Promise<DesktopOutboxEvent[]>
  completeOutbox(input: { id: string; status: 'sent' | 'failed'; nextAttemptAt?: string | null }): Promise<{ updated: boolean }>
  integrityCheck(): Promise<{ ok: boolean; message: string }>
  schemaVersion(): Promise<number>
}

/** v1.0.8: معلومات وإدارة مكان القاعدة والنسخ المزدوجة — سطح المكتب فقط */
export interface DesktopDatabaseStorageBridge {
  getStorageInfo(): Promise<{
    dbPath: string
    defaultDbPath: string
    isCustom: boolean
    secondaryBackupDir: string
    secondaryIsDefault: boolean
    lastFileBackupAt: string | null
  }>
  chooseDbLocation(): Promise<{ ok: boolean; canceled?: boolean; newPath?: string; restarting?: boolean; error?: string }>
  chooseSecondaryBackupDir(): Promise<{ ok: boolean; canceled?: boolean; dir?: string }>
  /* v1.0.9: درع البيانات — استرداد تلقائي + استعادة نسخة ملفية */
  recoveryNotice(): Promise<{ at: string; from: string | null } | null>
  listFileBackups(): Promise<{ path: string; where: string; kind: string; size: number; at: string }[]>
  restoreFileBackup(path: string): Promise<{ ok: boolean; restarting?: boolean }>
}

export interface ShopsysDesktopBridge {
  runtime: 'electron'
  database: DesktopDatabaseBridge
  databaseStorage?: DesktopDatabaseStorageBridge
}

declare global {
  interface Window {
    shopsysDesktop?: ShopsysDesktopBridge
    /** v1.0.8: مرساة التجربة — تعيد أقدم بداية تجربة معروفة لهذا الجهاز */
    shopsysTrialAnchor?: (firstTrialAt: string) => Promise<{ firstTrialAt: string }>
    /** نسخة ملفية فورية للقاعدة في المكانين — يكشفها preload في سطح المكتب */
    shopsysBackupNow?: () => Promise<string[]>
  }
}

/** نسخة ملفية فورية (SQLite backup) في المكانين — أو null في المتصفح */
export function desktopBackupNow(): (() => Promise<string[]>) | null {
  return typeof window !== 'undefined' && typeof window.shopsysBackupNow === 'function' ? window.shopsysBackupNow.bind(window) : null
}

export function desktopBridge(): ShopsysDesktopBridge | null {
  return typeof window !== 'undefined' ? window.shopsysDesktop ?? null : null
}

export function isElectronRuntime(): boolean {
  return desktopBridge()?.runtime === 'electron'
}

/** جسر إدارة مكان القاعدة — أو null في المتصفح */
export function desktopDatabaseStorage(): DesktopDatabaseStorageBridge | null {
  return desktopBridge()?.databaseStorage ?? null
}

export function requireDesktopDatabase(): DesktopDatabaseBridge {
  const bridge = desktopBridge()
  if (!bridge) throw new Error('قاعدة SQLite متاحة فقط داخل نسخة سطح المكتب')
  return bridge.database
}
