import { beforeEach, expect, it } from 'vitest'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], insuranceProviders: [], insuranceClaims: [], journal: [], batches: [], serials: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] }) })
function fixture() {
 const s = useDataStore.getState()
 s.addItem({ nameAr: 'جهاز', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockQty: 2, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: true, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useDataStore.getState().items[0], provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
 useRawDataStore.setState({ serials: ['SER-1', 'SER-2'].map((serial, i) => ({ id: i + 1, itemId: item.id, serial, status: 'in_stock' as const, purchaseId: null, saleId: null, soldAt: null, warrantyMonths: 0, receivedAt: '2026-01-01' })) })
 const args = { lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false, serials: ['SER-2'] }], providerId: provider.id, taxPercent: 0, taxInclusive: false, treasury: '1101' }
 return { s, item, provider, args }
}
it('يوثق وحدة السيريال المباعة ويعيدها بعد رد البيع المحصل', () => {
 const { s, provider, args } = fixture()
 s.postInsuredSale(args)
 const claim = useDataStore.getState().insuranceClaims[0]
 expect(useDataStore.getState().serials.find(u => u.serial === 'SER-2')).toMatchObject({ status: 'sold', insuredClaimId: claim.id })
 expect(useDataStore.getState().serials.find(u => u.serial === 'SER-1')?.status).toBe('in_stock')
 s.settleInsuranceClaims(provider.id)
 s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'رد الجهاز', confirmReturnedStock: true })
 expect(useDataStore.getState().serials.find(u => u.serial === 'SER-2')).toMatchObject({ status: 'in_stock', insuredClaimId: null, saleId: null })
})
it('يعكس البيع قبل التحصيل ويعيد السيريال الموثق فقط', () => {
 const { s, args } = fixture(); s.postInsuredSale(args)
 const claim = useDataStore.getState().insuranceClaims[0]
 s.reverseEntry(claim.sourceId, 'إلغاء')
 expect(useDataStore.getState().serials.find(u => u.serial === 'SER-2')).toMatchObject({ status: 'in_stock', insuredClaimId: null })
 expect(useDataStore.getState().items[0].stockQty).toBe(2)
})
it('يرفض وحدة غير متاحة أو مكررة أو بلا دليل قبل أي كتابة', () => {
 const { s, args } = fixture(), before = useRawDataStore.getState()
 expect(() => s.postInsuredSale({ ...args, lines: [{ ...args.lines[0], serials: [] }] })).toThrow(/سيريال/)
 expect(() => s.postInsuredSale({ ...args, lines: [{ ...args.lines[0], qty: 2, serials: ['SER-1', 'SER-1'] }] })).toThrow(/سيريال/)
 expect(() => s.postInsuredSale({ ...args, lines: [{ ...args.lines[0], serials: ['SER-X'] }] })).toThrow(/سيريال/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يحجب المرتجع إذا فقد السيريال رابط المطالبة أو حالته', () => {
 const { s, provider, args } = fixture(); s.postInsuredSale(args); s.settleInsuranceClaims(provider.id)
 const claim = useDataStore.getState().insuranceClaims[0]
 useRawDataStore.setState(state => ({ serials: state.serials.map(u => u.serial === 'SER-2' ? { ...u, insuredClaimId: null } : u) }))
 const before = useRawDataStore.getState()
 expect(() => s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'رد', confirmReturnedStock: true })).toThrow(/سيريال/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
function expiryFixture() {
 const s = useDataStore.getState()
 s.addSupplier({ nameAr: 'مورد', phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
 s.addItem({ nameAr: 'جهاز بصلاحية', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: true, trackSerial: true, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const { items, suppliers } = useDataStore.getState(), item = items[0]
 s.postPurchase({ supplierId: suppliers[0].id, date: '2026-01-01', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100, expiryDate: '2098-01-01', lotNumber: 'OLD', serialsRaw: 'SER-OLD', warehouseId: 1 }, { itemId: item.id, qty: 1, unitPriceMinor: 100, expiryDate: '2099-01-01', lotNumber: 'NEW', serialsRaw: 'SER-NEW', warehouseId: 1 }], expenses: [], paidMinor: 0, notes: '' })
 const provider = s.addInsuranceProvider({ nameAr: 'تأمين صلاحية', coveragePercent: 70 })
 const args = { lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false, serials: ['SER-NEW'] }], providerId: provider.id, taxPercent: 0, taxInclusive: false }
 return { s, item, provider, args }
}
it('يبيع السيريال المحدد من دفعته لا الأقدم، ويعيد الدفعة نفسها عند الرد بعد التحصيل', () => {
 const { s, provider, args } = expiryFixture()
 s.postInsuredSale(args); const claim = useDataStore.getState().insuranceClaims[0]
 expect(useDataStore.getState().batches.map(b => b.lotNumber)).toEqual(['OLD'])
 s.settleInsuranceClaims(provider.id)
 s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'رد', confirmReturnedStock: true })
 const after = useDataStore.getState(), unit = after.serials.find(u => u.serial === 'SER-NEW')!
 expect(unit.status).toBe('in_stock')
 expect(after.batches.find(b => b.id === unit.batchId)).toMatchObject({ lotNumber: 'NEW', qty: 1 })
 expect(after.batches.find(b => b.lotNumber === 'OLD')?.qty).toBe(1)
})
it('يرفض بيع سيريال بلا رابط دفعة صالح ولا يستهلك دفعة أخرى', () => {
 const { s, args } = expiryFixture()
 useRawDataStore.setState(state => ({ serials: state.serials.map(row => row.serial === 'SER-NEW' ? { ...row, batchId: undefined, expiryBatch: undefined } : row) }))
 const before = useRawDataStore.getState()
 expect(() => s.postInsuredSale(args)).toThrow(/سيريال|صلاحية/)
 expect(useRawDataStore.getState().batches).toBe(before.batches)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يعيد ربط السيريال إذا أعيد استخدام رقم الدفعة المستنفدة قبل عكس البيع', () => {
 const { s, args, item } = expiryFixture()
 s.postInsuredSale(args)
 const state = useRawDataStore.getState(), claim = state.insuranceClaims[0], soldBatch = claim.expiryBatches![0]
 useRawDataStore.setState({ batches: [...state.batches, { ...soldBatch, lotNumber: 'OTHER', qty: 1 }] })
 s.reverseEntry(claim.sourceId, 'إلغاء')
 const after = useDataStore.getState(), unit = after.serials.find(row => row.serial === 'SER-NEW')!
 expect(after.batches.find(row => row.id === soldBatch.id)?.lotNumber).toBe('OTHER')
 expect(after.batches.find(row => row.id === unit.batchId)).toMatchObject({ itemId: item.id, lotNumber: 'NEW', qty: 1 })
})
it('يعيد دفعة السيريال المباعة برقم آمن عند تصادم رقمها بعد التحصيل', () => {
 const { s, provider, args } = expiryFixture(); s.postInsuredSale(args); s.settleInsuranceClaims(provider.id)
 const before = useRawDataStore.getState(), claim = before.insuranceClaims[0], sold = claim.expiryBatches![0]
 useRawDataStore.setState({ batches: [...before.batches, { ...sold, lotNumber: 'OTHER', qty: 1 }] })
 s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'رد', confirmReturnedStock: true })
 const after = useDataStore.getState(), unit = after.serials.find(row => row.serial === 'SER-NEW')!
 expect(after.batches.find(row => row.id === sold.id)?.lotNumber).toBe('OTHER')
 expect(after.batches.find(row => row.id === unit.batchId)).toMatchObject({ lotNumber: 'NEW', qty: 1 })
})
it('لا يعيد بيع السيريال المؤمّن بفواتير البيع العادية ويحفظ الربط بعد إعادة تحميل البيانات', async () => {
 const { s, args } = fixture(); s.postInsuredSale(args)
 const saved = useRawDataStore.getState(), claim = saved.insuranceClaims[0]
 expect(() => s.postSale({ lines: args.lines, customerId: null, payment: 'cash', treasury: '1101', paidMinor: 1000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })).toThrow(/سيريال/)
 const { assertJournalSnapshotSafe } = await import('../src/core/ledgerSnapshotGuard.ts')
 expect(() => assertJournalSnapshotSafe(JSON.parse(JSON.stringify(saved)))).not.toThrow()
 const snapshot = JSON.parse(JSON.stringify({ insuranceClaims: saved.insuranceClaims, serials: saved.serials, journal: saved.journal }))
 useRawDataStore.setState(snapshot)
 expect(useDataStore.getState().serials.find(row => row.serial === 'SER-2')).toMatchObject({ insuredClaimId: claim.id, status: 'sold' })
 s.reverseEntry(claim.sourceId, 'إلغاء')
 expect(useDataStore.getState().serials.find(row => row.serial === 'SER-2')?.status).toBe('in_stock')
})
it('لا يقبل وحدة باسم فريد إذا كان معرفها الداخلي مكرراً', () => {
 const { s, args } = fixture()
 useRawDataStore.setState(state => ({ serials: state.serials.map(row => ({ ...row, id: 1 })) }))
 const before = useRawDataStore.getState()
 expect(() => s.postInsuredSale(args)).toThrow(/سيريال/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يرد سيريالاً محدداً من بيع محصل ثم يرد الوحدة المتبقية دون إعادة الأولى', () => {
 const { s, provider, args } = fixture()
 s.postInsuredSale({ ...args, lines: [{ ...args.lines[0], qty: 2, serials: ['SER-1', 'SER-2'] }] })
 s.settleInsuranceClaims(provider.id)
 const claim = useDataStore.getState().insuranceClaims[0]
 expect(() => s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: true })).toThrow(/سيريال/)
 s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: true, serials: ['SER-2'] })
 expect(useDataStore.getState().serials.find(u => u.serial === 'SER-2')?.status).toBe('in_stock')
 expect(useDataStore.getState().serials.find(u => u.serial === 'SER-1')?.status).toBe('sold')
 s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'باقي', confirmReturnedStock: true })
 expect(useDataStore.getState().serials.every(u => u.status === 'in_stock')).toBe(true)
 expect(s.getInsuranceRefundBalance(claim.id)).toBe(1400)
})
it('يرد سيريالاً بدفعة صلاحيته المختارة دون استعادة دفعة أخرى', () => {
 const { s, provider, args } = expiryFixture()
 s.postInsuredSale({ ...args, lines: [{ ...args.lines[0], qty: 2, serials: ['SER-OLD', 'SER-NEW'] }] }); s.settleInsuranceClaims(provider.id)
 const claim = useDataStore.getState().insuranceClaims[0]
 s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: true, serials: ['SER-NEW'] })
 const after = useDataStore.getState(), unit = after.serials.find(u => u.serial === 'SER-NEW')!
 expect(after.batches.find(b => b.id === unit.batchId)?.lotNumber).toBe('NEW')
 expect(after.batches.some(b => b.lotNumber === 'OLD')).toBe(false)
 s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'باقي', confirmReturnedStock: true })
 expect(useDataStore.getState().batches.map(b => b.lotNumber).sort()).toEqual(['NEW', 'OLD'])
})
it('لا يعيد السيريال الذي بيع مجدداً بعد مرتجع جزئي', () => {
 const { s, provider, args } = fixture()
 s.postInsuredSale({ ...args, lines: [{ ...args.lines[0], qty: 2, serials: ['SER-1', 'SER-2'] }] }); s.settleInsuranceClaims(provider.id)
 const claim = useDataStore.getState().insuranceClaims[0]
 s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: true, serials: ['SER-2'] })
 s.postSale({ lines: args.lines, customerId: null, payment: 'cash', treasury: '1101', paidMinor: 1000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
 s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'باقي', confirmReturnedStock: true })
 expect(useDataStore.getState().serials.find(u => u.serial === 'SER-2')?.status).toBe('sold')
 expect(useDataStore.getState().serials.find(u => u.serial === 'SER-1')?.status).toBe('in_stock')
})
it('يحجب التكرار أو فقد ربط سيريال متبقٍ قبل كتابة مرتجع جديد', () => {
 const { s, provider, args } = fixture()
 s.postInsuredSale({ ...args, lines: [{ ...args.lines[0], qty: 2, serials: ['SER-1', 'SER-2'] }] }); s.settleInsuranceClaims(provider.id)
 const claim = useDataStore.getState().insuranceClaims[0]
 s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: true, serials: ['SER-2'] })
 const before = useRawDataStore.getState()
 expect(() => s.refundSettledInsuredSalePartial({ claimId: claim.id, qty: 1, treasury: '1101', reason: 'رد', confirmReturnedStock: true, serials: ['SER-2'] })).toThrow(/سيريال/)
 useRawDataStore.setState({ serials: before.serials.map(unit => unit.serial === 'SER-1' ? { ...unit, insuredClaimId: null } : unit) })
 const corrupted = useRawDataStore.getState()
 expect(() => s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'باقي', confirmReturnedStock: true })).toThrow(/سيريال/)
 expect(useRawDataStore.getState().journal).toBe(corrupted.journal)
})
it('يحجب مرتجع السيريال عند تغيير رقم رابط دفعته رغم بقاء لقطة الصلاحية', () => {
 const { s, provider, args } = expiryFixture(); s.postInsuredSale(args); s.settleInsuranceClaims(provider.id)
 const claim = useDataStore.getState().insuranceClaims[0]
 useRawDataStore.setState(state => ({ serials: state.serials.map(unit => unit.serial === 'SER-NEW' ? { ...unit, batchId: 999 } : unit) }))
 const before = useRawDataStore.getState()
 expect(() => s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'رد', confirmReturnedStock: true })).toThrow(/سيريال|دفعة/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('بعد إعادة ربط دفعة برقم جديد يُباع السيريال ويُرد مرة أخرى بدفعة صحيحة', () => {
 const { s, provider, args } = expiryFixture(); s.postInsuredSale(args); s.settleInsuranceClaims(provider.id)
 const original = useRawDataStore.getState(), claim = original.insuranceClaims[0], batch = claim.expiryBatches![0]
 useRawDataStore.setState({ batches: [...original.batches, { ...batch, lotNumber: 'OTHER', qty: 1 }] })
 s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'رد أول', confirmReturnedStock: true })
 s.postInsuredSale(args); s.settleInsuranceClaims(provider.id)
 const nextClaim = useDataStore.getState().insuranceClaims.find(c => c.id !== claim.id)!
 s.refundSettledInsuredSale({ claimId: nextClaim.id, treasury: '1101', reason: 'رد ثان', confirmReturnedStock: true })
 const state = useDataStore.getState(), unit = state.serials.find(u => u.serial === 'SER-NEW')!
 expect(state.batches.find(b => b.id === unit.batchId)?.lotNumber).toBe('NEW')
})
