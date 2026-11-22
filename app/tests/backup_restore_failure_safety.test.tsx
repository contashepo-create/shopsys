import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BackupPage } from '../src/ui/pages/BackupPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import * as persistence from '../src/data/persistentStorage.ts'
import * as secure from '../src/data/secureStorage.ts'
import { buildBackup } from '../src/core/backup.ts'
import { useToast } from '../src/ui/components/ui.tsx'

const data = useRawDataStore.getState(), app = useAppStore.getState()
const years = [{ id: 4, branchId: 2, status: 'closed' as const, startDate: '2025-01-01', endDate: '2025-12-31', nameAr: '2025' }]
const closing = { id: 1, entryNumber: 1, date: '2025-12-31', description: 'إقفال', sourceType: 'year_closing', sourceId: 99, sourceCollection: 'fiscalYears', branchId: 2, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdBy: 'test', createdAt: '2025-12-31', reversedByEntryId: null, reversesEntryId: null }
const backup = (store: object, appState: unknown = null) => buildBackup({ appState, storeState: { state: store }, appDataVersion: 1, shopName: 'اختبار' })
async function selectBackup(value: ReturnType<typeof backup>) {
  const view = render(<BackupPage />)
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File([JSON.stringify(value)], 'backup.json', { type: 'application/json' })] } })
  await screen.findByText('نسخة سليمة — البصمة مطابقة')
  fireEvent.change(screen.getByPlaceholderText('اكتب هنا…'), { target: { value: 'استبدال' } })
  return screen.getByText('استعادة الآن')
}
beforeEach(() => {
  useRawDataStore.setState({ ...data, projectDeletionRecords: [], projects: [] })
  useAppStore.setState({ fiscalYears: years })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); useRawDataStore.setState(data); useAppStore.setState(app); useToast.getState().clear() })

it('عند غياب إعدادات النسخة يفحص مرجع الإقفال مقابل السنوات التي ستبقى فعلاً وليس حقلاً قديماً داخل البيانات', async () => {
  const write = vi.fn()
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [closing], treasuries: [], fiscalYears: [{ ...years[0], id: 99 }] }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().kind).toBe('error'))
  expect(useToast.getState().msg).toContain('غير موجود')
  expect(write).not.toHaveBeenCalled()
})
it('يرفض سنوات مالية تالفة قبل كتابة أي مخزن', async () => {
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [] }, { state: { fiscalYears: 'bad' } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('السنوات المالية'))
  expect(write).not.toHaveBeenCalled()
})
it('الختم بعد تغيير السر يوقف الاستعادة قبل كتابة الإعدادات', async () => {
  vi.spyOn(secure, 'isStorageSealed').mockReturnValue(true)
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [] }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('مختوم'))
  expect(write).not.toHaveBeenCalled()
})
it('فشل كتابة البيانات بعد الإعدادات يظهر تحذيراً ثابتاً ويعطّل تكرار الاستعادة في الصفحة', async () => {
  const setting = vi.fn(async () => undefined), store = vi.fn(async () => { throw new Error('disk failed') })
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: setting, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: store, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [] }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('قد تكون الإعدادات أو البيانات قد تغيرت جزئياً'))
  expect(setting).toHaveBeenCalledTimes(1); expect(store).toHaveBeenCalledTimes(1)
  expect((screen.getByText('استعادة الآن').closest('button') as HTMLButtonElement).disabled).toBe(true)
})

it('يرفض نسخة قديمة تحذف قيداً محلياً قبل كتابة أي مخزن', async () => {
  const local = { id: 1, entryNumber: 1, date: '2025-01-01', description: 'إيراد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdAt: '2025-01-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
  useRawDataStore.setState({ journal: [local] } as never)
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [] }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('تسقط قيوداً محلية'))
  expect(write).not.toHaveBeenCalled(); expect(useRawDataStore.getState().journal).toEqual([local])
})

