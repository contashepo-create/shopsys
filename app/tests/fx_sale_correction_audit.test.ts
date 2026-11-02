import { beforeEach, expect, it } from 'vitest'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true, allowNegativeStock: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, customers: [], items: [], sales: [], vouchers: [], purchases: [], journal: [], fxConversions: [], employeeAdvances: [] }) })
function fixture() {
 const s = useDataStore.getState(), itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const sale = s.postSale({ lines: [{ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 2000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, fx: { currencyCode: 'USD', amountMinor: 200, ratePpm: 10000000, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
 return { s, sale }
}
it('يصحح إثبات عملة التحصيل بنفس القيمة الدفترية ويحفظ الساق الأصلية والمرجع', () => {
 const { s, sale } = fixture(), oldJournal = useDataStore.getState().journal
 s.correctSaleFx({ saleId: sale.id, fx: { currencyCode: 'KWD', amountMinor: 200, ratePpm: 100000000, decimals: 3 }, reason: 'إيصال القبض 123: عملة الدينار', confirmed: true })
 const state = useDataStore.getState(), updated = state.sales[0]
 expect(state.journal).toBe(oldJournal)
 expect(updated.fx?.currencyCode).toBe('KWD')
 expect(updated.fxCorrectionHistory?.[0]).toMatchObject({ previousFx: sale.fx, reason: 'إيصال القبض 123: عملة الدينار', journalEntryId: sale.journalEntryId })
 expect(s.getFxHoldings()).toEqual([expect.objectContaining({ currency: 'KWD', amountMinor: 200, bookValueMinor: 2000 })])
})
it('لا يخمن الساق أو يعدل القيمة الدفترية أو يتجاوز حركات لاحقة', () => {
 const { s, sale } = fixture(), fx = { currencyCode: 'KWD', amountMinor: 200, ratePpm: 100000000, decimals: 3 as const }
 const before = useRawDataStore.getState()
 expect(() => s.correctSaleFx({ saleId: sale.id, fx, reason: 'مرجع', confirmed: false })).toThrow(/تأكيد/)
 expect(() => s.correctSaleFx({ saleId: sale.id, fx: { ...fx, amountMinor: 300 }, reason: 'مرجع', confirmed: true })).toThrow(/القيمة|الدفتر/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 s.postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 1000, description: 'صرف', fx: { currencyCode: 'USD', amountMinor: 100, ratePpm: 10000000, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
 const later = useRawDataStore.getState()
 expect(() => s.correctSaleFx({ saleId: sale.id, fx, reason: 'مرجع', confirmed: true })).toThrow(/لاحقة/)
 expect(useRawDataStore.getState().sales).toBe(later.sales)
})
it('يحجب تقرير العملة عند حذف الساق المصححة أو تغيير سجل تصحيحها', () => {
 const { s, sale } = fixture()
 s.correctSaleFx({ saleId: sale.id, fx: { currencyCode: 'KWD', amountMinor: 200, ratePpm: 100000000, decimals: 3 }, reason: 'الإيصال 123', confirmed: true })
 const saved = useRawDataStore.getState()
 useRawDataStore.setState({ sales: saved.sales.map(row => ({ ...row, fx: null })) })
 expect(() => s.getFxFlows()).toThrow(/مفقودة/)
 useRawDataStore.setState({ sales: saved.sales.map(row => ({ ...row, fxCorrectionHistory: row.fxCorrectionHistory?.map(h => ({ ...h, reason: '' })) })) })
 expect(() => s.getFxFlows()).toThrow(/تصحيح.*غير مطابق/)
})
it('يعكس آخر تحويل عملتين بقيد مضاد موثق ويعيد رصيد العملة لتصحيحه', () => {
 const { s } = fixture()
 const doc = s.convertFx({ fromCurrency: 'USD', fromDecimals: 2, fromTreasury: '1101', fromAmountMinor: 100, toCurrency: 'EGP', toDecimals: 2, toTreasury: '1101', fromRatePpm: 15000000, toRatePpm: 1000000, feeMinor: 0 })
 s.reverseFxConversion({ conversionId: doc.id, reason: 'سعر التحويل سُجل خطأً' })
 const state = useDataStore.getState(), current = state.fxConversions.find(row => row.id === doc.id)!
 expect(current.reversalEntryId).toBeTruthy()
 expect(s.getFxHoldings()).toEqual([expect.objectContaining({ currency: 'USD', amountMinor: 200, bookValueMinor: 2000 })])
 const original = state.journal.find(row => row.id === doc.journalEntryId)!, reverse = state.journal.find(row => row.id === current.reversalEntryId)!
 expect(reverse.reversesEntryId).toBe(original.id)
 expect(reverse.lines.map(line => [line.accountCode, line.debit, line.credit])).toEqual(original.lines.map(line => [line.accountCode, line.credit, line.debit]))
 expect(() => s.reverseFxConversion({ conversionId: doc.id, reason: 'تكرار' })).toThrow(/معكوس/)
})
it('يحجب عكس تحويل عملتين بعد حركة لاحقة على العملة المتأثرة', () => {
 const { s } = fixture()
 const doc = s.convertFx({ fromCurrency: 'USD', fromDecimals: 2, fromTreasury: '1101', fromAmountMinor: 100, toCurrency: 'EGP', toDecimals: 2, toTreasury: '1101', fromRatePpm: 10000000, toRatePpm: 1000000, feeMinor: 0 })
 s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4101', amountMinor: 1000, description: 'حيازة لاحقة', fx: { currencyCode: 'USD', amountMinor: 100, ratePpm: 10000000, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
 const before = useRawDataStore.getState()
 expect(() => s.reverseFxConversion({ conversionId: doc.id, reason: 'تصحيح' })).toThrow(/لاحقة/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
