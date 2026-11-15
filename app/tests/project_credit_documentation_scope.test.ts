import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { mergeConcurrentSnapshots } from '../src/data/persistentStorage.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
  const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[], allowNegativeTreasury: true }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], approvals: { ...app.approvals, enabled: false } })
  useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], boqItems: [], projectExtracts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], items: [], stockMoves: [], sales: [], saleReturns: [], vouchers: [], clientSettlements: [], changeOrders: [], paymentTerminals: [], paymentTerminalTransactions: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
})
afterEach(() => { useRawDataStore.setState(initial); useAppStore.setState(app); vi.useRealTimers() })
function setup(retentionPercent = 10, vatPercent = 0) {
  const project = S().addProject({ nameAr: 'مشروع', clientId: S().customers[0].id, clientName: 'عميل', contractValueMinor: 10000, retentionPercent, startDate: '2025-01-01', notes: '' })
  const item = S().addBoqItem({ projectId: project.id, code: '1', descriptionAr: 'أعمال', unit: 'م', qty: 100, unitPriceMinor: 100 })
  const issue = (qty: number) => S().addProjectExtract({ projectId: project.id, payment: 'credit', vatPercent, description: 'أعمال', extractQtyLines: [{ boqItemId: item.id, cumulativeQty: qty }] })
  const first = issue(40), second = issue(80)
  const itemId = S().ensureServiceItemForFreeLine({ nameAr: 'توثيق أعمال' })
  const doc = S().postSale({ lines: [{ itemId, nameAr: 'توثيق أعمال', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: S().customers[0].id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, projectId: project.id, projectBilling: 'documentation', extractIds: [first.id] })
  return { project, item, first, second, doc }
}
const args = (extractId: number, boqItemId: number, amountMinor = 900) => ({ extractId, quantities: [{ boqItemId, qty: 10 }], amountMinor, mode: 'customer_credit' as const, reason: 'رفض أعمال' })
it('يسمح بإشعار على مستخلص آخر إذا كان التوثيق أحادي الارتباط ومدققاً ولا يغيّر الفاتورة', () => {
  const { project, item, first, second, doc } = setup(), invoice = structuredClone(doc)
  const beforeBalance = S().getCustomerBalance(S().customers[0].id)
  const updated = S().refundProjectExtract(args(second.id, item.id))
  expect(updated.refunds?.[0]).toMatchObject({ amountMinor: 900, retentionMinor: 100, grossMinor: 1000 })
  expect(S().sales.find(row => row.id === doc.id)).toEqual(invoice)
  expect(S().getCustomerBalance(S().customers[0].id)).toBe(beforeBalance - 900)
  expect(S().getProjectBillingGuard(project.id)).toMatchObject({ extractedNetMinor: 7000, documentedGrossMinor: 2000, availableToDocumentGrossMinor: 5000 })
  expect(S().getRemainingRetention(project.id)).toBe(700)
  expect(S().projectExtracts.find(row => row.id === first.id)?.refundedMinor ?? 0).toBe(0)
})
it('يمنع رد المستخلص الموثق حتى عند عدم وجود محتجز أو مقدمة ولا ينشئ أثراً', () => {
  const { item, first } = setup(0), before = S()
  expect(() => S().refundProjectExtract(args(first.id, item.id, 1000))).toThrow(/فاتورة توثيق/)
  expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts)
})
it('يرفض الروابط المشتركة أو المجهولة أو القيد التذكاري التالف حتى لو لم يُذكر المستخلص الهدف', () => {
  const { item, first, second, doc } = setup(), originals = S().sales, journal = S().journal
  const variants = [undefined, [], [first.id, second.id], [999]]
  for (const extractIds of variants) {
    useRawDataStore.setState({ sales: originals.map(row => row.id === doc.id ? { ...row, extractIds } : row) })
    const before = S(); expect(() => S().refundProjectExtract(args(second.id, item.id))).toThrow(/فاتورة توثيق/); expect(S().journal).toBe(before.journal)
  }
  useRawDataStore.setState({ sales: originals, journal: journal.map(row => row.id === doc.journalEntryId ? { ...row, memoOnly: false } : row) })
  expect(() => S().refundProjectExtract(args(second.id, item.id))).toThrow(/فاتورة توثيق/)
})
it('يرفض توثيقاً زائداً عن المستخلص الآخر أو مرتجع توثيق غير مدقق بدلاً من توزيعه على المستخلص الهدف', () => {
  const { item, second, doc } = setup(), originals = S().sales
  useRawDataStore.setState({ sales: originals.map(row => row.id === doc.id ? { ...row, totals: { ...row.totals, totalMinor: 9000 } } : row) })
  expect(() => S().refundProjectExtract(args(second.id, item.id))).toThrow(/فاتورة توثيق/)
  useRawDataStore.setState({ sales: originals, saleReturns: [{ id: 1, saleId: doc.id }] as never })
  expect(() => S().refundProjectExtract(args(second.id, item.id))).toThrow(/فاتورة توثيق/)
})
it('دمج لقطتي الإشعار والتوثيق المتزامنتين مرفوض في الاتجاهين', () => {
  const snap = (state: object) => JSON.stringify({ state })
  const base = { projects: [{ id: 1 }], projectExtracts: [{ id: 1, projectId: 1 }], sales: [], journal: [] }
  const credit = { ...base, projectExtracts: [{ id: 1, projectId: 1, quantityCreditVersion: 2, refunds: [{ journalEntryId: 2 }] }], journal: [{ id: 2 }] }
  const invoice = { ...base, sales: [{ id: 1, projectId: 1, projectBilling: 'documentation' }], journal: [{ id: 3 }] }
  expect(() => mergeConcurrentSnapshots(snap(base), snap(credit), snap(invoice))).toThrow(/تعارض/)
  expect(() => mergeConcurrentSnapshots(snap(base), snap(invoice), snap(credit))).toThrow(/تعارض/)
})

it('يبقى الإشعار وفاتورة التوثيق المستقلة قابلين للمراجعة بعد النسخ الاحتياطي والاستعادة', async () => {
  const { project, item, second, doc } = setup()
  S().refundProjectExtract(args(second.id, item.id))
  const guard = S().getProjectBillingGuard(project.id), balance = S().getCustomerBalance(S().customers[0].id)
  const { secureStorage, flushSecureStorageWrites } = await import('../src/data/secureStorage.ts'), { buildBackup, parseBackup } = await import('../src/core/backup.ts')
  vi.useRealTimers(); await flushSecureStorageWrites('shopsys-data')
  const backup = buildBackup({ appState: {}, storeState: JSON.parse((await secureStorage.getItem('shopsys-data'))!), appDataVersion: 25, shopName: 'اختبار' })
  const restored = parseBackup(JSON.stringify(backup))
  useRawDataStore.setState({ projects: [], projectExtracts: [], sales: [], journal: [] })
  await flushSecureStorageWrites('shopsys-data'); await secureStorage.setItem('shopsys-data', JSON.stringify(restored.data.store)); await useRawDataStore.persist.rehydrate()
  expect(S().sales.find(row => row.id === doc.id)?.extractIds).toEqual(doc.extractIds)
  expect(S().getProjectBillingGuard(project.id)).toEqual(guard); expect(S().getCustomerBalance(S().customers[0].id)).toBe(balance)
  expect(() => S().assertProjectExtractRefunds(project.id)).not.toThrow()
})

it('يعكس الضريبة والمحتجز والخزينة في الرد النقدي ولا يغيّر مستند التوثيق الآخر', () => {
  const { project, item, second, doc } = setup(10, 15)
  const updated = S().refundProjectExtract({ ...args(second.id, item.id, 1050), mode: 'cash', treasury: '1101' })
  const entry = S().journal.find(row => row.id === updated.refunds![0].journalEntryId)!
  expect(entry.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '4102', debit: 1000 }), expect.objectContaining({ accountCode: '2102', debit: 150 }), expect.objectContaining({ accountCode: '1105', credit: 100 }), expect.objectContaining({ accountCode: '1101', credit: 1050 })]))
  expect(S().sales.find(row => row.id === doc.id)?.totals).toEqual(doc.totals)
  expect(S().getRemainingRetention(project.id)).toBe(700)
  expect(S().getProjectBillingGuard(project.id)).toMatchObject({ extractedNetMinor: 7000, extractedVatMinor: 1050 })
})

