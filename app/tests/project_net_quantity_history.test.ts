import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
  const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], boqItems: [], projectExtracts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], sales: [], saleReturns: [], vouchers: [], clientSettlements: [], changeOrders: [], paymentTerminals: [], paymentTerminalTransactions: [] })
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
function setup() {
  const project = S().addProject({ nameAr: 'مشروع', clientId: S().customers[0].id, clientName: 'عميل', contractValueMinor: 10000, retentionPercent: 10, startDate: '2025-01-01', notes: '' })
  const item = S().addBoqItem({ projectId: project.id, code: '1', descriptionAr: 'أعمال', unit: 'م', qty: 100, unitPriceMinor: 100 })
  const first = S().addProjectExtract({ projectId: project.id, date: '2026-11-01', description: 'أول', payment: 'credit', vatPercent: 15, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 40 }] })
  const second = S().addProjectExtract({ projectId: project.id, date: '2026-11-02', description: 'ثان', payment: 'credit', vatPercent: 15, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 100 }], isFinal: true })
  S().saveProjectSurvey({ projectId: project.id, lines: [{ boqItemId: item.id, cumulativeQty: 100 }], expectedRevision: 0, reason: '', isFinal: true })
  return { project, item, first, second }
}
it('يعرض الصافي وسلسلة القيود بعد إشعار على مستخلص قديم دون تغيير الحصر أو الختامي', () => {
  const { project, item, first } = setup()
  const before = S().projectSurveys[0]
  S().refundProjectExtract({ extractId: first.id, quantities: [{ boqItemId: item.id, qty: 10 }], amountMinor: 1050, mode: 'customer_credit', reason: 'رفض' })
  const report = S().getProjectNetQuantityReport(project.id)
  expect(report.rows).toEqual([{ boqItemId: item.id, issuedQty: 100, returnedQty: 10, netQty: 90, issuedMinor: 10000, returnedMinor: 1000, netMinor: 9000 }])
  expect(report.events.map(e => e.kind)).toEqual(['extract', 'extract', 'credit'])
  expect(report.events.map(e => e.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-05'])
  expect(S().projectSurveys[0]).toEqual(before)
  expect(S().projectExtracts[1].isFinal).toBe(true)
})
it('يرفض أدلة إشعار أو قيد أو تاريخ فاسدة بدلاً من حساب صافي مقدر', () => {
  const { project, item, first } = setup()
  S().refundProjectExtract({ extractId: first.id, quantities: [{ boqItemId: item.id, qty: 10 }], amountMinor: 1050, mode: 'customer_credit', reason: 'رفض' })
  const originalJournal = S().journal, originalExtracts = S().projectExtracts
  const refundId = originalExtracts[0].refunds![0].journalEntryId
  useRawDataStore.setState({ journal: originalJournal.map(e => e.id === refundId ? { ...e, date: '2026-11-04' } : e) })
  expect(() => S().getProjectNetQuantityReport(project.id)).toThrow(/مراجعة/)
  useRawDataStore.setState({ journal: originalJournal, projectExtracts: originalExtracts.map(e => e.id === first.id ? { ...e, refunds: e.refunds!.map(r => ({ ...r, quantities: undefined })) } : e) })
  expect(() => S().getProjectNetQuantityReport(project.id)).toThrow(/مراجعة/)
  useRawDataStore.setState({ projectExtracts: originalExtracts, journal: [...originalJournal, originalJournal[0]] })
  expect(() => S().getProjectNetQuantityReport(project.id)).toThrow(/مراجعة/)
})
it('يرفض المستخلص الإجمالي أو النسبي القديم بدلاً من استنتاج الكمية', () => {
  const { project, item, first } = setup()
  const originals = S().projectExtracts
  useRawDataStore.setState({ projectExtracts: originals.map(e => e.id === first.id ? { ...e, lines: undefined } : e) })
  expect(() => S().getProjectNetQuantityReport(project.id)).toThrow(/مراجعة/)
  useRawDataStore.setState({ projectExtracts: originals.map(e => e.id === first.id ? { ...e, lines: e.lines!.map(line => ({ ...line, prevExecutedQty: undefined, newExecutedQty: undefined })) } : e) })
  expect(() => S().getProjectNetQuantityReport(project.id)).toThrow(/مراجعة/)
  useRawDataStore.setState({ projectExtracts: originals, boqItems: S().boqItems.map(row => row.id === item.id ? { ...row, unitPriceMinor: 101 } : row) })
  expect(() => S().getProjectNetQuantityReport(project.id)).toThrow(/مراجعة/)
})
it('التقريب التراكمي يحتفظ بالإشعار الصغير الذي عكس محتجزاً صفرياً ثم جزءاً آخر', () => {
  const project = S().addProject({ nameAr: 'تقريب', clientId: S().customers[0].id, clientName: 'عميل', contractValueMinor: 100, retentionPercent: 10, startDate: '2025-01-01', notes: '' })
  const item = S().addBoqItem({ projectId: project.id, code: '1', descriptionAr: 'دقيق', unit: 'م', qty: 100, unitPriceMinor: 1 })
  const ex = S().addProjectExtract({ projectId: project.id, description: 'أعمال', payment: 'credit', vatPercent: 15, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 100 }] })
  const first = S().refundProjectExtract({ extractId: ex.id, quantities: [{ boqItemId: item.id, qty: 1 }], amountMinor: 1, mode: 'customer_credit', reason: 'جزء' })
  expect(first.refunds![0].retentionMinor).toBe(0)
  S().refundProjectExtract({ extractId: ex.id, quantities: [{ boqItemId: item.id, qty: 9 }], amountMinor: 10, mode: 'customer_credit', reason: 'جزء آخر' })
  expect(S().getProjectNetQuantityReport(project.id).rows[0]).toMatchObject({ issuedQty: 100, returnedQty: 10, netQty: 90, issuedMinor: 100, returnedMinor: 10, netMinor: 90 })
  expect(S().getRemainingRetention(project.id)).toBe(9)
})
it('لا تتجاوز مسارات المبلغ والنسبة حظر تسلسل المستخلصات بعد الإشعار', () => {
  const project = S().addProject({ nameAr: 'مشروع', clientId: S().customers[0].id, clientName: 'عميل', contractValueMinor: 20000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
  const item = S().addBoqItem({ projectId: project.id, code: '1', descriptionAr: 'أعمال', unit: 'م', qty: 100, unitPriceMinor: 100 })
  const first = S().addProjectExtract({ projectId: project.id, description: 'أول', payment: 'credit', vatPercent: 0, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 40 }] })
  const second = S().addProjectExtract({ projectId: project.id, description: 'ثان', payment: 'credit', vatPercent: 0, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 50 }] })
  S().refundProjectExtract({ extractId: first.id, quantities: [{ boqItemId: item.id, qty: 10 }], amountMinor: 1000, mode: 'customer_credit', reason: 'رفض' })
  const before = S()
  expect(() => S().addProjectExtract({ projectId: project.id, description: 'مبلغ', payment: 'credit', vatPercent: 0, grossMinor: 100 })).toThrow(/إشعار دائن/)
  expect(() => S().addProjectExtract({ projectId: project.id, description: 'نسبة', payment: 'credit', vatPercent: 0, extractLines: [{ boqItemId: item.id, newProgressPercent: 60 }] })).toThrow(/إشعار دائن/)
  expect(() => S().editProjectExtract({ extractId: second.id, description: 'تعديل', payment: 'credit', vatPercent: 0, grossMinor: 100, reason: 'تصحيح' })).toThrow(/إشعار دائن/)
  expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts)
})
it('يعزل الفرع ويرفض تكرار معرف مستخلص أو بند في مشروع آخر', () => {
  const { project, item, first } = setup()
  const base = S()
  useRawDataStore.setState({ projectExtracts: [...base.projectExtracts, { ...first, projectId: 999 }] })
  expect(() => S().getProjectNetQuantityReport(project.id)).toThrow(/مكرر/)
  useRawDataStore.setState({ projectExtracts: base.projectExtracts, boqItems: [...base.boqItems, { ...item, projectId: 999 }] })
  expect(() => S().getProjectNetQuantityReport(project.id)).toThrow(/مكرر/)
  const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
  useRawDataStore.setState({ boqItems: base.boqItems, branches: branches as never, activeBranchId: 2, projects: base.projects.map(row => ({ ...row, branchId: 1 })) as never })
  expect(() => S().getProjectNetQuantityReport(project.id)).toThrow(/الفرع/)
})
