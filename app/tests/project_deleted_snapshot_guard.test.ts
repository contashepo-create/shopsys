import { describe, expect, it } from 'vitest'
import { assertProjectDeletionSnapshotSafe } from '../src/core/projectDeletionSnapshotGuard.ts'

const deleted = { id: 7, code: 'PRJ-7', nameAr: 'محذوف', reason: 'إلغاء', at: '2026-01-01', by: 'المالك', branchId: 1 }
const current = { projectDeletionRecords: [deleted] }
const good = { projects: [{ id: 8 }], projectDeletionRecords: [deleted], auditLog: [{ projectId: 7 }], quotationDeletionRecords: [{ projectId: 7 }], quotations: [{ id: 1, projectId: 7, deletedAt: '2026-01-01' }] }

describe('حارس سجل المشروع المحذوف عند الاستعادة والسحب', () => {
  it('يرفض نسخة قديمة بلا دليل حذف أو غيّرت محتواه، حتى لو لم تعد المشروع', () => {
    expect(() => assertProjectDeletionSnapshotSafe(current, { projects: [] })).toThrow(/تسقط أو تغيّر/)
    expect(() => assertProjectDeletionSnapshotSafe(current, { projects: [], projectDeletionRecords: [{ ...deleted, reason: 'آخر' }] })).toThrow(/تسقط أو تغيّر/)
    expect(current.projectDeletionRecords).toEqual([deleted])
  })
  it('يرفض إحياء المشروع أو روابط مباشرة وضمن JSON وحركات المقدمة', () => {
    expect(() => assertProjectDeletionSnapshotSafe(current, { ...good, projects: [{ id: 7 }] })).toThrow(/تعيد مشروعاً/)
    for (const row of [{ projectId: 7 }, { projectId: '7' }, { payload: JSON.stringify({ data: { projectId: 7 } }) }, { payload: JSON.stringify({ data: JSON.stringify({ projectId: 7 }) }) }, { sourceType: 'client_advance', sourceId: 7 }]) {
      expect(() => assertProjectDeletionSnapshotSafe(current, { ...good, vouchers: [row] })).toThrow(/مستنداً مرتبطاً/)
    }
  })
  it('يرفض سجلاً مكرراً أو تالفاً ويمنع روابط نشطة إلى سجل حذف وارد فقط', () => {
    expect(() => assertProjectDeletionSnapshotSafe(current, { projectDeletionRecords: [deleted, deleted] })).toThrow(/مكرر/)
    expect(() => assertProjectDeletionSnapshotSafe({ projectDeletionRecords: [null] }, good)).toThrow(/غير صالح/)
    expect(() => assertProjectDeletionSnapshotSafe({}, { projectDeletionRecords: [deleted], projects: [{ id: 7 }] })).toThrow(/تعيد مشروعاً/)
  })
  it('يقبل التاريخ الحي المطابق والسجلات الأرشيفية، ونسخاً قديمة بلا حذف محلي', () => {
    expect(() => assertProjectDeletionSnapshotSafe(current, good)).not.toThrow()
    expect(() => assertProjectDeletionSnapshotSafe({}, { projects: [{ id: 7 }] })).not.toThrow()
    expect(() => assertProjectDeletionSnapshotSafe(current, { ...good, projectDeletionRecords: [{ by: 'المالك', at: '2026-01-01', reason: 'إلغاء', nameAr: 'محذوف', code: 'PRJ-7', branchId: 1, id: 7 }] })).not.toThrow()
  })
})
