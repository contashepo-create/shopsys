import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { remainingDocumentableByExtract } from '../src/core/contracting.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
  const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[], allowNegativeTreasury: true }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], boqItems: [], projectExtracts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], sales: [], saleReturns: [], vouchers: [], clientSettlements: [], changeOrders: [], paymentTerminals: [], paymentTerminalTransactions: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
})
afterEach(() => { useRawDataStore.setState(initial); useAppStore.setState(app); vi.useRealTimers() })
function setup(payment: 'cash' | 'credit' = 'credit') {
  const project = S().addProject({ nameAr: 'مشروع', clientId: S().customers[0].id, clientName: 'عميل', contractValueMinor: 10000, retentionPercent: 10, startDate: '2025-01-01', notes: '' })
  const item = S().addBoqItem({ projectId: project.id, code: '1', descriptionAr: 'أعمال', unit: 'م', qty: 100, unitPriceMinor: 100 })
  const extract = S().addProjectExtract({ projectId: project.id, date: '2026-11-03', description: 'أعمال', payment, vatPercent: 15, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 100 }] })
  return { project, item, extract }
}
it('قيد كمي قبل تحصيل المحتجز يعكس الأعمال وضريبتها ومحتجزها والذمة ويحدث سقف التوثيق', () => {
  const { project, item, extract } = setup()
  const result = S().refundProjectExtract({ extractId: extract.id, quantities: [{ boqItemId: item.id, qty: 40 }], amountMinor: 4200, mode: 'customer_credit', reason: 'رفض أعمال' })
  expect(result.refunds?.[0]).toMatchObject({ grossMinor: 4000, taxShareMinor: 600, retentionMinor: 400, amountMinor: 4200 })
  expect(S().journal.at(-1)?.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '4102', debit: 4000 }), expect.objectContaining({ accountCode: '2102', debit: 600 }), expect.objectContaining({ accountCode: '1105', credit: 400 }), expect.objectContaining({ accountCode: '1104', credit: 4200 })]))
  expect(S().getCustomerBalance(S().customers[0].id)).toBe(6300)
  expect(S().getRemainingRetention(project.id)).toBe(600)
  expect(S().getProjectProfit(project.id)).toMatchObject({ extractedMinor: 6000, retentionHeldMinor: 600 })
  expect(S().getProjectBillingGuard(project.id)).toMatchObject({ extractedNetMinor: 6000, extractedVatMinor: 900, availableToDocumentGrossMinor: 6900 })
  expect(remainingDocumentableByExtract([result], []).get(extract.id)).toBe(6900)
  expect(() => S().assertProjectExtractRefunds(project.id)).not.toThrow()
  expect(() => S().releaseRetention(project.id, '1101', undefined, '2026-11-04')).toThrow(/إشعار|تسلسل/)
  expect(S().releaseRetention(project.id).amount).toBe(600)
  expect(S().getRemainingRetention(project.id)).toBe(0)
})
it('يرفض إشعاراً بعد تحصيل محتجز غير موزع على المستخلصات ولا يغير القيد', () => {
  const { project, item, extract } = setup()
  expect(S().releaseRetention(project.id).amount).toBe(1000)
  const before = S()
  expect(() => S().refundProjectExtract({ extractId: extract.id, quantities: [{ boqItemId: item.id, qty: 40 }], amountMinor: 4200, mode: 'customer_credit', reason: 'رفض' })).toThrow(/تحصيل محتجز/)
  expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts)
})
it('يرفض قيد محتجز معدلاً ولا يفرج عن الرصيد غير المثبت', () => {
  const { project, item, extract } = setup()
  const updated = S().refundProjectExtract({ extractId: extract.id, quantities: [{ boqItemId: item.id, qty: 40 }], amountMinor: 4200, mode: 'customer_credit', reason: 'رفض' })
  const id = updated.refunds![0].journalEntryId
  const journal = S().journal
  useRawDataStore.setState({ journal: journal.map(e => e.id === id ? { ...e, lines: e.lines.map(l => l.accountCode === '1105' ? { ...l, credit: 399 } : l) } : e) })
  const before = S()
  expect(() => S().assertProjectExtractRefunds(project.id)).toThrow(/مراجعة/)
  expect(() => S().getProjectProfit(project.id)).toThrow(/مراجعة/)
  expect(() => S().releaseRetention(project.id)).toThrow(/مراجعة/)
  expect(S().journal).toBe(before.journal); expect(S().retentionReleases).toBe(before.retentionReleases)
})
it('التقريب التراكمي يعكس كامل المحتجز والضريبة عند تكرار ردود الكمية', () => {
  const { project, item, extract } = setup()
  for (const qty of [33, 33, 34]) {
    S().refundProjectExtract({ extractId: extract.id, quantities: [{ boqItemId: item.id, qty }], amountMinor: qty * 105, mode: 'customer_credit', reason: 'رفض جزء' })
  }
  const updated = S().projectExtracts[0]
  expect(updated.refunds?.reduce((sum, r) => sum + (r.retentionMinor ?? 0), 0)).toBe(1000)
  expect(updated.refundedTaxMinor).toBe(1500)
  expect(S().getRemainingRetention(project.id)).toBe(0)
  expect(S().getCustomerBalance(S().customers[0].id)).toBe(0)
  expect(S().getProjectProfit(project.id).extractedMinor).toBe(0)
})

