import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
  const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[], allowNegativeTreasury: true }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], boqItems: [], projectExtracts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], sales: [], saleReturns: [], vouchers: [], clientSettlements: [], changeOrders: [], paymentTerminals: [], paymentTerminalTransactions: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
})
afterEach(() => { useRawDataStore.setState(initial); useAppStore.setState(app); vi.useRealTimers() })
function setup(payment: 'cash' | 'credit' = 'credit', retentionPercent = 10) {
  const project = S().addProject({ nameAr: 'مشروع', clientId: S().customers[0].id, clientName: 'عميل', contractValueMinor: 10000, retentionPercent, startDate: '2025-01-01', notes: '' })
  const item = S().addBoqItem({ projectId: project.id, code: '1', descriptionAr: 'أعمال', unit: 'م', qty: 100, unitPriceMinor: 100 })
  S().receiveClientAdvance({ projectId: project.id, amountMinor: 3000, treasury: '1101' })
  const extract = S().addProjectExtract({ projectId: project.id, description: 'أعمال', payment, vatPercent: 15, advanceRecoveryMinor: 2000, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 100 }] })
  return { project, item, extract }
}
function args(extractId: number, boqItemId: number, qty: number) {
  return { extractId, quantities: [{ boqItemId, qty }], amountMinor: qty * 105, mode: 'customer_credit' as const, reason: 'رفض أعمال', restoredAdvanceMinor: 0 }
}
it('الصفر المختار يترك استرداد المقدمة وقيده كما هما ويعكس الإيراد والضريبة والمحتجز والذمة', () => {
  const { project, item, extract } = setup()
  S().receiveClientPayment({ customerId: S().customers[0].id, amountMinor: 2000, treasury: '1101', specificDocKey: `extract:${extract.id}` })
  const advances = structuredClone(S().clientAdvances)
  const credit = S().refundProjectExtract(args(extract.id, item.id, 40))
  expect(S().clientAdvances).toEqual(advances)
  expect(credit.refunds![0]).toMatchObject({ amountMinor: 4200, taxShareMinor: 600, retentionMinor: 400, restoredAdvanceMinor: 0 })
  const lines = S().journal.at(-1)!.lines
  expect(lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '4102', debit: 4000 }), expect.objectContaining({ accountCode: '2102', debit: 600 }), expect.objectContaining({ accountCode: '1105', credit: 400 }), expect.objectContaining({ accountCode: '1104', credit: 4200 })]))
  expect(lines.some(l => l.accountCode === '2109')).toBe(false)
  expect(S().getCustomerBalance(S().customers[0].id)).toBe(2300)
  expect(S().getAdvanceBalance(project.id)).toBe(1000)
  expect(S().getRemainingRetention(project.id)).toBe(600)
  expect(S().getProjectProfit(project.id).extractedMinor).toBe(6000)
  expect(S().getProjectBillingGuard(project.id)).toMatchObject({ extractedNetMinor: 6000, extractedVatMinor: 900 })
  expect(S().getProjectNetQuantityReport(project.id).rows[0]).toMatchObject({ issuedQty: 100, returnedQty: 40, netQty: 60 })
  expect(() => S().assertProjectExtractRefunds(project.id)).not.toThrow()
})
it('يرفض الإعادة الموجبة أو اختياراً غير صريح أو تجاوز المتبقي بعد المقدمة بلا أي كتابة', () => {
  const { item, extract } = setup()
  const before = S(), base = args(extract.id, item.id, 40)
  expect(() => S().refundProjectExtract({ ...base, restoredAdvanceMinor: undefined })).toThrow(/اختيار صفر/)
  expect(() => S().refundProjectExtract({ ...base, restoredAdvanceMinor: 1 })).toThrow(/اختيار صفر/)
  expect(() => S().refundProjectExtract(args(extract.id, item.id, 90))).toThrow(/لا يغطي المقدمة/)
  expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts); expect(S().clientAdvances).toBe(before.clientAdvances)
  S().refundProjectExtract(base)
  const after = S()
  expect(() => S().refundProjectExtract(args(extract.id, item.id, 41))).toThrow(/لا يغطي المقدمة/)
  expect(S().journal).toBe(after.journal)
})
it('الرد النقدي يعكس الخزينة والمحتجز فقط ولا يغيّر المقدمة', () => {
  const { project, item, extract } = setup('cash')
  const credit = S().refundProjectExtract({ ...args(extract.id, item.id, 40), mode: 'cash', treasury: '1101' })
  const lines = S().journal.find(row => row.id === credit.refunds![0].journalEntryId)!.lines
  expect(lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '1101', credit: 4200 }), expect.objectContaining({ accountCode: '1105', credit: 400 })]))
  expect(lines.some(l => l.accountCode === '2109')).toBe(false)
  expect(S().getAdvanceBalance(project.id)).toBe(1000)
  expect(() => S().assertProjectExtractRefunds(project.id)).not.toThrow()
})
it('يرفض تخصيصاً تاريخياً مفقوداً أو فاسداً ولا يخترع دليله', () => {
  const { item, extract } = setup()
  const original = S().projectExtracts
  useRawDataStore.setState({ projectExtracts: original.map(row => ({ ...row, advanceAllocations: undefined })) })
  expect(() => S().refundProjectExtract(args(extract.id, item.id, 40))).toThrow(/غير مثبت/)
  useRawDataStore.setState({ projectExtracts: original.map(row => ({ ...row, advanceAllocations: row.advanceAllocations?.map(a => ({ ...a, journalEntryId: 999 })) })) })
  expect(() => S().refundProjectExtract(args(extract.id, item.id, 40))).toThrow(/مراجعة/)
})
it('يوقف القراءة عند حذف إثبات الصفر أو إضافة قيد 2109 وتبقى المستندات سليمة', () => {
  const { project, item, extract } = setup()
  const credit = S().refundProjectExtract(args(extract.id, item.id, 40))
  const originals = S().projectExtracts, journal = S().journal, refundId = credit.refunds![0].journalEntryId
  useRawDataStore.setState({ projectExtracts: originals.map(row => ({ ...row, refunds: row.refunds?.map(r => ({ ...r, restoredAdvanceMinor: undefined })) })) })
  expect(() => S().getProjectBillingGuard(project.id)).toThrow(/مراجعة/)
  useRawDataStore.setState({ projectExtracts: originals, journal: journal.map(entry => entry.id === refundId ? { ...entry, lines: entry.lines.map(line => line.accountCode === '1104' ? { ...line, accountCode: '2109' } : line) } : entry) })
  expect(() => S().getCustomerBalance(S().customers[0].id)).toThrow(/مراجعة/)
})
it('يرفض دمج إشعار بعد مقدمة مع تحصيل أو تغيير التوزيع بالتزامن', () => {
  const snap = (state: object) => JSON.stringify({ state })
  const base = { projects: [{ id: 1 }], clientAdvances: [{ id: 1, projectId: 1, recoveredMinor: 2000 }], projectExtracts: [{ id: 1, projectId: 1, advanceRecoveryMinor: 2000, refunds: [] }], journal: [{ id: 1 }] }
  const issued = { ...base, projectExtracts: [{ ...base.projectExtracts[0], quantityCreditVersion: 2, refunds: [{ restoredAdvanceMinor: 0 }] }], journal: [{ id: 1 }, { id: 2 }] }
  for (const other of [{ ...base, clientAdvances: [{ ...base.clientAdvances[0], recoveredMinor: 1500 }] }, { ...base, clientSettlements: [{ id: 1 }] }]) {
    expect(() => mergeConcurrentSnapshots(snap(base), snap(issued), snap(other))).toThrow(/تعارض/)
    expect(() => mergeConcurrentSnapshots(snap(base), snap(other), snap(issued))).toThrow(/تعارض/)
  }
})