it('يرفض دليلاً مكرراً أو عائداً لفرع آخر أو مستخلصاً موثقاً معدلاً', () => {
  const { project, item, first, second, doc } = setup(), extracts = S().projectExtracts, sales = S().sales, journal = S().journal
  useRawDataStore.setState({ projectExtracts: extracts.map(row => row.id === first.id ? { ...row, editedAt: '2026-11-05' } : row) })
  expect(() => S().refundProjectExtract(args(second.id, item.id))).toThrow(/فاتورة توثيق/)
  useRawDataStore.setState({ projectExtracts: extracts, sales: [...sales, doc] })
  expect(() => S().refundProjectExtract(args(second.id, item.id))).toThrow(/فاتورة توثيق/)
  const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
  useRawDataStore.setState({ sales, branches: branches as never, activeBranchId: 1, journal: journal.map(row => row.id === doc.journalEntryId ? { ...row, branchId: 2 } : row) })
  expect(() => S().refundProjectExtract(args(second.id, item.id))).toThrow(/فاتورة توثيق/)
  expect(S().projectExtracts.find(row => row.projectId === project.id && row.id === second.id)?.refunds).toBeUndefined()
})

it('لا يخفي فاتورة تربط مستخلص المشروع لكنها تحمل مشروعاً أو طبيعة فوترة خاطئة', () => {
  const { item, second, doc } = setup(), sales = S().sales
  for (const changes of [{ projectId: null }, { projectId: 999 }, { projectBilling: 'extra' as const }, { projectBilling: undefined }]) {
    useRawDataStore.setState({ sales: sales.map(row => row.id === doc.id ? { ...row, ...changes } : row) })
    const before = S()
    expect(() => S().refundProjectExtract(args(second.id, item.id))).toThrow(/فاتورة توثيق/)
    expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts)
  }
})
