import { describe, expect, it } from 'vitest'
import { buildItemLedger, scopeItemLedgerWarehouse, type ItemLedgerInput } from '../src/core/itemLedger.ts'
import { renderItemLedgerHtml } from '../src/ui/print/printItemLedger.ts'

const base = (): ItemLedgerInput => ({ itemId: 5, openingQty: 20, purchases: [], purchaseReturns: [], sales: [], saleReturns: [], stocktakes: [], productionOrders: [], materialRequisitions: [], transfers: [] })
describe('سلامة عرض دفتر الصنف', () => {
 it('يعرض كمية الإذن المحولة وتكلفته المثبتتين لا كمية الوحدة المختارة', () => {
  const input = base(); input.materialRequisitions = [{ reqNumber: 'MR1', date: '2026-01-03', lines: [{ itemId: 5, qty: 2, unitFactor: 10, baseQty: 20, warehouseId: 2, costMinor: 350 }] }]
  expect(buildItemLedger(input).rows[0]).toMatchObject({ outQty: 20, valueMinor: 350, warehouseId: 2, balance: 0 })
 })
 it('يراجع الكمية القديمة مجهولة التحويل ويستخدم المعامل المثبت عند وجوده', () => {
  const input = base(); input.materialRequisitions = [{ reqNumber: 'قديم', date: '2026-01-01', lines: [{ itemId: 5, qty: 2, unitFactor: 3 }, { itemId: 5, qty: 1 }] }]
  const rows = buildItemLedger(input).rows; expect(rows.map(r => r.outQty)).toEqual([6, 1]); expect(rows[1].note).toContain('غير مثبتة')
 })
 it('يفصل سطور الأذون حسب المخزن ويستبعد المخزن المجهول في الترشيح', () => {
  const input = base(); input.materialRequisitions = [{ reqNumber: 'MR1', date: '2026-01-01', lines: [{ itemId: 5, qty: 1, baseQty: 2, warehouseId: 1 }, { itemId: 5, qty: 2, baseQty: 4, warehouseId: 2 }, { itemId: 5, qty: 3 }] }]
  expect(buildItemLedger(input).totalOut).toBe(9); expect(buildItemLedger(scopeItemLedgerWarehouse(input, 1)).totalOut).toBe(2); expect(buildItemLedger(scopeItemLedgerWarehouse(input, 2)).totalOut).toBe(4)
 })
 it('تحويل المخازن يحسب جانب المخزن المختار فقط وتتعادل جوانبه عند عرض الكل', () => {
  const input = base(); input.transfers = [{ date: '2026-01-02', fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 5, qty: 4 }] }]
  expect(buildItemLedger(input)).toMatchObject({ totalIn: 4, totalOut: 4, closingQty: 20 }); expect(buildItemLedger(scopeItemLedgerWarehouse(input, 1))).toMatchObject({ totalIn: 0, totalOut: 4, closingQty: 16 }); expect(buildItemLedger(scopeItemLedgerWarehouse(input, 2))).toMatchObject({ totalIn: 4, totalOut: 0, closingQty: 24 })
 })
 it('البيع والمرتجع بوحدة إضافية يغيران المخزون بالوحدة الأساسية لا سعر السطر', () => {
  const input = base(); input.sales = [{ invoiceNumber: 'S', date: '2026-01-01', lines: [{ itemId: 5, qty: 2, unitFactor: 5, unitPriceMinor: 100, discountPercent: 0 }] }]; input.saleReturns = [{ returnNumber: 'R', date: '2026-01-02', lines: [{ itemId: 5, qty: 1, unitFactor: 5, unitPriceMinor: 100 }, { itemId: 5, qty: 1, unitFactor: 5, unitPriceMinor: 100, condition: 'damaged' }] }]
  const ledger = buildItemLedger(input); expect(ledger.rows.map(r => [r.inQty, r.outQty, r.valueMinor])).toEqual([[0, 10, 200], [5, 0, 100], [0, 0, 100]]); expect(ledger.closingQty).toBe(15)
 })
 it('مرجع المخزن بسطر المرتجع يقدم على رأس المستند', () => {
  const input = base(); input.purchaseReturns = [{ returnNumber: 'R', date: '2026-01-01', warehouseId: 1, lines: [{ itemId: 5, qty: 2, unitCostMinor: 10, warehouseId: 2 }] }]
  expect(buildItemLedger(scopeItemLedgerWarehouse(input, 1)).rows).toHaveLength(0); expect(buildItemLedger(scopeItemLedgerWarehouse(input, 2)).totalOut).toBe(2)
 })
 it('يعرض إنتاجاً وتجهيزاً بمخازنهما المثبتة ولا يسند المجهول', () => {
  const input = base(); input.productionOrders = [{ orderNumber: 'P', date: '2026-01-01', productItemId: 5, qty: 4, outputWarehouseId: 2, ingredients: [{ itemId: 5, qty: 1, warehouseId: 1 }, { itemId: 5, qty: 2 }] }]; input.processingOrders = [{ orderNumber: 'C', date: '2026-01-02', sourceItemId: 5, sourceQty: 3, sourceWarehouseId: 1, outputWarehouseId: 2, outputs: [{ itemId: 5, qty: 2 }] }]
  expect(buildItemLedger(scopeItemLedgerWarehouse(input, 1))).toMatchObject({ totalOut: 4, totalIn: 0 }); expect(buildItemLedger(scopeItemLedgerWarehouse(input, 2))).toMatchObject({ totalOut: 0, totalIn: 6 }); expect(buildItemLedger(input).totalOut).toBe(6)
 })
 it('رصيد بداية الفترة ونهايتها يراعيان الحركات السابقة وتاريخ النهاية', () => {
  const input = base(); input.materialRequisitions = [{ reqNumber: 'A', date: '2026-01-01', lines: [{ itemId: 5, qty: 2, baseQty: 4 }] }, { reqNumber: 'B', date: '2026-01-10', lines: [{ itemId: 5, qty: 1, baseQty: 3 }] }]
  expect(buildItemLedger(input, '2026-01-03', '2026-01-05')).toMatchObject({ openingQty: 16, closingQty: 16, totalOut: 0 }); expect(buildItemLedger(input, '2026-01-03', '2026-01-10')).toMatchObject({ openingQty: 16, closingQty: 13, totalOut: 3 })
 })
 it('المطبوعة تحمل التحذير وتظهر الملاحظة القديمة وتهرب المدخلات', () => {
  const input = base(); input.materialRequisitions = [{ reqNumber: '<قديم>', date: '2026-01-01', lines: [{ itemId: 5, qty: 1 }] }]
  const html = renderItemLedgerHtml({ shopName: 'متجر', headerLines: [], itemName: '<صنف>', itemDetails: [], ledger: buildItemLedger(input), cur: { code: 'EGP', symbol: 'ج', decimals: 2, name: 'جنيه' } })
  expect(html).toContain('الرصيد الافتتاحي مشتق'); expect(html).toContain('غير مثبتة'); expect(html).toContain('&lt;صنف&gt;'); expect(html).not.toContain('<قديم>')
 })
})
