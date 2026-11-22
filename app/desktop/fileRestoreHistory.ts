/** فحص محافظ للأدلة المحفوظة فعلاً قبل الاستعادة الملفية؛ ليس إثباتاً لاكتمالها. */
import Database from 'better-sqlite3'
import type { FiscalYear } from '../src/core/fiscal.ts'
import type { JournalEntry } from '../src/core/ledger.ts'
import { assertFiscalYearsPreserved, assertJournalHistoryPreserved } from '../src/core/ledgerHistoryGuard.ts'
import { assertProjectDeletionSnapshotSafe } from '../src/core/projectDeletionSnapshotGuard.ts'
import { assertProjectDocumentHistoryPreserved } from '../src/core/projectDocumentHistoryGuard.ts'
import { assertProjectFinancialHistoryPreserved } from '../src/core/projectFinancialHistoryGuard.ts'
import { assertPayrollProjectHistoryPreserved } from '../src/core/payrollProjectHistoryGuard.ts'
import { assertMaterialIssueHistoryPreserved } from '../src/core/materialIssueHistoryGuard.ts'
import { assertContactHistoriesPreserved } from '../src/core/customerProfile.ts'
import { assertLetterCountersPreserved } from '../src/core/letterCounterHistoryGuard.ts'
import { decryptSnapshot } from './snapshotKeyProbe.ts'

function state(payload: string | null, label: string, key: Buffer, required: boolean): Record<string, unknown> {
  if (payload === null) {
    if (required) throw new Error(`لقطة ${label} مفقودة — راجع النسخة قبل الاستعادة`)
    return {}
  }
  let parsed: unknown
  try { parsed = JSON.parse(payload.startsWith('enc:') ? decryptSnapshot(payload, key) : payload) as unknown } catch {
    throw new Error(`تعذّر قراءة لقطة ${label} أو فك تشفيرها — لم تُستعد القاعدة`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`لقطة ${label} ليست كائناً صالحاً`)
  const envelope = parsed as Record<string, unknown>
  const value = Object.hasOwn(envelope, 'state') ? envelope.state : envelope
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`حالة ${label} ليست كائناً صالحاً`)
  const result = value as Record<string, unknown>
  if (Object.keys(result).some(field => field === '__proto__' || field === 'prototype' || field === 'constructor')) throw new Error(`لقطة ${label} تحتوي حقلاً محظوراً`)
  return result
}

function snapshot(db: Database.Database, name: string): string | null {
  const row = db.prepare('SELECT payload_json FROM snapshots WHERE store_name = ?').get(name) as { payload_json: unknown } | undefined
  if (!row || row.payload_json === null) return null
  if (typeof row.payload_json !== 'string') throw new Error(`حمولة لقطة ${name} غير صالحة`)
  return row.payload_json
}

/**
 * حافظ على القيود وأحداث التدقيق وأرقام المستندات المثبتة خارج JSON أيضاً. مقارنة
 * حقول القيود محافظة عمداً: حتى إضافة علامة عكس إلى قيد موجود تتطلب مراجعة.
 * لا نثبت تطابق هذه الجداول مع اللقطة أو صحة الأرقام أو الأدلة الموجودة.
 */
function assertSqlEvidence(current: Database.Database, incoming: Database.Database): void {
  for (const [db, label] of [[current, 'الحالية'], [incoming, 'النسخة']] as const) {
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    for (const table of ['journal', 'doc_numbers', 'audit_log']) if (!has.get(table)) throw new Error(`جدول ${table} مفقود في قاعدة ${label} — راجع الدليل قبل الاستعادة`)
  }
  const fields = 'id, entry_number, date, description, source_type, source_id, lines_json, created_by, created_at, reversed_by_entry_id, reverses_entry_id'
  const lookup = incoming.prepare(`SELECT ${fields} FROM journal WHERE id = ?`)
  for (const row of current.prepare(`SELECT ${fields} FROM journal`).iterate() as Iterable<Record<string, unknown>>) {
    const next = lookup.get(row.id) as Record<string, unknown> | undefined
    if (!next || Object.keys(row).some(field => row[field] !== next[field])) throw new Error(`النسخة تسقط أو تغيّر قيد SQLite #${String(row.id)} — راجع الدفتر`)
  }
  const auditFields = 'id, at, user, kind, title, ref_key'
  const auditLookup = incoming.prepare(`SELECT ${auditFields} FROM audit_log WHERE id = ?`)
  for (const row of current.prepare(`SELECT ${auditFields} FROM audit_log`).iterate() as Iterable<Record<string, unknown>>) {
    const next = auditLookup.get(row.id) as Record<string, unknown> | undefined
    if (!next || Object.keys(row).some(field => row[field] !== next[field])) throw new Error(`النسخة تسقط أو تغيّر حدث التدقيق #${String(row.id)} — راجع السجل`)
  }
  const numberLookup = incoming.prepare('SELECT 1 FROM doc_numbers WHERE branch = ? AND doc_type = ? AND number = ?')
  for (const row of current.prepare('SELECT branch, doc_type, number FROM doc_numbers').iterate() as Iterable<{ branch: string; doc_type: string; number: string }>) {
    if (!numberLookup.get(row.branch, row.doc_type, row.number)) throw new Error('النسخة تسقط رقم مستند محفوظاً في SQLite — راجع الترقيم')
  }
}

/**
 * تُقرأ القاعدتان باتصالين للقراءة المتسقة ويستدعى هذا قبل إغلاق القاعدة.
 * لا يشمل كتّاباً من عمليات أخرى أو الكتابات التي لم تصل للقطة أو الأدلة الأخرى.
 */
export function assertFileRestoreHistory(current: Database.Database, stagedPath: string, key: Buffer): void {
  const incoming = new Database(stagedPath, { readonly: true, fileMustExist: true })
  try {
    current.transaction(() => incoming.transaction(() => {
      const oldData = state(snapshot(current, 'shopsys-data'), 'البيانات الحالية', key, false)
      const rawOldApp = snapshot(current, 'shopsys-app')
      const oldApp = state(rawOldApp, 'الإعدادات الحالية', key, false)
      const nextData = state(snapshot(incoming, 'shopsys-data'), 'بيانات النسخة', key, true)
      const nextApp = state(snapshot(incoming, 'shopsys-app'), 'إعدادات النسخة', key, rawOldApp !== null)
      const localJournal = oldData.journal === undefined ? [] : oldData.journal
      const localYears = oldApp.fiscalYears === undefined ? [] : oldApp.fiscalYears
      assertJournalHistoryPreserved(localJournal as JournalEntry[], nextData.journal)
      assertFiscalYearsPreserved(localYears as FiscalYear[], nextApp.fiscalYears)
      assertProjectDeletionSnapshotSafe(oldData, nextData)
      assertProjectDocumentHistoryPreserved(oldData, nextData)
      assertProjectFinancialHistoryPreserved(oldData, nextData)
      assertPayrollProjectHistoryPreserved(oldData, nextData)
      assertMaterialIssueHistoryPreserved(oldData, nextData)
      assertContactHistoriesPreserved(oldData, nextData)
      assertLetterCountersPreserved(oldData, nextData)
      assertSqlEvidence(current, incoming)
    })())()
  } finally { incoming.close() }
}
