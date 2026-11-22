import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore, DEFAULT_SYNC_SETTINGS } from '../src/stores/app.store.ts'
import { useRawDataStore } from '../src/data/repo.ts'

const { syncOnceMock } = vi.hoisted(() => ({ syncOnceMock: vi.fn() }))

vi.mock('../src/data/syncClient.ts', () => ({
  syncOnce: syncOnceMock,
  validateSyncConfig: () => [],
}))

vi.mock('../src/data/secureStorage.ts', () => ({
  encryptForDevice: vi.fn(async (plain: string) => `encrypted:${plain}`),
  decryptForDevice: vi.fn(async (stored: string) => stored.replace(/^encrypted:/, '')),
}))

import { canManageConflictSnapshots, getConflictSnapshotData, listConflictSnapshots, restoreConflictSnapshot, runSyncCycle } from '../src/data/syncRunner.ts'
import { decryptForDevice, encryptForDevice } from '../src/data/secureStorage.ts'

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
  useRawDataStore.setState({ journal: [], customers: [localCustomer], projectDeletionRecords: [] } as never)
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

  it('يحفظ لقطة مشفرة لكنه لا يستبدل التعديلات المحلية غير المدمجة', async () => {
    const result = await runSyncCycle()

    expect(result.ok).toBe(false)
    expect(result.message).toContain('لم تُدمج')
    expect(useRawDataStore.getState().customers).toEqual([localCustomer])
    expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
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

it('يرفض سحب نسخة قديمة تسقط سجل مشروع محذوف ولا يحدّث مراجعة السحابة', async () => {
  const deletion = { id: 7, code: 'PRJ-7', nameAr: 'مشروع', reason: 'إلغاء', at: '2026-01-01', by: 'المالك' }
  useRawDataStore.setState({ projectDeletionRecords: [deletion], projects: [] } as never)
  useAppStore.getState().updateSync({ dirty: false })
  syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], projects: [{ id: 7 }], customers: [remoteCustomer] }), message: 'سحب' })
  const result = await runSyncCycle()
  expect(result.ok).toBe(false)
  expect(result.message).toContain('سجل حذف المشروع')
  expect(useRawDataStore.getState().projectDeletionRecords).toEqual([deletion])
  expect(useRawDataStore.getState().projects).toEqual([])
  expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
})

it('يرفض استرجاع لقطة تعارض قديمة تسقط سجل الحذف بعد حفظ لقطة الحالة الحالية', async () => {
  const deletion = { id: 7, code: 'PRJ-7', nameAr: 'مشروع', reason: 'إلغاء', at: '2026-01-01', by: 'المالك' }
  useRawDataStore.setState({ projectDeletionRecords: [deletion], projects: [], currentUserId: null, loggedOut: false } as never)
  const at = '2026-10-24T12:00:00.000Z'
  localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], projects: [{ id: 7 }] })}` }]))
  const result = await restoreConflictSnapshot(at)
  expect(result.ok).toBe(false)
  expect(result.message).toContain('سجل حذف المشروع')
  expect(useRawDataStore.getState().projectDeletionRecords).toEqual([deletion])
  expect(useRawDataStore.getState().projects).toEqual([])
})

it('يرفض لقطة تعارض تسقط اليومية المحلية حتى بعد حفظ لقطة الأمان', async () => {
  const entry = { id: 1, entryNumber: 1, date: '2026-01-01', description: 'إيراد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdAt: '2026-01-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
  useRawDataStore.setState({ journal: [entry], currentUserId: null, loggedOut: false } as never)
  const at = '2026-10-24T12:00:00.000Z'
  localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], customers: [remoteCustomer] })}` }]))
  const result = await restoreConflictSnapshot(at)
  expect(result.ok).toBe(false)
  expect(result.message).toContain('تسقط قيوداً محلية')
  expect(useRawDataStore.getState().journal).toEqual([entry])
  expect(useRawDataStore.getState().customers).toEqual([localCustomer])
})

it('يرفض وارد السحابة الذي يعدّل بيانات قيد محلي ويحفظ مراجعة السحابة السابقة', async () => {
  const entry = { id: 1, entryNumber: 1, date: '2026-01-01', description: 'إيراد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdAt: '2026-01-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
  useRawDataStore.setState({ journal: [entry] } as never)
  useAppStore.getState().updateSync({ dirty: false })
  syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [{ ...entry, branchId: 3 }], treasuries: [], customers: [remoteCustomer] }), message: 'سحب' })
  const result = await runSyncCycle()
  expect(result.ok).toBe(false); expect(result.message).toContain('تغيّر بيانات القيد المحلي')
  expect(useRawDataStore.getState().journal).toEqual([entry]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
})

