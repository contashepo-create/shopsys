import { beforeEach, expect, it } from 'vitest'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], suppliers: [], insuranceProviders: [], insuranceClaims: [], journal: [], batches: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] }) })
function fixture() {
 const s = useDataStore.getState()
 s.addSupplier({ nameAr: 'مورد', phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
 s.addItem({ nameAr: 'دواء', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useDataStore.getState().items[0], supplier = useDataStore.getState().suppliers[0]
 s.postPurchase({ supplierId: supplier.id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100, expiryDate: '2098-01-01', lotNumber: 'A', warehouseId: 1 }, { itemId: item.id, qty: 1, unitPriceMinor: 100, expiryDate: '2099-01-01', lotNumber: 'B', warehouseId: 1 }], expenses: [], paidMinor: 0, notes: '' })
 const provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
 s.postInsuredSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false }], providerId: provider.id, taxPercent: 0, taxInclusive: false })
 s.settleInsuranceClaims(provider.id)
 return { s, claim: useDataStore.getState().insuranceClaims[0] }
}
it('يعيد دفعة محددة من دفعات البيع لا دفعة مفترضة، ويمنع تجاوزها أو تخمينها', () => {
 const { s, claim } = fixture(), [a,b] = claim.expiryBatches!
 const base = { claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: true }
 expect(() => s.refundSettledInsuredSalePartial(base)).toThrow(/دفعة|دفعات/)
 s.refundSettledInsuredSalePartial({ ...base, batchAllocations: [{ batchId: b.id, qty: 1 }] })
 expect(useDataStore.getState().batches.find(x => x.lotNumber === 'B')?.qty).toBe(1)
 expect(() => s.refundSettledInsuredSalePartial({ ...base, batchAllocations: [{ batchId: b.id, qty: 1 }] })).toThrow(/دفعة|دفعات/)
 s.refundSettledInsuredSalePartial({ ...base, batchAllocations: [{ batchId: a.id, qty: 1 }] })
 expect(useDataStore.getState().batches.find(x => x.lotNumber === 'A')?.qty).toBe(1)
 expect(s.getInsuranceRefundBalance(claim.id)).toBe(1400)
})
it('يحجب السجل الجزئي إن تم تغيير توزيع دفعاته بعد التسجيل', () => {
 const { s, claim } = fixture(), [a,b] = claim.expiryBatches!
 s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: true, batchAllocations: [{ batchId: b.id, qty: 1 }] })
 useRawDataStore.setState(state => ({ insuranceClaims: state.insuranceClaims.map(c => ({ ...c, salePartialRefunds: c.salePartialRefunds?.map(row => ({ ...row, batchAllocations: [{ batchId: a.id, qty: 2 }] })) })) }))
 expect(() => s.getInsuranceRefundBalance(claim.id)).toThrow(/مراجعة/)
})
it('يستعيد هوية الدفعة برقم آمن إذا استُخدم رقمها بعد استنفادها', () => {
 const { s, claim } = fixture(), batch = claim.expiryBatches![1]
 useRawDataStore.setState(state => ({ batches: [...state.batches, { ...batch, lotNumber: 'C', qty: 1 }] }))
 s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: true, batchAllocations: [{ batchId: batch.id, qty: 1 }] })
 const batches = useDataStore.getState().batches
 expect(batches.find(x => x.id === batch.id)?.lotNumber).toBe('C')
 expect(batches.find(x => x.lotNumber === 'B')).toMatchObject({ qty: 1 })
 expect(batches.find(x => x.lotNumber === 'B')?.id).not.toBe(batch.id)
})
it('لا يبيع متغير صنف أو ضماناً ممتداً بدون دفتره المساعد', () => {
 const s = useDataStore.getState()
 s.addItem({ nameAr: 'جهاز', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockQty: 2, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useDataStore.getState().items[0], provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
 const line = { itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false }
 const args = { lines: [line], providerId: provider.id, taxPercent: 0, taxInclusive: false }, before = useRawDataStore.getState()
 expect(() => s.postInsuredSale({ ...args, lines: [{ ...line, variantColor: 'أحمر' }] })).toThrow(/متغير/)
 expect(() => s.postInsuredSale({ ...args, lines: [{ ...line, extendedWarrantyMonths: 12 }] })).toThrow(/ضمان/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يرد باقي البيع بعد مرتجع جزئي دون تكرار أي دفعة أو حصة', () => {
 const { s, claim } = fixture(), [a] = claim.expiryBatches!
 s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد أول', confirmReturnedStock: true, batchAllocations: [{ batchId: a.id, qty: 1 }] })
 s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'رد المتبقي', confirmReturnedStock: true })
 expect(s.getInsuranceRefundBalance(claim.id)).toBe(1400)
 expect(useDataStore.getState().batches.map(b => b.lotNumber).sort()).toEqual(['A', 'B'])
 expect(useDataStore.getState().items[0].stockQty).toBe(2)
})
