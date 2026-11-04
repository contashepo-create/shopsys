import { beforeEach, expect, it } from 'vitest'
import { computeTotals } from '../src/core/pos.ts'
import { cumulativeSaleReturnTotals } from '../src/core/returns.ts'
import { buildReceiptModel, DEFAULT_RECEIPT_SETTINGS } from '../src/core/receipt.ts'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
 useAppStore.getState().setActiveBranchContext(null)
 useAppStore.setState({ setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true }, einvoice: app.einvoice, approvals: app.approvals })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, appUsers: [], currentUserId: null, items: [], sales: [], saleReturns: [], journal: [] })
})
const line = { itemId: 1, nameAr: 'خدمة', qty: 1, unitPriceMinor: 250, unitCostMinor: 0, discountPercent: 64.6, soldByWeight: false }
it('يحتفظ بالطريقة القديمة ويحسب النسخة الجديدة رياضياً دون فقد نصف قرش', () => {
 expect(computeTotals([line], 0, 0, false).totalMinor).toBe(89)
 expect(computeTotals([line], 0, 0, false, 2).totalMinor).toBe(88)
 expect(computeTotals([{ ...line, discountPercent: 0 }], 0, 64.6, false, 2).taxMinor).toBe(162)
})
it('يرحّل ويطبع ويرد بالقيمة الدقيقة مع إثبات نسخة الحساب على المستند والقيد', () => {
 const s = useDataStore.getState(), itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const sale = s.postSale({ lines: [{ ...line, itemId }], customerId: null, payment: 'cash', paidMinor: 88, treasury: '1101', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
 expect(sale.totals.totalMinor).toBe(88)
 expect(sale.roundingVersion).toBe(2)
 expect(useDataStore.getState().journal.find(row => row.id === sale.journalEntryId)?.saleRoundingVersion).toBe(2)
 const model = buildReceiptModel({ invoiceNumber: sale.invoiceNumber, dateIso: sale.date, lines: sale.lines, totals: sale.totals, payment: sale.payment, customerName: null, taxPercent: 0, taxInclusive: false, settings: DEFAULT_RECEIPT_SETTINGS, roundingVersion: sale.roundingVersion })
 expect(model.rows[0].totalMinor).toBe(88)
 const ret = s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد' })
 expect(ret.totals.totalMinor).toBe(88)
})
it('الرد الجزئي المتتابع يعيد كامل الفاتورة الجديدة دون فقد باقي التقريب', () => {
 const s = useDataStore.getState(), itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const sale = s.postSale({ lines: [{ ...line, itemId, qty: 2 }], customerId: null, payment: 'cash', paidMinor: 177, treasury: '1101', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
 const a = s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد أول' })
 const b = s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد ثان' })
 expect(a.totals.totalMinor + b.totals.totalMinor).toBe(sale.totals.totalMinor)
})

it('يحافظ على نتائج الفاتورة التاريخية بلا نسخة في إعادة الحساب والمرتجع', async () => {
 const { buildSaleEntry } = await import('../src/core/pos.ts')
 const s = useDataStore.getState(), itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const sale = s.postSale({ lines: [{ ...line, itemId }], customerId: null, payment: 'cash', paidMinor: 88, treasury: '1101', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
 const legacyTotals = computeTotals(sale.lines, 0, 0, false), { roundingVersion: _version, ...legacy } = sale
 useRawDataStore.setState(state => ({ sales: [{ ...legacy, totals: legacyTotals, paidMinor: 89 }], journal: state.journal.map(e => {
  if (e.id !== sale.journalEntryId) return e
  const { saleRoundingVersion: _stamp, ...old } = e
  return { ...old, lines: buildSaleEntry(legacyTotals, 'cash', '1101', 89) }
 }) }))
 const ret = s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد تاريخي' })
 expect(ret.totals.totalMinor).toBe(89)
 expect(useDataStore.getState().sales[0].roundingVersion).toBeUndefined()
})
it('يحجب تغيير نسخة الحساب أو حذف قيدها قبل الرد دون أي كتابة', () => {
 const s = useDataStore.getState(), itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const sale = s.postSale({ lines: [{ ...line, itemId }], customerId: null, payment: 'cash', paidMinor: 88, treasury: '1101', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
 const saved = useRawDataStore.getState()
 useRawDataStore.setState({ sales: saved.sales.map(row => ({ ...row, roundingVersion: undefined })) })
 let before = useRawDataStore.getState()
 expect(() => s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد' })).toThrow(/مراجعة|تقريب/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 useRawDataStore.setState({ sales: saved.sales, journal: saved.journal.filter(row => row.id !== sale.journalEntryId) })
 before = useRawDataStore.getState()
 expect(() => s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد' })).toThrow(/مراجعة|تقريب/)
 expect(useRawDataStore.getState().saleReturns).toBe(before.saleReturns)
})
it('يكشف تلاعب مرتجع سابق قبل حساب الباقي', () => {
 const s = useDataStore.getState(), itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const sale = s.postSale({ lines: [{ ...line, itemId, qty: 2 }], customerId: null, payment: 'cash', paidMinor: 177, treasury: '1101', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
 s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد' })
 useRawDataStore.setState(state => ({ saleReturns: state.saleReturns.map(row => ({ ...row, totals: { ...row.totals, totalMinor: row.totals.totalMinor + 1 } })) }))
 const before = useRawDataStore.getState()
 expect(() => s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد ثان' })).toThrow(/مراجعة|مطابق/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يضيف في مطبوعة المرتجع تسوية واضحة لباقي التقريب التراكمي', () => {
 const model = buildReceiptModel({ invoiceNumber: 'R-2', dateIso: '2026-11-04T10:00:00', lines: [line], totals: { grossMinor: 250, discountMinor: 161, netMinor: 89, taxBaseMinor: 89, taxMinor: 0, totalMinor: 89, cogsMinor: 0 }, payment: 'cash', customerName: null, taxPercent: 0, taxInclusive: false, settings: DEFAULT_RECEIPT_SETTINGS, roundingVersion: 2, roundingAdjustmentMinor: 1 })
 expect(model.rows.map(row => row.totalMinor)).toEqual([88, 1])
 expect(model.rows[1].nameAr).toContain('تقريب')
 expect(model.itemCount).toBe(1)
})
it('يدعم الضريبة المختلطة والخصم والرسوم في النسخة الدقيقة', async () => {
 const { applySaleCustomerCharges } = await import('../src/core/documentCharges.ts')
 const base = computeTotals([{ ...line, discountPercent: 0, vatPercentOverride: 64.6 }], 0, 64.6, false, 2)
 expect(base).toMatchObject({ taxMinor: 162, totalMinor: 412 })
 const charged = applySaleCustomerCharges(base, [{ nameAr: 'رسم', kind: 'service', amountMinor: 250, taxable: true }], 64.6, 2)
 expect(charged).toMatchObject({ taxMinor: 324, totalMinor: 824 })
 expect(computeTotals([{ ...line, discountPercent: 0 }], 0, 64.6, true, 2)).toMatchObject({ taxBaseMinor: 152, taxMinor: 98, totalMinor: 250 })
})
it('يحجب رد الباقي عند فقد قيد المرتجع السابق للفاتورة الجديدة', () => {
 const s = useDataStore.getState(), itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const sale = s.postSale({ lines: [{ ...line, itemId, qty: 2 }], customerId: null, payment: 'cash', paidMinor: 177, treasury: '1101', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
 const first = s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد' })
 useRawDataStore.setState(state => ({ journal: state.journal.filter(e => e.id !== first.journalEntryId) }))
 const before = useRawDataStore.getState()
 expect(() => s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد ثان' })).toThrow(/مراجعة/)
 expect(useRawDataStore.getState().saleReturns).toBe(before.saleReturns)
})
it('يجمع رد أصناف ضريبية ومعفاة مع خصم موزع دون رد الرسوم غير الداخلة في البنود', () => {
 const lines = [
  { ...line, itemId: 1, qty: 2, unitPriceMinor: 250, discountPercent: 64.6, vatPercentOverride: 14 },
  { ...line, itemId: 2, qty: 1, unitPriceMinor: 205, discountPercent: 0, vatPercentOverride: 0 },
 ]
 const source = computeTotals(lines, 10, 14, false, 2)
 const history: ReturnType<typeof computeTotals>[] = []
 const selected = [{ ...lines[0], qty: 1, saleLineIndex: 0 }, { ...lines[1], saleLineIndex: 1 }, { ...lines[0], qty: 1, saleLineIndex: 0 }]
 const previous: { lines: typeof selected; totals: ReturnType<typeof computeTotals> }[] = []
 for (const current of selected) {
  const result = cumulativeSaleReturnTotals(lines, 10, 14, false, previous, [current])
  history.push(result)
  previous.push({ lines: [current], totals: result })
 }
 for (const key of ['grossMinor', 'discountMinor', 'netMinor', 'taxMinor', 'totalMinor', 'cogsMinor'] as const) {
  expect(history.reduce((sum, totals) => sum + (totals[key] ?? 0), 0), key).toBe(source[key] ?? 0)
 }
})
it('يرفض قيد مرتجع سابق متوازن لكنه معدل في حساباته', () => {
 const s = useDataStore.getState(), itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const sale = s.postSale({ lines: [{ ...line, itemId, qty: 2 }], customerId: null, payment: 'cash', paidMinor: 177, treasury: '1101', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
 const first = s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد' })
 useRawDataStore.setState(state => ({ journal: state.journal.map(e => e.id === first.journalEntryId ? { ...e, lines: e.lines.map((l, i) => i === 0 ? { ...l, accountCode: '9999' } : l) } : e) }))
 expect(() => s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد ثان' })).toThrow(/مراجعة/)
})
it('يرفض رد فاتورة جديدة عُدلت سطور أصلها دون تغيير إجماليها المثبت', () => {
 const s = useDataStore.getState(), itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const sale = s.postSale({ lines: [{ ...line, itemId, qty: 2 }], customerId: null, payment: 'cash', paidMinor: 177, treasury: '1101', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
 useRawDataStore.setState(state => ({ sales: state.sales.map(row => row.id === sale.id ? { ...row, lines: row.lines.map(l => ({ ...l, discountPercent: 60 })) } : row) }))
 const before = useRawDataStore.getState()
 expect(() => s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد' })).toThrow(/مراجعة/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يرفض تكلفة تتجاوز النطاق الآمن في النسخة الجديدة', () => {
 const huge = { ...line, unitPriceMinor: 1, unitCostMinor: Number.MAX_SAFE_INTEGER, discountPercent: 0 }
 expect(() => computeTotals([huge, { ...huge, itemId: 2 }], 0, 0, false, 2)).toThrow(/النطاق/)
})