it('يرفض استعادة إعدادات تفتح فترة مقفلة محلياً قبل أي كتابة', async () => {
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [] }, { state: { fiscalYears: [{ ...years[0], status: 'open' }] } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('تغيّر السنة المالية المحلية'))
  expect(write).not.toHaveBeenCalled()
})

it('يرفض قيداً إضافياً في فترة محلية مقفلة حتى لو حفظت النسخة القيود السابقة', async () => {
  const local = { id: 1, entryNumber: 1, branchId: 2, date: '2025-01-01', description: 'إيراد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdAt: '2025-01-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
  useRawDataStore.setState({ journal: [local] } as never)
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [local, { ...local, id: 2, entryNumber: 2 }], treasuries: [] }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('السنة المالية المقفلة'))
  expect(write).not.toHaveBeenCalled()
})

it('يرفض إسقاط سجل التواصل من مستند باقٍ قبل كتابة النسخة', async () => {
  const event = { customerId: 9, capturedAt: '2025-01-01T10:00:00', capturedBy: 'م', customerName: 'جهة', profile: { contactPerson: 'سارة' } }
  const project = { id: 11, customerContactHistory: [event] }
  useRawDataStore.setState({ projects: [project] } as never)
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [], projects: [{ id: 11 }] }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('سجل التواصل التاريخي'))
  expect(write).not.toHaveBeenCalled()
})
it('يرفض نسخة تُسقط إذن صرف المواد المحلي قبل كتابة أي مخزن', async () => {
  useRawDataStore.setState({ materialRequisitions: [{ id: 1, journalEntryId: 4, projectId: 1, status: 'issued' }], stockMoves: [], projectCosts: [], journal: [] } as never)
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [], materialRequisitions: [] }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('صرف المواد'))
  expect(write).not.toHaveBeenCalled(); expect(useRawDataStore.getState().materialRequisitions).toHaveLength(1)
})

it('يرفض استعادة نسخة تحذف محضر كميات محلياً قبل كتابة الإعدادات والبيانات', async () => {
  const closeout = { id: 4, projectId: 1, basis: 'محضر' }
  useRawDataStore.setState({ projectCloseouts: [closeout], quotationDeletionRecords: [], surveyDeletionRecords: [], journal: [] } as never)
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [], projectCloseouts: [] }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('سجل محاضر الكميات'))
  expect(write).not.toHaveBeenCalled(); expect(useRawDataStore.getState().projectCloseouts).toEqual([closeout])
})
it('يرفض نسخة تعيد عرضاً محذوفاً مع سجله حتى إن لم يكن هناك سجل محلي', async () => {
  useRawDataStore.setState({ projectCloseouts: [], quotationDeletionRecords: [], surveyDeletionRecords: [], journal: [], quotations: [] } as never)
  const write = vi.fn()
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [], quotationDeletionRecords: [{ id: 5 }], quotations: [{ id: 5 }] }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('عرض سعر محذوف'))
  expect(write).not.toHaveBeenCalled()
})

