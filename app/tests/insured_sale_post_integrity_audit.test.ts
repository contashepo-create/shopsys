import { beforeEach, expect, it } from 'vitest'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, appUsers: [], currentUserId: null, items: [], insuranceProviders: [], insuranceClaims: [], journal: [], batches: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] }) })
function fixture() {
 const s = useDataStore.getState()
 s.addItem({ nameAr: 'دواء', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockQty: 5, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
 const item = useDataStore.getState().items[0], provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
 const args = { lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 1000, unitCostMinor: 100, discountPercent: 0, soldByWeight: false }], providerId: provider.id, taxPercent: 0, taxInclusive: false, treasury: '1101' }
 return { s, item, args }
}
it('يرفض خزينة غير حقيقية أو محرومة ومخازن متعددة لا يوثقها هذا المسار', () => {
 const { s, args } = fixture(), before = useRawDataStore.getState()
 expect(() => s.postInsuredSale({ ...args, treasury: '5108' })).toThrow(/خزينة|بنك/)
 useRawDataStore.setState({ warehouses: [...before.warehouses, { id: 2, nameAr: 'آخر', isMain: false }] })
 expect(() => s.postInsuredSale(args)).toThrow(/مخزن/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('لا يصرف صنفاً يتتبع الصلاحية دون دفعات كافية ومثبتة', () => {
 const { s, args } = fixture()
 useRawDataStore.setState(state => ({ items: state.items.map(item => ({ ...item, trackExpiry: true })) }))
 const before = useRawDataStore.getState()
 expect(() => s.postInsuredSale(args)).toThrow(/دفعات|صلاحية/)
 expect(useRawDataStore.getState().items).toBe(before.items)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يرفض كمية تتلاشى بعد التقريب أو دفعة صلاحية تالفة', () => {
 const { s, args, item } = fixture(), before = useRawDataStore.getState()
 expect(() => s.postInsuredSale({ ...args, lines: [{ ...args.lines[0], qty: 0.0001, unitPriceMinor: 10000000 }] })).toThrow(/كمية/)
 useRawDataStore.setState({ items: before.items.map(row => ({ ...row, trackExpiry: true })), batches: [{ id: 10, itemId: item.id, purchaseId: 1, warehouseId: 1, lotNumber: 'L', expiryDate: 'not-date', qty: 5, receivedAt: '2026-01-01' }] })
 expect(() => s.postInsuredSale(args)).toThrow(/صلاحية|دفعة/)
})
it('يسجل نصيب المريض في الوردية ولا يتجاوز الفاتورة الإلكترونية', () => {
 const { s, args } = fixture(), shift = s.openShift('مدير', 0)
 s.postInsuredSale(args)
 expect(s.getShiftSummary(shift.id).expectedCashMinor).toBe(600)
 s.closeShift(600)
 useAppStore.setState(state => ({ einvoice: { ...state.einvoice, enabled: true } }))
 const before = useRawDataStore.getState()
 expect(() => s.postInsuredSale(args)).toThrow(/إلكترون|ضريب/)
 expect(useRawDataStore.getState().items).toBe(before.items)
})
it('لا يتجاوز نطاق اعتماد المبيعات المفعّل', () => {
 const { s, args } = fixture()
 useAppStore.setState(state => ({ setup: { ...state.setup, requireOpenShiftForSales: false }, approvals: { ...state.approvals, enabled: true, scope: ['sale'], thresholdMinor: 0, autoApprovedUserIds: [] } }))
 useRawDataStore.setState({ appUsers: [{ id: 9, nameAr: 'كاشير', roleId: 'cashier', pinHash: 'x', active: true, treasuryAccess: { grants: [{ treasuryCode: '1101', operations: ['receipt'] }] } }] as never, currentUserId: 9 })
 const before = useRawDataStore.getState()
 expect(() => s.postInsuredSale(args)).toThrow(/اعتماد/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
