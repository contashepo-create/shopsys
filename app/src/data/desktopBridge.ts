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
  getSnapshot(storeName: string): Promise<DesktopSnapshot>
  saveSnapshot(input: { storeName: string; expectedRevision: number; payloadJson: string; idempotencyKey?: string; auditEvents?: readonly DesktopAuditEvent[]; journalEntries?: readonly DesktopJournalEntry[] }): Promise<{ revision: number; updatedAt: string; replayed?: boolean }>
  deleteSnapshot?(input: { storeName: string; expectedRevision: number }): Promise<{ revision: number; updatedAt: string }>
  enqueueOutbox(input: { id: string; aggregateType: string; aggregateId: string; eventType: string; payloadJson: string }): Promise<{ created: boolean }>
  claimOutbox(input?: { now?: string; limit?: number }): Promise<DesktopOutboxEvent[]>
  completeOutbox(input: { id: string; status: 'sent' | 'failed'; nextAttemptAt?: string | null }): Promise<{ updated: boolean }>
  integrityCheck(): Promise<{ ok: boolean; message: string }>
  schemaVersion(): Promise<number>
}

export interface ShopsysDesktopBridge {
  runtime: 'electron'
  database: DesktopDatabaseBridge
}

declare global {
  interface Window {
    shopsysDesktop?: ShopsysDesktopBridge
  }
}

export function desktopBridge(): ShopsysDesktopBridge | null {
  return typeof window !== 'undefined' ? window.shopsysDesktop ?? null : null
}

export function isElectronRuntime(): boolean {
  return desktopBridge()?.runtime === 'electron'
}

export function requireDesktopDatabase(): DesktopDatabaseBridge {
  const bridge = desktopBridge()
  if (!bridge) throw new Error('قاعدة SQLite متاحة فقط داخل نسخة سطح المكتب')
  return bridge.database
}