it('لا يثق بسنوات قديمة في بيانات السحابة عند التحقق من مرجع إقفال لن يُستعاد في الإعدادات', async () => {
  const closing = { id: 9, entryNumber: 9, date: '2025-12-31', description: 'إقفال', sourceType: 'year_closing', sourceId: 99, sourceCollection: 'fiscalYears', lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdAt: '2025-12-31', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
  useAppStore.setState({ fiscalYears: [] })
  useAppStore.getState().updateSync({ dirty: false })
  syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [closing], treasuries: [], fiscalYears: [{ id: 99, nameAr: '2025', status: 'closed', startDate: '2025-01-01', endDate: '2025-12-31' }] }), message: 'سحب' })
  const result = await runSyncCycle()
  expect(result.ok).toBe(false); expect(result.message).toContain('غير موجود')
  expect(useRawDataStore.getState().journal).toEqual([]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
})

it('يطبق سحباً نظيفاً عندما لم تتغير الحالة أثناء الشبكة', async () => {
  useAppStore.getState().updateSync({ dirty: false })
  const result = await runSyncCycle()
  expect(result).toMatchObject({ ok: true, action: 'pulled' })
  expect(useRawDataStore.getState().customers).toEqual([remoteCustomer])
  expect(useAppStore.getState().sync.lastKnownRev).toBe(2)
})

it.each(['pushed', 'noop'] as const)('يبقي علم التغيير عند تعديل المتجر أثناء %s', async action => {
  let finish!: (value: unknown) => void
  syncOnceMock.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const pending = runSyncCycle()
  useRawDataStore.setState({ customers: [{ id: 3, nameAr: 'تعديل أثناء الشبكة' }] } as never)
  finish({ action, newRev: 2, message: 'انتهت الشبكة' })
  const result = await pending
  expect(result.ok).toBe(true)
  expect(useAppStore.getState().sync.dirty).toBe(true)
  expect(useRawDataStore.getState().customers[0].nameAr).toBe('تعديل أثناء الشبكة')
})

it('لا يطبق السحب إذا تغير المتجر أثناء انتظار الشبكة حتى إن لم يعمل اشتراك dirty', async () => {
  useAppStore.getState().updateSync({ dirty: false })
  let finish!: (value: unknown) => void
  syncOnceMock.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const pending = runSyncCycle()
  useRawDataStore.setState({ customers: [{ id: 3, nameAr: 'تعديل أثناء الشبكة' }] } as never)
  finish({ action: 'pulled', newRev: 2, pulledData: pulled, message: 'سحب' })
  const result = await pending
  expect(result.ok).toBe(false)
  expect(result.message).toContain('لم تُدمج')
  expect(useRawDataStore.getState().customers[0].nameAr).toBe('تعديل أثناء الشبكة')
  expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
  expect(useAppStore.getState().sync.dirty).toBe(true)
})

it('يرفض سحب عرض باقٍ يفقد سجل تواصله التاريخي', async () => {
  const event = { customerId: 9, capturedAt: '2025-01-01T10:00:00', capturedBy: 'م', customerName: 'جهة', profile: { contactPerson: 'سارة' } }
  const quotation = { id: 11, customerContactHistory: [event] }
  useRawDataStore.setState({ quotations: [quotation], journal: [] } as never)
  useAppStore.getState().updateSync({ dirty: false })
  syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], quotations: [{ id: 11 }] }), message: 'سحب' })
  const result = await runSyncCycle()
  expect(result.ok).toBe(false); expect(result.message).toContain('سجل التواصل التاريخي')
  expect(useRawDataStore.getState().quotations).toEqual([quotation]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
})

it('يرفض سحب نسخة تسقط إذن صرف المواد المحلي قبل تطبيقها', async () => {
  const material = { id: 1, journalEntryId: 2, projectId: 1, status: 'issued' }
  useRawDataStore.setState({ materialRequisitions: [material], stockMoves: [], projectCosts: [], projectDeletionRecords: [], projects: [], quotations: [], journal: [] } as never)
  useAppStore.getState().updateSync({ dirty: false })
  syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], materialRequisitions: [] }), message: 'سحب' })
  const result = await runSyncCycle()
  expect(result.ok).toBe(false); expect(result.message).toContain('صرف المواد')
  expect(useRawDataStore.getState().materialRequisitions).toEqual([material]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
})

