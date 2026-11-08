import { afterEach, expect, it, vi } from 'vitest'

const shared = vi.hoisted(() => ({
 state: { activeBranchId: 1, projects: [{ id: 1 }], boqItems: [{ id: 1, projectId: 1, qty: 1000 }], projectExtracts: [] as { id: number; projectId: number }[], projectSurveys: [] as unknown[], projectExtractDrafts: [] as unknown[], clientAdvances: [] as unknown[], changeOrders: [] as unknown[] },
 refreshes: 0,
}))
vi.mock('../src/data/repo.ts', () => ({
 useDataStore: { getState: () => shared.state },
 useRawDataStore: { persist: { rehydrate: async () => { shared.refreshes++ } } },
}))
vi.mock('../src/data/desktopBridge.ts', () => ({ desktopBridge: () => null }))
vi.mock('../src/data/persistentStorage.ts', () => ({ flushPendingDesktopSnapshots: vi.fn(), refreshDesktopSnapshot: vi.fn() }))
vi.mock('../src/data/secureStorage.ts', () => ({ flushSecureStorageWrites: vi.fn(async () => {}) }))
import { projectExtractFingerprint, withProjectExtractCommit } from '../src/data/projectExtractCommit.ts'
import { flushSecureStorageWrites } from '../src/data/secureStorage.ts'

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
it('مسار Web Locks يعيد التحميل ويصد معاينة متزامنة قديمة قبل إنشاء قيد ثانٍ', async () => {
 shared.state.projectExtracts = []; shared.refreshes = 0
 let queue: Promise<unknown> = Promise.resolve()
 const request = vi.fn((_name: string, _options: unknown, callback: () => Promise<unknown>) => {
  const result = queue.then(callback)
  queue = result.catch(() => {})
  return result
 })
 vi.stubGlobal('navigator', { locks: { request } })
 const fingerprint = projectExtractFingerprint(shared.state as never, 1)
 const commit = vi.fn(() => { shared.state.projectExtracts.push({ id: 1, projectId: 1 }); return 1 })
 const first = withProjectExtractCommit(1, fingerprint, commit)
 const second = withProjectExtractCommit(1, fingerprint, commit)
 expect(await first).toBe(1)
 await expect(second).rejects.toThrow(/تغير المشروع/)
 expect(request).toHaveBeenCalledTimes(2)
 expect(shared.refreshes).toBe(2)
 expect(commit).toHaveBeenCalledTimes(1)
 expect(vi.mocked(flushSecureStorageWrites)).toHaveBeenCalledTimes(3)
})
it('يرفض الترحيل إن لم تتوفر Web Locks ولا ينفذ الترحيل', async () => {
 vi.stubGlobal('navigator', {})
 const commit = vi.fn()
 await expect(withProjectExtractCommit(1, projectExtractFingerprint(shared.state as never, 1), commit)).rejects.toThrow(/لا يدعم قفل/)
 expect(commit).not.toHaveBeenCalled()
})
