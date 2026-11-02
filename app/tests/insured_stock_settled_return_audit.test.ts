import { beforeEach, expect, it } from 'vitest'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { assertJournalSnapshotSafe } from '../src/core/ledgerSnapshotGuard.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [], insuranceProviders: [], insuranceClaims: [], journal: [], batches: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] }) })
function fixture() {
  const s = useDataStore.getState()
  s.addItem({ nameAr: 'دواء', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1000, stockQty: 5, priceMinor: 5000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = useDataStore.getState().items[0], provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
  s.postInsuredSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 5000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }], providerId: provider.id, taxPercent: 0, taxInclusive: false, treasury: '1101' })
  s.settleInsuranceClaims(provider.id)
  return { s, claim: useDataStore.getState().insuranceClaims[0], item }
}
it('يرد كامل البيع المؤمن بعد تحصيله، ويعيد المخزون ويثبت دين الجهة دون دفعها تلقائياً', () => {
  const { s, claim } = fixture()
  s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'إعادة البضاعة وصرف حصة المريض', confirmReturnedStock: true })
  const state = useDataStore.getState(), updated = state.insuranceClaims[0]
  expect(state.items[0].stockQty).toBe(5)
  expect(updated).toMatchObject({ settled: true, claimMinor: 7000, settledRefundMinor: 7000 })
  const entry = state.journal.find(row => row.id === updated.saleRefund?.journalEntryId)!
  expect(entry.lines.find(l => l.accountCode === '1103')?.debit).toBe(2000)
  expect(entry.lines.find(l => l.accountCode === '5101')?.credit).toBe(2000)
  expect(entry.lines.find(l => l.accountCode === '1101')?.credit).toBe(3000)
  expect(entry.lines.find(l => l.accountCode === '2117')?.credit).toBe(7000)
  expect(s.getInsuranceRefundBalance(claim.id)).toBe(7000)
  s.payInsuranceRefund({ claimId: claim.id, amountMinor: 1000, treasury: '1101', reason: 'تحويل مؤكد' })
  expect(s.getInsuranceRefundBalance(claim.id)).toBe(6000)
  expect(() => assertJournalSnapshotSafe(JSON.parse(JSON.stringify(useRawDataStore.getState())))).not.toThrow()
  expect(() => s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'تكرار', confirmReturnedStock: true })).toThrow()
})
it('يحجب العملية إذا فقد قيد تحصيل الجهة أو لم تؤكد عودة المخزون', () => {
  const { s, claim } = fixture()
  const before = useRawDataStore.getState()
  expect(() => s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'رد', confirmReturnedStock: false })).toThrow(/تأكيد/)
  useRawDataStore.setState({ journal: before.journal.filter(row => row.id !== claim.settlementEntryId) })
  const missing = useRawDataStore.getState()
  expect(() => s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'رد', confirmReturnedStock: true })).toThrow(/مراجعة/)
  expect(useRawDataStore.getState().items).toBe(missing.items)
  expect(useRawDataStore.getState().journal).toBe(missing.journal)
})
it('لا يعتمد رد بيع أو صرف جهة فقد قيده أو غُيّر حسابه', () => {
  const { s, claim } = fixture()
  s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'رد مؤكد', confirmReturnedStock: true })
  const saved = useRawDataStore.getState(), ref = saved.insuranceClaims[0].saleRefund!
  useRawDataStore.setState({ journal: saved.journal.map(e => e.id === ref.journalEntryId ? { ...e, lines: e.lines.map(l => l.accountCode === '2117' ? { ...l, accountCode: '2101' } : l) } : e) })
  expect(() => s.getInsuranceRefundBalance(claim.id)).toThrow(/مراجعة/)
  expect(() => s.payInsuranceRefund({ claimId: claim.id, amountMinor: 100, treasury: '1101', reason: 'تحويل' })).toThrow(/مراجعة/)
})
it('يعيد دفعة الصلاحية المثبتة نفسها ويمتنع عند غيابها في سجل بيع سابق', () => {
  const s = useDataStore.getState()
  s.addItem({ nameAr: 'علاج', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1000, stockQty: 2, priceMinor: 5000, minQty: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = useDataStore.getState().items[0]
  useRawDataStore.setState({ batches: [{ id: 10, itemId: item.id, purchaseId: 1, warehouseId: 1, lotNumber: 'L1', expiryDate: '2099-01-01', qty: 2, receivedAt: '2026-01-01' }] })
  const provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
  s.postInsuredSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 5000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }], providerId: provider.id, taxPercent: 0, taxInclusive: false })
  s.settleInsuranceClaims(provider.id)
  const saved = useRawDataStore.getState(), claim = saved.insuranceClaims[0]
  expect(saved.batches[0].qty).toBe(1)
  useRawDataStore.setState({ insuranceClaims: [{ ...claim, expiryBatches: [] }] })
  const incomplete = useRawDataStore.getState()
  expect(() => s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'إعادة', confirmReturnedStock: true })).toThrow(/دفعات/)
  expect(useRawDataStore.getState().journal).toBe(incomplete.journal)
  useRawDataStore.setState({ insuranceClaims: [claim] })
  s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'إعادة', confirmReturnedStock: true })
  expect(useDataStore.getState().batches[0]).toMatchObject({ id: 10, qty: 2, lotNumber: 'L1' })
})
it('يرد ضريبة البيع المؤمّن كما قُيّدت ولا يصرف مستحق الجهة تلقائياً', () => {
  const s = useDataStore.getState()
  s.addItem({ nameAr: 'صنف ضريبي', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1000, stockQty: 2, priceMinor: 10000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = useDataStore.getState().items[0], provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
  s.postInsuredSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 10000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }], providerId: provider.id, taxPercent: 15, taxInclusive: false })
  s.settleInsuranceClaims(provider.id)
  const claim = useDataStore.getState().insuranceClaims[0]
  s.refundSettledInsuredSale({ claimId: claim.id, treasury: '1101', reason: 'صرف للمريض وإعادة الصنف', confirmReturnedStock: true })
  const updated = useDataStore.getState().insuranceClaims[0], entry = useDataStore.getState().journal.find(row => row.id === updated.saleRefund?.journalEntryId)!
  expect(entry.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '4102', debit: 10000 }), expect.objectContaining({ accountCode: '2102', debit: 1500 }), expect.objectContaining({ accountCode: '1101', credit: 3450 }), expect.objectContaining({ accountCode: '2117', credit: 8050 })]))
  expect(s.getInsuranceRefundBalance(claim.id)).toBe(8050)
})
