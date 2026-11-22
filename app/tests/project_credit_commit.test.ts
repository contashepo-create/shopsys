import { beforeEach, expect, it, vi } from 'vitest'
const control = vi.hoisted(() => ({
  state: { projects: [] as unknown[], projectExtracts: [] as unknown[], journal: [] as unknown[], customers: [] as unknown[] },
  app: { fiscalYears: [] as unknown[], setup: {}, companySetup: {} },
  refresh: () => {}, failAfter: false,
}))
vi.mock('../src/data/repo.ts', () => ({ useRawDataStore: { getState: () => control.state, persist: { rehydrate: async () => { control.refresh() } } }, useDataStore: { getState: () => control.state } }))
vi.mock('../src/stores/app.store.ts', () => ({ useAppStore: { getState: () => control.app } }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (refresh: () => Promise<void>, commit: () => unknown) => {
  await refresh()
  const result = commit()
  if (control.failAfter) throw new Error('disk full')
  return result
} }))
import { projectCreditFingerprint, withProjectCreditCommit } from '../src/data/projectCreditCommit.ts'
import { ProjectCommitUnconfirmedError } from '../src/data/projectExtractCommit.ts'

beforeEach(() => {
  control.state = { projects: [{ id: 1 }], projectExtracts: [{ id: 1, projectId: 1 }], journal: [], customers: [] }
  control.app = { fiscalYears: [], setup: {}, companySetup: {} }
  control.refresh = () => {}; control.failAfter = false
})
it('يعيد التحميل تحت القفل ويرفض تغيير دليل حتى من فرع آخر قبل الترحيل', async () => {
  const basis = projectCreditFingerprint(1), commit = vi.fn()
  control.refresh = () => { control.state.journal.push({ id: 9, branchId: 2 }) }
  await expect(withProjectCreditCommit(1, basis, commit)).rejects.toThrow(/تغير أساس إشعار/)
  expect(commit).not.toHaveBeenCalled()
})
it('يرفض تغير الفترة أو العميل بعد المعاينة', async () => {
  const basis = projectCreditFingerprint(1), commit = vi.fn()
  control.app.fiscalYears.push({ status: 'closed' })
  await expect(withProjectCreditCommit(1, basis, commit)).rejects.toThrow(/تغير أساس إشعار/)
  control.app.fiscalYears = []; control.state.customers.push({ id: 7 })
  await expect(withProjectCreditCommit(1, basis, commit)).rejects.toThrow(/تغير أساس إشعار/)
  expect(commit).not.toHaveBeenCalled()
})
it('يميز خطأ الحفظ بعد الترحيل عن رفض الأساس السابق له', async () => {
  const basis = projectCreditFingerprint(1), commit = vi.fn(() => ({ id: 5 }))
  control.failAfter = true
  const error = await withProjectCreditCommit(1, basis, commit).catch(err => err)
  expect(error).toBeInstanceOf(ProjectCommitUnconfirmedError)
  expect(error.result).toEqual({ id: 5 }); expect(commit).toHaveBeenCalledOnce()
})