it.each(['data', 'settings'] as const)('يرفض نسخة تحاول استبدال إجراء %s قبل كتابة أي مخزن', async which => {
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const store = which === 'data' ? { journal: [], treasuries: [], postSale: null } : { journal: [], treasuries: [] }
  const settings = which === 'settings' ? { state: { fiscalYears: years, setBackupIntervalMinutes: null } } : { state: { fiscalYears: years } }
  const button = await selectBackup(backup(store, settings))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('حقلاً محظوراً'))
  expect(write).not.toHaveBeenCalled(); expect(typeof useRawDataStore.getState().postSale).toBe('function'); expect(typeof useAppStore.getState().setBackupIntervalMinutes).toBe('function')
})
it('يرفض غلاف إعدادات بحالة فارغة غير صالحة بدلاً من اعتباره إعدادات قديمة', async () => {
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [] }, { state: null }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('حالة المتجر أو الإعدادات'))
  expect(write).not.toHaveBeenCalled()
})
it('عند تغير البيانات أثناء انتظار حفظ الإعدادات يحذر ولا يكتب البيانات المستعادة حتى لو أُعيدت الحالة', async () => {
  let release!: () => void
  const setting = vi.fn(() => new Promise<void>(resolve => { release = resolve })), store = vi.fn(async () => undefined)
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: setting, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: store, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [] }, { state: { fiscalYears: years } }))
  fireEvent.click(button); await waitFor(() => expect(setting).toHaveBeenCalledTimes(1))
  const old = useRawDataStore.getState().customers
  useRawDataStore.setState({ customers: [{ id: 99, nameAr: 'تغيير متزامن' }] } as never)
  useRawDataStore.setState({ customers: old })
  release()
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('تغيرت البيانات أو الإعدادات أثناء الاستعادة'))
  expect(store).not.toHaveBeenCalled(); expect((screen.getByText('استعادة الآن').closest('button') as HTMLButtonElement).disabled).toBe(true)
})
it('بعد بدء كتابة البيانات لا يدعي نجاح الاستعادة إذا تغيرت الإعدادات في انتظار التأكيد', async () => {
  let release!: () => void
  const store = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: store, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [] }))
  fireEvent.click(button); await waitFor(() => expect(store).toHaveBeenCalledTimes(1))
  useAppStore.setState({ backupIntervalMinutes: 25 }); release()
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('تغيرت البيانات أو الإعدادات أثناء الاستعادة'))
  expect(useToast.getState().kind).toBe('error'); expect((screen.getByText('استعادة الآن').closest('button') as HTMLButtonElement).disabled).toBe(true)
})
it('يرفض تأكيد الاستعادة إن تغير جيل السر أثناء كتابة الإعدادات', async () => {
  let release!: () => void, generation = 1
  vi.spyOn(secure, 'storageWriteGeneration').mockImplementation(() => generation)
  const setting = vi.fn(() => new Promise<void>(resolve => { release = resolve })), store = vi.fn(async () => undefined)
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: setting, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: store, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [] }, { state: { fiscalYears: years } }))
  fireEvent.click(button); await waitFor(() => expect(setting).toHaveBeenCalledTimes(1))
  generation = 2; release()
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('تغير مفتاح التخزين'))
  expect(store).not.toHaveBeenCalled()
})
it('يرفض نسخة تسقط تحصيل محتجز محلي قبل كتابة الإعدادات أو البيانات', async () => {
  const release = { id: 3, projectId: 9, amountMinor: 100, journalEntryId: 4 }
  useRawDataStore.setState({ retentionReleases: [release], projectExtracts: [] } as never)
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [], retentionReleases: [] }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('تحصيل المحتجز'))
  expect(write).not.toHaveBeenCalled(); expect(useRawDataStore.getState().retentionReleases).toEqual([release])
})
it('يرفض استعادة نسخة تُسقط أصل دفعة مقدمة قبل كتابة أي مخزن', async () => {
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 0, journalEntryId: 7 }
  useRawDataStore.setState({ clientAdvances: [advance], journal: [] } as never)
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [], clientAdvances: [] }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('أصل دفعة المقدمة'))
  expect(write).not.toHaveBeenCalled(); expect(useRawDataStore.getState().clientAdvances).toEqual([advance])
})
it('يرفض استعادة تغير رصيد مقدمة دون مستخلص موافق قبل كتابة المخزنين', async () => {
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 0, journalEntryId: 7 }
  useRawDataStore.setState({ clientAdvances: [advance], projectExtracts: [], journal: [] } as never)
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [], clientAdvances: [{ ...advance, recoveredMinor: 100 }], projectExtracts: [] }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('لا يطابق تغيّر مستخلصات'))
  expect(write).not.toHaveBeenCalled(); expect(useRawDataStore.getState().clientAdvances).toEqual([advance])
})
it('يرفض استعادة تغيّر استرداد مستخلص وحده قبل كتابة أي مخزن', async () => {
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 100, journalEntryId: 7 }
  const extract = { id: 3, projectId: 1, advanceRecoveryMinor: 100 }
  useRawDataStore.setState({ clientAdvances: [advance], projectExtracts: [extract], journal: [] } as never)
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [], clientAdvances: [advance], projectExtracts: [{ ...extract, advanceRecoveryMinor: 50 }] }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('لا يطابق تغيّر مستخلصات'))
  expect(write).not.toHaveBeenCalled(); expect(useRawDataStore.getState().projectExtracts).toEqual([extract])
})
it('يرفض استعادة تحذف تخصيص مقدمة موثق دون كتابة مخزني JSON', async () => {
  const advance = { id: 4, projectId: 1, date: '2026-01-01', amountMinor: 500, recoveredMinor: 100, journalEntryId: 7 }
  const extract = { id: 3, projectId: 1, journalEntryId: 9, advanceRecoveryMinor: 100, advanceAllocations: [{ advanceId: 4, journalEntryId: 7, amountMinor: 100 }] }
  useRawDataStore.setState({ clientAdvances: [advance], projectExtracts: [extract], journal: [] } as never)
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [], clientAdvances: [advance], projectExtracts: [{ ...extract, advanceAllocations: undefined }] }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('تسقط توزيع'))
  expect(write).not.toHaveBeenCalled(); expect(useRawDataStore.getState().projectExtracts).toEqual([extract])
})
it('يرفض استعادة JSON تسقط لقطة توزيع راتب قسيمة قبل كتابة المخزنين', async () => {
  const slip = { id: 1, employeeId: 1, projectAllocation: { version: 1, projects: [{ projectId: 1, basisPoints: 10000 }] } }
  useRawDataStore.setState({ payrollSlips: [slip], journal: [] } as never)
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [], payrollSlips: [{ ...slip, projectAllocation: undefined }] }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('توزيع الرواتب'))
  expect(write).not.toHaveBeenCalled(); expect(useRawDataStore.getState().payrollSlips).toEqual([slip])
})
it('يرفض JSON يسقط المستخلص المخصص رغم حفظ التحصيل قبل بدء أي كتابة', async () => {
  const extract = { id: 5, projectId: 9, journalEntryId: 2, totals: { retentionMinor: 100 } }
  const release = { id: 3, projectId: 9, amountMinor: 100, journalEntryId: 4, allocationEvidence: { version: 1, allocations: [{ extractId: 5, journalEntryId: 2, amountMinor: 100 }] } }
  useRawDataStore.setState({ projectExtracts: [extract], retentionReleases: [release], clientAdvances: [], journal: [], projects: [], payrollSlips: [] } as never)
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [], projectExtracts: [], retentionReleases: [release], clientAdvances: [] }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('أساس توزيع تحصيل المحتجز'))
  expect(write).not.toHaveBeenCalled(); expect(useRawDataStore.getState().projectExtracts).toEqual([extract])
})
it('يرفض نسخة JSON تضيف قيداً بمعرف محلي مكرر قبل كتابة أي مخزن', async () => {
  const entry = { id: 1, entryNumber: 1, date: '2026-01-01', description: 'قيد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdAt: '2026-01-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
  useRawDataStore.setState({ journal: [entry] } as never)
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [entry, { ...entry, description: 'مكرر' }], treasuries: [] }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('معرف قيد غير صالح أو مكرراً'))
  expect(write).not.toHaveBeenCalled(); expect(useRawDataStore.getState().journal).toEqual([entry])
})

it('يرفض نسخة قديمة تخفض عداد الخطابات حتى بعد حذف الخطاب، قبل كتابة أي مخزن', async () => {
  useRawDataStore.setState({ letterNumberCounters: { 'branch-2:2026': 7 } })
  const write = vi.fn()
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: vi.fn(), setItem: write, removeItem: vi.fn() })
  const button = await selectBackup(backup({ journal: [], treasuries: [], letterNumberCounters: { 'branch-2:2026': 3 } }, { state: { fiscalYears: years } }))
  fireEvent.click(button)
  await waitFor(() => expect(useToast.getState().msg).toContain('عداد الخطابات'))
  expect(write).not.toHaveBeenCalled(); expect(useRawDataStore.getState().letterNumberCounters['branch-2:2026']).toBe(7)
})