it('يرفض استعادة لقطة تعارض تسقط إذن صرف المواد المحلي', async () => {
  const material = { id: 1, journalEntryId: 2, projectId: 1, status: 'issued' }, at = '2026-10-24T12:00:00.000Z'
  useRawDataStore.setState({ materialRequisitions: [material], stockMoves: [], projectCosts: [], projectDeletionRecords: [], projects: [], quotations: [], journal: [], currentUserId: null, loggedOut: false } as never)
  localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], materialRequisitions: [] })}` }]))
  const result = await restoreConflictSnapshot(at)
  expect(result.ok).toBe(false); expect(result.message).toContain('صرف المواد')
  expect(useRawDataStore.getState().materialRequisitions).toEqual([material])
})

it('يرفض سحباً يعدل محضر كميات محلياً ولا يغير رقم المراجعة', async () => {
  const closeout = { id: 4, projectId: 1, basis: 'أصل' }
  useRawDataStore.setState({ projectCloseouts: [closeout], quotationDeletionRecords: [], surveyDeletionRecords: [], projectDeletionRecords: [], materialRequisitions: [], projects: [], quotations: [], journal: [] } as never)
  useAppStore.getState().updateSync({ dirty: false })
  syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], projectCloseouts: [{ ...closeout, basis: 'تغيير' }] }), message: 'سحب' })
  const result = await runSyncCycle()
  expect(result.ok).toBe(false); expect(result.message).toContain('سجل محاضر الكميات')
  expect(useRawDataStore.getState().projectCloseouts).toEqual([closeout]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
})
it('يفحص اللقطة الفعلية بعد الدمج الجزئي قبل سحب سجل حذف يعيد عرضاً محلياً', async () => {
  useRawDataStore.setState({ projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], projectDeletionRecords: [], materialRequisitions: [], projects: [], quotations: [{ id: 5 }], journal: [] } as never)
  useAppStore.getState().updateSync({ dirty: false })
  syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], quotationDeletionRecords: [{ id: 5 }] }), message: 'سحب' })
  const result = await runSyncCycle()
  expect(result.ok).toBe(false); expect(result.message).toContain('عرض سعر محذوف')
  expect(useRawDataStore.getState().quotations).toEqual([{ id: 5 }]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
})
it('يرفض استعادة تعارض تسقط سجل حذف حصر محلي', async () => {
  const deletion = { id: 6, projectId: 1 }, at = '2026-10-24T12:00:00.000Z'
  useRawDataStore.setState({ projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [deletion], projectDeletionRecords: [], materialRequisitions: [], projects: [], quotations: [], journal: [], currentUserId: null, loggedOut: false } as never)
  localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], surveyDeletionRecords: [] })}` }]))
  const result = await restoreConflictSnapshot(at)
  expect(result.ok).toBe(false); expect(result.message).toContain('سجل حذف الحصر'); expect(useRawDataStore.getState().surveyDeletionRecords).toEqual([deletion])
})
it('لا تستبدل استعادة التعارض تعديلًا حصل أثناء تشفير لقطة الأمان', async () => {
  const at = '2026-10-24T12:00:00.000Z'
  useRawDataStore.setState({ projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], projectDeletionRecords: [], materialRequisitions: [], projects: [], quotations: [], journal: [], customers: [localCustomer], currentUserId: null, loggedOut: false } as never)
  localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], customers: [remoteCustomer] })}` }]))
  let release!: (value: string) => void
  vi.mocked(encryptForDevice).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const pending = restoreConflictSnapshot(at)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  useRawDataStore.setState({ customers: [{ id: 3, nameAr: 'تعديل أثناء التشفير' }] } as never)
  release('encrypted:saved')
  const result = await pending
  expect(result.ok).toBe(false); expect(result.message).toContain('تغيرت البيانات أثناء حفظ لقطة الأمان')
  expect(useRawDataStore.getState().customers[0].nameAr).toBe('تعديل أثناء التشفير')
})

it('يرفض سجل حذف مشروع وارد إن كان المشروع المحلي سيبقى بعد الدمج الجزئي', async () => {
  useRawDataStore.setState({ projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], projectDeletionRecords: [], materialRequisitions: [], projects: [{ id: 7 }], quotations: [], journal: [] } as never)
  useAppStore.getState().updateSync({ dirty: false })
  syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], projectDeletionRecords: [{ id: 7 }] }), message: 'سحب' })
  const result = await runSyncCycle()
  expect(result.ok).toBe(false); expect(result.message).toContain('تعيد مشروعاً محذوفاً'); expect(useRawDataStore.getState().projects).toEqual([{ id: 7 }]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
})
it('يرفض استعادة تعارض جزئية تُحيي رابط مشروع محذوف يبقى محلياً', async () => {
  const at = '2026-10-24T12:00:00.000Z'
  useRawDataStore.setState({ projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], projectDeletionRecords: [], materialRequisitions: [], projects: [], quotations: [], projectTasks: [{ id: 9, projectId: 7 }], journal: [], currentUserId: null, loggedOut: false } as never)
  localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], projectDeletionRecords: [{ id: 7 }] })}` }]))
  const result = await restoreConflictSnapshot(at)
  expect(result.ok).toBe(false); expect(result.message).toContain('مستنداً مرتبطاً بمشروع محذوف'); expect(useRawDataStore.getState().projectTasks).toEqual([{ id: 9, projectId: 7 }])
})
it('يحافظ على الخروج المحلي عند سحب حالة جهاز آخر ولا يرفع معلومات الجلسة', async () => {
  useRawDataStore.setState({ projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], projectDeletionRecords: [], materialRequisitions: [], projects: [], quotations: [], projectTasks: [], journal: [], currentUserId: null, loggedOut: true } as never)
  useAppStore.getState().updateSync({ dirty: false })
  syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], customers: [remoteCustomer], loggedOut: false, currentUserId: 123 }), message: 'سحب' })
  expect((await runSyncCycle()).ok).toBe(true)
  expect(useRawDataStore.getState().loggedOut).toBe(true); expect(useRawDataStore.getState().currentUserId).toBeNull()
  const sent = JSON.parse(syncOnceMock.mock.calls.at(-1)![0].localData as string)
  expect(sent).not.toHaveProperty('loggedOut'); expect(sent).not.toHaveProperty('currentUserId')
})
it.each(['[]', 'null', '{"__proto__":{"polluted":true}}', '{"postSale":null}'])('يرفض لقطة سحابية غير صالحة أو تحاول استبدال دوال المتجر: %s', async raw => {
  useRawDataStore.setState({ projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], projectDeletionRecords: [], materialRequisitions: [], projects: [], quotations: [], projectTasks: [], journal: [], customers: [localCustomer] } as never)
  useAppStore.getState().updateSync({ dirty: false })
  const original = useRawDataStore.getState().postSale
  syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: raw, message: 'سحب' })
  const result = await runSyncCycle()
  expect(result.ok).toBe(false); expect(useRawDataStore.getState().postSale).toBe(original); expect(useRawDataStore.getState().customers).toEqual([localCustomer]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
})
it('لا يعيد فتح الجلسة أو استبدال دوال المتجر من لقطة تعارض محفوظة', async () => {
  const at = '2026-10-24T12:00:00.000Z'
  useRawDataStore.setState({ projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], projectDeletionRecords: [], materialRequisitions: [], projects: [], quotations: [], projectTasks: [], journal: [], currentUserId: null, loggedOut: false } as never)
  const original = useRawDataStore.getState().postSale
  localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: 'encrypted:{"postSale":null}' }]))
  expect((await restoreConflictSnapshot(at)).ok).toBe(false); expect(useRawDataStore.getState().postSale).toBe(original)
  localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], loggedOut: true, currentUserId: 5 })}` }]))
  expect((await restoreConflictSnapshot(at)).ok).toBe(true); expect(useRawDataStore.getState().currentUserId).toBeNull(); expect(useRawDataStore.getState().loggedOut).toBe(false)
})
it('يرفض المالك المعطل أو المكرر عند الوصول للقطات', () => {
  useRawDataStore.setState({ currentUserId: 9, loggedOut: false, appUsers: [{ id: 9, roleId: 'owner', active: false }] } as never)
  expect(canManageConflictSnapshots()).toBe(false)
  useRawDataStore.setState({ appUsers: [{ id: 9, roleId: 'owner', active: true }, { id: 9, roleId: 'owner', active: true }] } as never)
  expect(canManageConflictSnapshots()).toBe(false)
})
it('لا يستعيد لقطة بعد خروج المالك ولو عادت الجلسة نفسها أثناء حفظ نسخة الأمان', async () => {
  const at = '2026-10-24T12:00:00.000Z'
  useRawDataStore.setState({ projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], projectDeletionRecords: [], materialRequisitions: [], projects: [], quotations: [], projectTasks: [], journal: [], customers: [localCustomer], currentUserId: null, loggedOut: false } as never)
  localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], customers: [remoteCustomer] })}` }]))
  let release!: (value: string) => void
  vi.mocked(encryptForDevice).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const pending = restoreConflictSnapshot(at)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  useRawDataStore.setState({ loggedOut: true }); useRawDataStore.setState({ loggedOut: false })
  release('encrypted:saved')
  const result = await pending
  expect(result.ok).toBe(false); expect(result.message).toContain('تغيرت جلسة المالك'); expect(useRawDataStore.getState().customers).toEqual([localCustomer])
})
it.each(['get', 'list'] as const)('لا يسلم محتوى أو قائمة لقطة بعد تغير الجلسة أثناء فكها: %s', async method => {
  const at = '2026-10-24T12:00:00.000Z'
  useRawDataStore.setState({ currentUserId: null, loggedOut: false } as never)
  localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: 'encrypted:secret' }]))
  let release!: (value: string) => void
  vi.mocked(decryptForDevice).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const pending = method === 'get' ? getConflictSnapshotData(at) : listConflictSnapshots()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  useRawDataStore.setState({ currentUserId: 4 } as never)
  release('secret')
  expect(await pending).toEqual(method === 'get' ? null : [])
})
it('يحفظ لقطتي أمان متزامنتين دون إسقاط إحداهما ويمنع تكرار معرف الوقت', async () => {
  const at = '2026-10-24T12:00:00.000Z'
  useRawDataStore.setState({ projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], projectDeletionRecords: [], materialRequisitions: [], projects: [], quotations: [], projectTasks: [], journal: [], customers: [localCustomer], currentUserId: null, loggedOut: false } as never)
  localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], customers: [remoteCustomer] })}` }]))
  const releases: Array<(value: string) => void> = []
  vi.mocked(encryptForDevice).mockImplementation(() => new Promise(resolve => { releases.push(resolve) }))
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-24T12:00:00.000Z'))
  try {
    const one = restoreConflictSnapshot(at), two = restoreConflictSnapshot(at)
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    releases[1]('encrypted:second'); await Promise.resolve(); releases[0]('encrypted:first')
    const results = await Promise.all([one, two])
    expect(results.filter(result => result.ok)).toHaveLength(1)
    const rows = JSON.parse(localStorage.getItem('shopsys-conflict-snapshots')!) as { at: string; data: string }[]
    expect(rows.map(row => row.data)).toEqual([expect.any(String), 'encrypted:second', 'encrypted:first'])
    expect(new Set(rows.map(row => row.at)).size).toBe(3)
  } finally {
    clock.mockRestore(); vi.mocked(encryptForDevice).mockReset().mockImplementation(async plain => `encrypted:${plain}`)
  }
})
it('يرفض سحب السحابة الذي يسقط تحصيل محتجز محلي دون تحديث مراجعة السحابة', async () => {
  const release = { id: 6, projectId: 2, amountMinor: 50, journalEntryId: 8 }
  useRawDataStore.setState({ journal: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], projectExtracts: [], retentionReleases: [release] } as never)
  try {
    useAppStore.getState().updateSync({ dirty: false })
    syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], retentionReleases: [] }), message: 'سحب' })
    const result = await runSyncCycle()
    expect(result.ok).toBe(false); expect(result.message).toContain('تحصيل المحتجز')
    expect(useRawDataStore.getState().retentionReleases).toEqual([release]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
  } finally { useRawDataStore.setState({ retentionReleases: [] }) }
})
it('يرفض استرجاع تعارض يسقط دليل إشعار مستخلص محلي', async () => {
  const at = '2026-10-24T12:00:00.000Z'
  const extract = { id: 5, projectId: 2, refundedMinor: 10, refundedTaxMinor: 0, refunds: [{ amountMinor: 10, taxShareMinor: 0, journalEntryId: 7 }] }
  useRawDataStore.setState({ journal: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], retentionReleases: [], projectExtracts: [extract], loggedOut: false, currentUserId: null } as never)
  try {
    localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], projectExtracts: [{ ...extract, refunds: [] }] })}` }]))
    const result = await restoreConflictSnapshot(at)
    expect(result.ok).toBe(false); expect(result.message).toContain('دليل إشعار')
    expect(useRawDataStore.getState().projectExtracts).toEqual([extract])
  } finally { useRawDataStore.setState({ projectExtracts: [] }) }
})
it('يرفض سحب نسخة تسقط دفعة مقدمة محلية دون تغيير المراجعة', async () => {
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 0, journalEntryId: 7 }
  useRawDataStore.setState({ journal: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], projectExtracts: [], retentionReleases: [], clientAdvances: [advance] } as never)
  try {
    useAppStore.getState().updateSync({ dirty: false })
    syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], clientAdvances: [] }), message: 'سحب' })
    const result = await runSyncCycle()
    expect(result.ok).toBe(false); expect(result.message).toContain('أصل دفعة المقدمة')
    expect(useRawDataStore.getState().clientAdvances).toEqual([advance]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
  } finally { useRawDataStore.setState({ clientAdvances: [] }) }
})
it('يرفض استرجاع تعارض يغيّر أصل مبلغ دفعة مقدمة', async () => {
  const at = '2026-10-24T12:00:00.000Z'
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 0, journalEntryId: 7 }
  useRawDataStore.setState({ journal: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], retentionReleases: [], projectExtracts: [], clientAdvances: [advance], loggedOut: false, currentUserId: null } as never)
  try {
    localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], clientAdvances: [{ ...advance, amountMinor: 1000 }] })}` }]))
    const result = await restoreConflictSnapshot(at)
    expect(result.ok).toBe(false); expect(result.message).toContain('أصل دفعة المقدمة')
    expect(useRawDataStore.getState().clientAdvances).toEqual([advance])
  } finally { useRawDataStore.setState({ clientAdvances: [] }) }
})
it('يرفض سحب رصيد مقدمة متغير دون مستخلص موافق', async () => {
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 0, journalEntryId: 7 }
  useRawDataStore.setState({ journal: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], projectExtracts: [], retentionReleases: [], clientAdvances: [advance] } as never)
  try {
    useAppStore.getState().updateSync({ dirty: false })
    syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], clientAdvances: [{ ...advance, recoveredMinor: 100 }], projectExtracts: [] }), message: 'سحب' })
    const result = await runSyncCycle()
    expect(result.ok).toBe(false); expect(result.message).toContain('لا يطابق تغيّر مستخلصات')
    expect(useRawDataStore.getState().clientAdvances).toEqual([advance]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
  } finally { useRawDataStore.setState({ clientAdvances: [] }) }
})
it('يرفض استرجاع تعارض غير مطابق لتغير الاسترداد في المستخلص', async () => {
  const at = '2026-10-24T12:00:00.000Z'
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 0, journalEntryId: 7 }
  useRawDataStore.setState({ journal: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], retentionReleases: [], projectExtracts: [], clientAdvances: [advance], loggedOut: false, currentUserId: null } as never)
  try {
    localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], projectExtracts: [], clientAdvances: [{ ...advance, recoveredMinor: 100 }] })}` }]))
    const result = await restoreConflictSnapshot(at)
    expect(result.ok).toBe(false); expect(result.message).toContain('لا يطابق تغيّر مستخلصات')
    expect(useRawDataStore.getState().clientAdvances).toEqual([advance])
  } finally { useRawDataStore.setState({ clientAdvances: [] }) }
})
it('يرفض سحب استرداد مستخلص متغير وحده دون تحديث مراجعة السحابة', async () => {
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 100, journalEntryId: 7 }
  const extract = { id: 3, projectId: 1, advanceRecoveryMinor: 100 }
  useRawDataStore.setState({ journal: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], projectExtracts: [extract], retentionReleases: [], clientAdvances: [advance] } as never)
  try {
    useAppStore.getState().updateSync({ dirty: false })
    syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], clientAdvances: [advance], projectExtracts: [{ ...extract, advanceRecoveryMinor: 50 }] }), message: 'سحب' })
    const result = await runSyncCycle()
    expect(result.ok).toBe(false); expect(result.message).toContain('لا يطابق تغيّر مستخلصات')
    expect(useRawDataStore.getState().projectExtracts).toEqual([extract]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
  } finally { useRawDataStore.setState({ clientAdvances: [], projectExtracts: [] }) }
})
it('يرفض استرجاع تعارض يسقط استرداد مستخلص ويُبقي رصيد المقدمة', async () => {
  const at = '2026-10-24T12:00:00.000Z'
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 100, journalEntryId: 7 }
  const extract = { id: 3, projectId: 1, advanceRecoveryMinor: 100 }
  useRawDataStore.setState({ journal: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], retentionReleases: [], projectExtracts: [extract], clientAdvances: [advance], loggedOut: false, currentUserId: null } as never)
  try {
    localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], projectExtracts: [], clientAdvances: [advance] })}` }]))
    const result = await restoreConflictSnapshot(at)
    expect(result.ok).toBe(false); expect(result.message).toContain('لا يطابق تغيّر مستخلصات')
    expect(useRawDataStore.getState().projectExtracts).toEqual([extract])
  } finally { useRawDataStore.setState({ clientAdvances: [], projectExtracts: [] }) }
})
it('يرفض سحباً يسقط توزيع مقدمة موثق ويحفظ مراجعة السحابة', async () => {
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 100, journalEntryId: 7 }
  const extract = { id: 3, projectId: 1, journalEntryId: 9, advanceRecoveryMinor: 100, advanceAllocations: [{ advanceId: 4, journalEntryId: 7, amountMinor: 100 }] }
  useRawDataStore.setState({ journal: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], projectExtracts: [extract], retentionReleases: [], clientAdvances: [advance] } as never)
  try {
    useAppStore.getState().updateSync({ dirty: false })
    syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], clientAdvances: [advance], projectExtracts: [{ ...extract, advanceAllocations: undefined }] }), message: 'سحب' })
    const result = await runSyncCycle()
    expect(result.ok).toBe(false); expect(result.message).toContain('تسقط توزيع')
    expect(useRawDataStore.getState().projectExtracts).toEqual([extract]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
  } finally { useRawDataStore.setState({ clientAdvances: [], projectExtracts: [] }) }
})
it('يرفض استرجاع تعارض يحذف دليل تخصيص مقدمة موثق', async () => {
  const at = '2026-10-24T12:00:00.000Z'
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 100, journalEntryId: 7 }
  const extract = { id: 3, projectId: 1, journalEntryId: 9, advanceRecoveryMinor: 100, advanceAllocations: [{ advanceId: 4, journalEntryId: 7, amountMinor: 100 }] }
  useRawDataStore.setState({ journal: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], retentionReleases: [], projectExtracts: [extract], clientAdvances: [advance], loggedOut: false, currentUserId: null } as never)
  try {
    localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], projectExtracts: [{ ...extract, advanceAllocations: undefined }], clientAdvances: [advance] })}` }]))
    const result = await restoreConflictSnapshot(at)
    expect(result.ok).toBe(false); expect(result.message).toContain('تسقط توزيع')
    expect(useRawDataStore.getState().projectExtracts).toEqual([extract])
  } finally { useRawDataStore.setState({ clientAdvances: [], projectExtracts: [] }) }
})
it('يرفض سحباً يسقط توزيع قسيمة موثق دون تحديث المراجعة', async () => {
  const slip = { id: 1, employeeId: 1, projectAllocation: { version: 1, projects: [{ projectId: 1, basisPoints: 10000 }] } }
  useRawDataStore.setState({ journal: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], projectExtracts: [], retentionReleases: [], clientAdvances: [], payrollSlips: [slip] } as never)
  try {
    useAppStore.getState().updateSync({ dirty: false })
    syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], payrollSlips: [{ ...slip, projectAllocation: undefined }] }), message: 'سحب' })
    const result = await runSyncCycle()
    expect(result.ok).toBe(false); expect(result.message).toContain('توزيع الرواتب')
    expect(useRawDataStore.getState().payrollSlips).toEqual([slip]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
  } finally { useRawDataStore.setState({ payrollSlips: [] }) }
})
it('يرفض سحب السحابة الذي يحفظ التحصيل ويسقط مستخلصه المخصص', async () => {
  const extract = { id: 5, projectId: 9, journalEntryId: 2, totals: { retentionMinor: 100 } }
  const release = { id: 3, projectId: 9, amountMinor: 100, journalEntryId: 4, allocationEvidence: { version: 1, allocations: [{ extractId: 5, journalEntryId: 2, amountMinor: 100 }] } }
  useRawDataStore.setState({ journal: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], projectExtracts: [extract], retentionReleases: [release], clientAdvances: [], payrollSlips: [] } as never)
  useAppStore.getState().updateSync({ dirty: false })
  syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], projectExtracts: [], retentionReleases: [release] }), message: 'سحب' })
  try {
    const result = await runSyncCycle()
    expect(result.ok).toBe(false); expect(result.message).toContain('أساس توزيع تحصيل المحتجز')
    expect(useRawDataStore.getState().projectExtracts).toEqual([extract]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
  } finally { useRawDataStore.setState({ projectExtracts: [], retentionReleases: [] }) }
})
it('يرفض لقطة تعارض تسقط مستخلص تحصيل موزع', async () => {
  const extract = { id: 5, projectId: 9, journalEntryId: 2, totals: { retentionMinor: 100 } }
  const release = { id: 3, projectId: 9, amountMinor: 100, journalEntryId: 4, allocationEvidence: { version: 1, allocations: [{ extractId: 5, journalEntryId: 2, amountMinor: 100 }] } }
  useRawDataStore.setState({ journal: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], projectExtracts: [extract], retentionReleases: [release], clientAdvances: [], payrollSlips: [], loggedOut: false, currentUserId: null } as never)
  const at = '2026-10-24T12:00:00.000Z'
  localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], projectExtracts: [], retentionReleases: [release] })}` }]))
  try {
    const result = await restoreConflictSnapshot(at)
    expect(result.ok).toBe(false); expect(result.message).toContain('أساس توزيع تحصيل المحتجز')
    expect(useRawDataStore.getState().projectExtracts).toEqual([extract])
  } finally { useRawDataStore.setState({ projectExtracts: [], retentionReleases: [] }) }
})
it('يرفض إضافة رد ماكينة تحصيل المحتجز إلى سحب سحابي دون مسار تسوية', async () => {
  const charge = { id: 't1', idempotencyKey: 'p', kind: 'charge', terminalId: 'm', branchId: '', userId: 0, documentType: 'project_extract', documentId: 'retention:3', amountMinor: 100, providerReference: 'r', occurredAt: '2025-01-01' }
  const release = { id: 3, projectId: 9, amountMinor: 100, journalEntryId: 4, paymentEvidence: { version: 1, treasuryCode: '1101', terminalCharge: charge } }
  useRawDataStore.setState({ journal: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], projectExtracts: [], retentionReleases: [release], paymentTerminalTransactions: [charge], clientAdvances: [], payrollSlips: [] } as never)
  useAppStore.getState().updateSync({ dirty: false })
  const reversal = { ...charge, id: 'r1', kind: 'refund', originalTransactionId: charge.id }
  syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], projectExtracts: [], retentionReleases: [release], paymentTerminalTransactions: [charge, reversal] }), message: 'سحب' })
  try {
    const result = await runSyncCycle()
    expect(result.ok).toBe(false); expect(result.message).toContain('رد ماكينة تحصيل المحتجز')
    expect(useRawDataStore.getState().paymentTerminalTransactions).toEqual([charge]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
  } finally { useRawDataStore.setState({ retentionReleases: [], paymentTerminalTransactions: [] }) }
})
it('يرفض سحب اليومية إذا أضاف قيداً آخر بمعرف محلي، ولا يتقدم إصدار السحابة', async () => {
  const entry = { id: 1, entryNumber: 1, date: '2026-01-01', description: 'قيد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdAt: '2026-01-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
  useRawDataStore.setState({ journal: [entry] } as never)
  useAppStore.getState().updateSync({ dirty: false })
  syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [entry, { ...entry, description: 'مكرر' }], treasuries: [] }), message: 'سحب' })
  const result = await runSyncCycle()
  expect(result.ok).toBe(false); expect(result.message).toContain('معرف قيد غير صالح أو مكرراً')
  expect(useRawDataStore.getState().journal).toEqual([entry]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
})
it('يرفض سحباً يرد حركة ماكينة محتجز قديمة مرتبطة بالمستند دون تسوية', async () => {
  const charge = { id: 't1', kind: 'charge', documentType: 'project_extract', documentId: 'retention:3', amountMinor: 100 }
  const release = { id: 3, projectId: 9, amountMinor: 100, journalEntryId: 4 }
  useRawDataStore.setState({ journal: [], projects: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], projectExtracts: [], retentionReleases: [release], paymentTerminalTransactions: [charge], clientAdvances: [], payrollSlips: [] } as never)
  useAppStore.getState().updateSync({ dirty: false })
  syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], projectExtracts: [], retentionReleases: [release], paymentTerminalTransactions: [charge, { ...charge, id: 'r1', kind: 'refund', originalTransactionId: 't1' }] }), message: 'سحب' })
  try {
    const result = await runSyncCycle()
    expect(result.ok).toBe(false); expect(result.message).toContain('رد ماكينة تحصيل المحتجز')
    expect(useRawDataStore.getState().paymentTerminalTransactions).toEqual([charge]); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
  } finally { useRawDataStore.setState({ retentionReleases: [], paymentTerminalTransactions: [] }) }
})

it('يرفض خفض عداد الخطابات عند سحب السحابة ويبقي المراجعة المحلية', async () => {
  const original = useRawDataStore.getState().letterNumberCounters
  try {
    useRawDataStore.setState({ journal: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], projects: [], quotations: [], projectTasks: [], letterNumberCounters: { 'branch-2:2026': 5 } } as never)
    useAppStore.getState().updateSync({ dirty: false })
    syncOnceMock.mockResolvedValue({ action: 'pulled', newRev: 2, pulledData: JSON.stringify({ journal: [], treasuries: [], letterNumberCounters: { 'branch-2:2026': 2 } }), message: 'سحب' })
    const result = await runSyncCycle()
    expect(result.ok).toBe(false); expect(result.message).toContain('عداد الخطابات')
    expect(useRawDataStore.getState().letterNumberCounters['branch-2:2026']).toBe(5); expect(useAppStore.getState().sync.lastKnownRev).toBe(1)
  } finally { useRawDataStore.setState({ letterNumberCounters: original }) }
})
it('يرفض لقطة تعارض تخفض العداد ويقبل جزئية لا تستبدله', async () => {
  const at = '2026-10-24T12:00:00.000Z', original = useRawDataStore.getState().letterNumberCounters
  try {
    useRawDataStore.setState({ journal: [], projectDeletionRecords: [], projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], materialRequisitions: [], projects: [], quotations: [], projectTasks: [], currentUserId: null, loggedOut: false, letterNumberCounters: { 'branch-2:2026': 5 } } as never)
    localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [], letterNumberCounters: { 'branch-2:2026': 1 } })}` }]))
    const result = await restoreConflictSnapshot(at)
    expect(result.ok).toBe(false); expect(result.message).toContain('عداد الخطابات'); expect(useRawDataStore.getState().letterNumberCounters['branch-2:2026']).toBe(5)
    localStorage.setItem('shopsys-conflict-snapshots', JSON.stringify([{ at, data: `encrypted:${JSON.stringify({ journal: [], treasuries: [] })}` }]))
    expect((await restoreConflictSnapshot(at)).ok).toBe(true); expect(useRawDataStore.getState().letterNumberCounters['branch-2:2026']).toBe(5)
  } finally { useRawDataStore.setState({ letterNumberCounters: original }) }
})