it('يمنع الترحيل في فترة مقفلة أو فرع آخر دون قيد أو تغيير الدفعات', () => {
  const { project, item, extract } = setup()
  useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }] })
  let before = S()
  expect(() => S().refundProjectExtract(args(extract.id, item.id, 40))).toThrow(/مقفلة/)
  expect(S().journal).toBe(before.journal); expect(S().clientAdvances).toBe(before.clientAdvances)
  useAppStore.setState({ fiscalYears: [] })
  const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
  useRawDataStore.setState({ branches: branches as never, activeBranchId: 2, projects: S().projects.map(row => row.id === project.id ? { ...row, branchId: 1 } : row) as never })
  before = S()
  expect(() => S().refundProjectExtract(args(extract.id, item.id, 40))).toThrow(/فرع|المستخلص/)
  expect(S().journal).toBe(before.journal); expect(S().clientAdvances).toBe(before.clientAdvances)
})
it('نسخة احتياطية تحافظ على دليل الصفر ويمكن مراجعتها بعد الاستعادة', async () => {
  const { secureStorage, flushSecureStorageWrites } = await import('../src/data/secureStorage.ts')
  const { buildBackup, parseBackup } = await import('../src/core/backup.ts')
  const { project, item, extract } = setup()
  const credit = S().refundProjectExtract(args(extract.id, item.id, 40))
  await flushSecureStorageWrites('shopsys-data')
  const stored = await secureStorage.getItem('shopsys-data')
  const backup = buildBackup({ appState: {}, storeState: JSON.parse(stored!), appDataVersion: 25, shopName: 'اختبار' })
  const restored = parseBackup(JSON.stringify(backup))
  useRawDataStore.setState({ projectExtracts: [], clientAdvances: [], journal: [] })
  await flushSecureStorageWrites('shopsys-data')
  await secureStorage.setItem('shopsys-data', JSON.stringify(restored.data.store))
  await useRawDataStore.persist.rehydrate()
  expect(S().projectExtracts).toContainEqual(credit)
  expect(S().clientAdvances[0].recoveredMinor).toBe(2000)
  expect(() => S().assertProjectExtractRefunds(project.id)).not.toThrow()
  expect(S().getAdvanceBalance(project.id)).toBe(1000)
})

it('يوقف إشعار الصفر عند وجود فاتورة توثيق سابقة حتى دون محتجز', () => {
  const { project, item, extract } = setup('credit', 0)
  useRawDataStore.setState({ sales: [{ id: 1, projectId: project.id, projectBilling: 'documentation', extractIds: [extract.id] }] as never })
  const before = S()
  expect(() => S().refundProjectExtract({ ...args(extract.id, item.id, 40), amountMinor: 4600 })).toThrow(/فاتورة توثيق/)
  expect(S().journal).toBe(before.journal); expect(S().clientAdvances).toBe(before.clientAdvances)
})
