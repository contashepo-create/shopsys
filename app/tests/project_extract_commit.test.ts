import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const control = vi.hoisted(() => ({
  state: { activeBranchId: 1, projects: [{ id: 1, nameAr: 'مشروع' }], boqItems: [{ id: 1, projectId: 1, qty: 1000 }], projectExtracts: [] as { id: number; projectId: number }[], projectSurveys: [] as unknown[], projectExtractDrafts: [] as unknown[], clientAdvances: [] as unknown[], changeOrders: [] as unknown[] },
  onRefresh: () => {}, failFlush: false, queue: Promise.resolve(),
}))
vi.mock('../src/data/repo.ts', () => ({
  useDataStore: { getState: () => control.state },
  useRawDataStore: { persist: { rehydrate: async () => { control.onRefresh() } } },
}))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({
  withInvoiceCommitLock: <T>(refresh: () => Promise<unknown>, commit: () => T) => {
    const next = control.queue.then(async () => { await refresh(); const result = commit(); if (control.failFlush) throw new Error('disk full'); return result })
    control.queue = next.then(() => {}, () => {})
    return next
  },
}))
import { projectExtractFingerprint, ProjectCommitUnconfirmedError, withProjectExtractCommit } from '../src/data/projectExtractCommit.ts'

beforeEach(() => {
 control.state = { activeBranchId: 1, projects: [{ id: 1, nameAr: 'مشروع' }], boqItems: [{ id: 1, projectId: 1, qty: 1000 }], projectExtracts: [], projectSurveys: [], projectExtractDrafts: [], clientAdvances: [], changeOrders: [] }
 control.onRefresh = () => {}; control.failFlush = false; control.queue = Promise.resolve()
})
afterEach(() => vi.restoreAllMocks())

describe('قفل إصدار المستخلص وإعادة فحص أساس المعاينة', () => {
 it('رفض نافذة ثانية تستخدم معاينة قديمة بعد نجاح الأولى', async () => {
  const fingerprint = projectExtractFingerprint(control.state as never, 1)
  const commit = vi.fn(() => { control.state.projectExtracts.push({ id: 1, projectId: 1 }); return 1 })
  const first = withProjectExtractCommit(1, fingerprint, commit)
  const second = withProjectExtractCommit(1, fingerprint, commit)
  expect(await first).toBe(1)
  await expect(second).rejects.toThrow(/تغير المشروع/)
  expect(commit).toHaveBeenCalledTimes(1)
 })
 it('يعيد التحميل قبل المقارنة ولا يرحل إذا تغيرت الكمية أو الفرع', async () => {
  const fingerprint = projectExtractFingerprint(control.state as never, 1)
  control.onRefresh = () => { control.state.boqItems[0].qty = 500 }
  const commit = vi.fn()
  await expect(withProjectExtractCommit(1, fingerprint, commit)).rejects.toThrow(/تغير المشروع/)
  expect(commit).not.toHaveBeenCalled()
 })
 it('يميز إخفاق تأكيد الحفظ بعد الترحيل عن فشل الترحيل قبل حدوثه', async () => {
  const fingerprint = projectExtractFingerprint(control.state as never, 1)
  control.failFlush = true
  const commit = vi.fn(() => ({ id: 9 }))
  const error = await withProjectExtractCommit(1, fingerprint, commit).catch(err => err)
  expect(error).toBeInstanceOf(ProjectCommitUnconfirmedError)
  expect(error.result).toEqual({ id: 9 })
  expect(commit).toHaveBeenCalledTimes(1)
 })
})