it('لا يُبنى سقف الفوترة على دليل محتجز خالف قيد الإشعار', () => {
  const { project, item, extract } = setup()
  const updated = S().refundProjectExtract({ extractId: extract.id, quantities: [{ boqItemId: item.id, qty: 40 }], amountMinor: 4200, mode: 'customer_credit', reason: 'رفض' })
  const id = updated.refunds![0].journalEntryId
  useRawDataStore.setState({ journal: S().journal.map(e => e.id === id ? { ...e, lines: e.lines.map(l => l.accountCode === '1105' ? { ...l, credit: 399 } : l) } : e) })
  expect(() => S().getProjectBillingGuard(project.id)).toThrow(/مراجعة/)
  expect(() => S().getRemainingRetention(project.id)).toThrow(/مراجعة/)
})
it('إشعار المحتجز لا يخمّن حصة فاتورة التوثيق من المستخلصات', () => {
  const { project, item, extract } = setup()
  useRawDataStore.setState({ sales: [{ id: 1, projectId: project.id, projectBilling: 'documentation', extractIds: [extract.id] }] as never })
  const before = S()
  expect(() => S().refundProjectExtract({ extractId: extract.id, quantities: [{ boqItemId: item.id, qty: 40 }], amountMinor: 4200, mode: 'customer_credit', reason: 'رفض' })).toThrow(/فاتورة توثيق/)
  expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts)
})
it('المراجعة ترفض اختلاف يوم قيد الإشعار عن يوم المستند', () => {
  const { project, item, extract } = setup()
  const updated = S().refundProjectExtract({ extractId: extract.id, quantities: [{ boqItemId: item.id, qty: 40 }], amountMinor: 4200, mode: 'customer_credit', reason: 'رفض' })
  const id = updated.refunds![0].journalEntryId
  useRawDataStore.setState({ journal: S().journal.map(e => e.id === id ? { ...e, date: '2026-11-04' } : e) })
  expect(() => S().assertProjectExtractRefunds(project.id)).toThrow(/مراجعة/)
  expect(() => S().releaseRetention(project.id)).toThrow(/مراجعة/)
})

it('تحصيل سابق وإشعار دائن مع محتجز لا يحتسبان مرتين في ذمة العميل', () => {
  const { project, item, extract } = setup()
  const customer = S().customers[0]
  S().receiveClientPayment({ customerId: customer.id, amountMinor: 3000, treasury: '1101', specificDocKey: `extract:${extract.id}` })
  S().refundProjectExtract({ extractId: extract.id, quantities: [{ boqItemId: item.id, qty: 40 }], amountMinor: 4200, mode: 'customer_credit', reason: 'رفض' })
  expect(S().getCustomerBalance(customer.id)).toBe(3300)
  expect(S().getRemainingRetention(project.id)).toBe(600)
  const doc = S().getOpenClientInvoices(customer.id, true).find(row => row.docKey === `extract:${extract.id}`)!
  expect(doc.dueMinor - doc.settledMinor).toBe(3300)
})
it('رد نقدي مع محتجز على مستخلص نقدي يخفض الخزينة والمحتجز كلّاً على حدة', () => {
  const { project, item, extract } = setup('cash')
  const result = S().refundProjectExtract({ extractId: extract.id, quantities: [{ boqItemId: item.id, qty: 40 }], amountMinor: 4200, mode: 'cash', treasury: '1101', reason: 'رد نقدي' })
  const lines = S().journal.find(e => e.id === result.refunds![0].journalEntryId)!.lines
  expect(lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '1101', credit: 4200 }), expect.objectContaining({ accountCode: '1105', credit: 400 })]))
  expect(S().getRemainingRetention(project.id)).toBe(600)
  expect(S().getProjectProfit(project.id).extractedMinor).toBe(6000)
  expect(() => S().assertProjectExtractRefunds(project.id)).not.toThrow()
})
