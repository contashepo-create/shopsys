import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore, DEFAULT_SYNC_SETTINGS } from '../src/stores/app.store.ts'
import { useRawDataStore } from '../src/data/repo.ts'

const { syncOnceMock } = vi.hoisted(() => ({ syncOnceMock: vi.fn() }))

vi.mock('../src/data/syncClient.ts', () => ({
  syncOnce: syncOnceMock,
  validateSyncConfig: () => [],
}))

vi.mock('../src/data/secureStorage.ts', () => ({
  encryptForDevice: async (plain: string) => `encrypted:${plain}`,
  decryptForDevice: async (stored: string) => stored.replace(/^encrypted:/, ''),
}))

import { restoreConflictSnapshot, runSyncCycle } from '../src/data/syncRunner.ts'

const SYNC_CONFIG = {
  enabled: true,
  url: 'https://demo.supabase.co',
  anonKey: 'a'.repeat(40),
  storeId: 'test-store',
  secret: 's'.repeat(43),
  accessToken: 't'.repeat(43),
  lastKnownRev: 1,
  lastSyncedAt: null,
  lastResult: null,
  dirty: true,
}

const localCustomer = { id: 1, nameAr: 'تغيير محلي غير مدفوع' }
const remoteCustomer = { id: 2, nameAr: 'تغيير الجهاز الآخر' }
const pulled = JSON.stringify({ journal: [], treasuries: [], customers: [remoteCustomer] })

beforeEach(() => {
  localStorage.clear()
  syncOnceMock.mockReset().mockResolvedValue({
    action: 'pulled',
    newRev: 2,
    pulledData: pulled,
    message: 'تم سحب مراجعة أحدث',
  })
  useAppStore.setState((state) => ({
    ...state,
    sync: { ...DEFAULT_SYNC_SETTINGS, ...SYNC_CONFIG },
  }))
  useRawDataStore.setState({ journal: [], customers: [localCustomer] } as never)
})

describe('سلامة لقطة التعارض قبل تطبيق السحابة', () => {
  it('يرفض تطبيق الحالة الواردة إذا فشل حفظ لقطة التغييرات المحلية', async () => {
    const originalSetItem = Storage.prototype.setItem
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'shopsys-conflict-snapshots') throw new DOMException('quota exceeded', 'QuotaExceededError')
      originalSetItem.call(this, key, value)
    })

    const result = await runSyncCycle()

    expect(result.ok).toBe(false)
    expect(result.message).toContain('لم تُطبَّق حالة السحابة')
    expect(useRawDataStore.getState().customers).toEqual([localCustomer])
    expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
    expect(useAppStore.getState().sync.dirty).toBe(true)
    setItemSpy.mockRestore()
  })

  it('يطبق الحالة الواردة بعد نجاح حفظ اللقطة المشفرة', async () => {
    const result = await runSyncCycle()

    expect(result).toMatchObject({ ok: true, action: 'pulled' })
    expect(useRawDataStore.getState().customers).toEqual([remoteCustomer])
    expect(useAppStore.getState().sync.lastKnownRev).toBe(2)
    expect(useAppStore.getState().sync.dirty).toBe(true)
    const snapshots = JSON.parse(localStorage.getItem('shopsys-conflict-snapshots') ?? '[]') as { data: string }[]
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].data).toContain('encrypted:')
    expect(snapshots[0].data).toContain('تغيير محلي غير مدفوع')
  })

  it('لا يستبدل المتجر عند استعادة لقطة إذا تعذر حفظ الحالة الحالية أولاً', async () => {
    const at = '2026-10-24T12:00:00.000Z'
    localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{
      at,
      data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], customers: [remoteCustomer] })}`,
    }]))
    useRawDataStore.setState({ loggedOut: false, currentUserId: null } as never)
    const originalSetItem = Storage.prototype.setItem
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'shopsys-conflict-snapshots') throw new DOMException('quota exceeded', 'QuotaExceededError')
      originalSetItem.call(this, key, value)
    })

    const result = await restoreConflictSnapshot(at)

    expect(result.ok).toBe(false)
    expect(result.message).toContain('لم تُستبدل بيانات المتجر')
    expect(useRawDataStore.getState().customers).toEqual([localCustomer])
    setItemSpy.mockRestore()
  })
})
