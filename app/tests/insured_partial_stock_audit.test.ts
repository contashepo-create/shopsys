import { beforeEach, expect, it } from 'vitest'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], insuranceProviders: [], insuranceClaims: [], journal: [], batches: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] }) })
function fixture(qty = 2) {
 const s = useDataStore.getState()
 s.addItem({ nameAr: 'دواء', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1000, stockQty: 5, priceMinor: 10000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useDataStore.getState().items[0], provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
 s.postInsuredSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty, unitPriceMinor: 10000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }], providerId: provider.id, taxPercent: 15, taxInclusive: false, treasury: '1101' })
 s.settleInsuranceClaims(provider.id)
 return { s, claim: useDataStore.getState().insuranceClaims[0] }
}
it('يرد قطعة من بيع مثبت بعد التحصيل ويسجل حصص المريض والجهة والضريبة والمخزون', () => {
 const { s, claim } = fixture()
 s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'إيصال رد 123', confirmReturnedStock: true })
 const state = useDataStore.getState(), updated = state.insuranceClaims[0], row = updated.salePartialRefunds![0]
 const entry = state.journal.find(e => e.id === row.journalEntryId)!
 expect(entry.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '4102', debit: 10000 }), expect.objectContaining({ accountCode: '2102', debit: 1500 }), expect.objectContaining({ accountCode: '1101', credit: 3450 }), expect.objectContaining({ accountCode: '2117', credit: 8050 }), expect.objectContaining({ accountCode: '1103', debit: 1000 }), expect.objectContaining({ accountCode: '5101', credit: 1000 })]))
 expect(state.items[0].stockQty).toBe(4)
 expect(s.getInsuranceRefundBalance(claim.id)).toBe(8050)
 s.payInsuranceRefund({ claimId: claim.id, amountMinor: 1000, treasury: '1101', reason: 'دفع مؤكد' })
 expect(s.getInsuranceRefundBalance(claim.id)).toBe(7050)
 s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'إيصال ثان', confirmReturnedStock: true })
 expect(s.getInsuranceRefundBalance(claim.id)).toBe(15100)
 expect(useDataStore.getState().items[0].stockQty).toBe(5)
 expect(() => s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'مكرر', confirmReturnedStock: true })).toThrow(/كمية|متبق/)
})
it('يحجب الكمية غير المثبتة والمطالبة التاريخية قبل الكتابة', () => {
 const { s, claim } = fixture(), before = useRawDataStore.getState()
 expect(() => s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1.5, treasury: '1101', reason: 'رد', confirmReturnedStock: true })).toThrow(/كمية/)
 expect(() => s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: false })).toThrow(/تأكيد/)
 useRawDataStore.setState({ insuranceClaims: before.insuranceClaims.map(c => ({ ...c, salePartialBasis: undefined })) })
 const legacy = useRawDataStore.getState()
 expect(() => s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: true })).toThrow(/مثبت|مراجعة/)
 expect(useRawDataStore.getState().journal).toBe(legacy.journal)
})
it('يرد المتبقي بعد جزئي ويحجب العبث بقيد مرتجع سابق', () => {
 const { s, claim } = fixture()
 s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد أول', confirmReturnedStock: true })
 s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'رد المتبقي', confirmReturnedStock: true })
 expect(s.getInsuranceRefundBalance(claim.id)).toBe(16100)
 const saved = useRawDataStore.getState(), id = saved.insuranceClaims[0].salePartialRefunds![0].journalEntryId
 useRawDataStore.setState({ journal: saved.journal.filter(e => e.id !== id) })
 expect(() => s.getInsuranceRefundBalance(claim.id)).toThrow(/مراجعة/)
})
it('يحجب اختلاف المخزن وإخفاء الأساس بعد بدء الردود', () => {
 const { s, claim } = fixture()
 useRawDataStore.setState({ warehouses: [{ id: 2, nameAr: 'بديل', isMain: true }] })
 const before = useRawDataStore.getState()
 expect(() => s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: true })).toThrow(/مخزن/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 useRawDataStore.setState({ warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] })
 s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: true })
 useRawDataStore.setState(state => ({ insuranceClaims: state.insuranceClaims.map(c => ({ ...c, salePartialBasis: undefined })) }))
 expect(() => s.getInsuranceRefundBalance(claim.id)).toThrow(/مراجعة/)
})
it('لا يخفي قيد مرتجع جزئي أو صرف جهة عند فقد سجله', () => {
 const { s, claim } = fixture()
 s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: true })
 s.payInsuranceRefund({ claimId: claim.id, amountMinor: 1000, treasury: '1101', reason: 'صرف' })
 const saved = useRawDataStore.getState()
 useRawDataStore.setState({ insuranceClaims: saved.insuranceClaims.map(c => ({ ...c, refundPayments: [] })) })
 expect(() => s.getInsuranceRefundBalance(claim.id)).toThrow(/مراجعة/)
 useRawDataStore.setState({ insuranceClaims: saved.insuranceClaims.map(c => ({ ...c, refundPayments: [], settledRefundMinor: 0, salePartialRefunds: [] })) })
 expect(() => s.getInsuranceRefundBalance(claim.id)).toThrow(/مراجعة/)
})
it('لا يرحل مرتجعاً مؤمناً بموظف لا يملك اعتماد المرتجعات أو أثناء الوردية', () => {
 const { s, claim } = fixture()
 useRawDataStore.setState({ appUsers: [{ id: 9, nameAr: 'كاشير', roleId: 'cashier', pinHash: 'x', active: true, treasuryAccess: { grants: [{ treasuryCode: '1101', operations: ['refund'] }] } }] as never, currentUserId: 9 })
 const before = useRawDataStore.getState()
 expect(() => s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: true })).toThrow(/اعتماد|مشرف/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 useRawDataStore.setState({ appUsers: [], currentUserId: null })
 s.openShift('المالك', 0)
 const shifted = useRawDataStore.getState()
 expect(() => s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: true })).toThrow(/وردية/)
 expect(useRawDataStore.getState().journal).toBe(shifted.journal)
})
