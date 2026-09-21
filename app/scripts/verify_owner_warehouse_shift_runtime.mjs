#!/usr/bin/env node
/** فحص تشغيلي: مخزن كل سطر شراء + ختم اعتماد إقفال الوردية بفارق. */
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'grocery', allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { computeWarehouseStock, buildWarehouseDocs } = await import(join(root, 'src/core/transfers.ts'))
const { summarizeShift } = await import(join(root, 'src/core/shifts.ts'))
const S = () => useDataStore.getState()
let pass = 0
const ok = (msg) => { pass++; console.log('  ✓', msg) }
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }

console.log('\n═══ تشغيل فعلي: مخزن السطر والوردية ═══')
S().seed([])
S().addSupplier({ nameAr: 'مورد مخازن السطر', phone: '', notes: '', ...EXT })
S().addItem({ nameAr: 'سكر', sku: 'SUG', barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 3000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: true, variantColors: [], variantSizes: [], isActive: true })
S().addWarehouse('مخزن التجميد')
const itemId = S().items.at(-1).id
const supplierId = S().suppliers.at(-1).id
const mainWh = S().warehouses.find((w) => w.isMain).id
const coldWh = S().warehouses.find((w) => w.nameAr === 'مخزن التجميد').id

const wideInv = S().postPurchase({
  supplierId,
  date: '2026-09-19',
  warehouseId: coldWh,
  lines: [{ itemId, qty: 3, unitPriceMinor: 950 }],
  expenses: [],
  paidMinor: 0,
  notes: 'مخزن واحد للفاتورة',
})
assert.equal(wideInv.warehouseId, coldWh)
assert.equal(wideInv.lines[0].warehouseId, coldWh)
ok('فاتورة بمخزن واحد تُحفظ على مستوى الفاتورة وليست كمختلطة')

const legacyInv = S().postPurchase({
  supplierId,
  date: '2026-09-20',
  lines: [{ itemId, qty: 2, unitPriceMinor: 900 }],
  expenses: [],
  paidMinor: 0,
  notes: 'مسار قديم بلا مخزن',
})
assert.equal(legacyInv.warehouseId, mainWh)
assert.equal(legacyInv.lines[0].warehouseId, mainWh)
ok('المسارات القديمة بلا مخزن تُطبَّع على المخزن الرئيسي ولا تبقى مبهمة')

assert.throws(() => S().postPurchase({
  supplierId,
  date: '2026-09-20',
  warehouseId: null,
  lines: [
    { itemId, qty: 1, unitPriceMinor: 1000, warehouseId: mainWh },
    { itemId, qty: 1, unitPriceMinor: 1000 },
  ],
  expenses: [],
  paidMinor: 0,
  notes: 'مختلطة ناقصة',
}), /حدد مخزناً لكل سطر/)
ok('فاتورة شراء مختلطة ناقصة مخزن لأحد السطور تُرفض من طبقة البيانات')

const inv = S().postPurchase({
  supplierId,
  date: '2026-09-21',
  warehouseId: null,
  lines: [
    { itemId, qty: 8, unitPriceMinor: 1000, warehouseId: mainWh },
    { itemId, qty: 5, unitPriceMinor: 1200, warehouseId: coldWh },
  ],
  expenses: [],
  paidMinor: 0,
  notes: 'فاتورة مختلطة المخازن',
})
assert.equal(inv.warehouseId, null)
assert.equal(inv.lines[0].warehouseId, mainWh)
assert.equal(inv.lines[1].warehouseId, coldWh)
const stock = computeWarehouseStock(S().items, S().warehouses, S().transfers, buildWarehouseDocs(S().purchases, S().sales, S().saleReturns, S().purchaseReturns))
assert.equal(stock.get(mainWh).get(itemId), 10)
assert.equal(stock.get(coldWh).get(itemId), 8)
ok('شراء مختلط: كل سطر حُفظ على مخزنه وانعكس على الرصيد')
assert.throws(() => S().editPurchase({
  purchaseId: inv.id,
  lines: [{ itemId, qty: 13, unitPriceMinor: 1000 }],
  expenses: [],
  paidMinor: 0,
  treasury: '1101',
  reason: 'اختبار منع تعديل متعدد المخازن',
  einvoiceActive: false,
}), /متعددة المخازن/)
ok('تعديل فاتورة شراء متعددة المخازن يُرفض حتى لا يمسح توزيع المخازن')

const projectDocs = buildWarehouseDocs([
  { id: 999, projectId: 77, warehouseId: coldWh, lines: [{ itemId, qty: 50 }] },
], [], [], [])
const projectStock = computeWarehouseStock([{ id: itemId, stockQty: 50 }], S().warehouses, [], projectDocs)
assert.equal(projectStock.get(coldWh).get(itemId) ?? 0, 0)
assert.equal(projectStock.get(mainWh).get(itemId), 50)
ok('مشتريات المشاريع لا تُحتسب داخل أي مخزن لأنها تكلفة موقع مباشرة')

const sh = S().openShift('كاشير الصباح', 10000)
const closed = S().closeShift(9000, 'مدير الفرع', 'اعتماد عجز 10.00')
assert.equal(closed.closeApprovedBy, 'مدير الفرع')
assert.equal(closed.closeApprovalNote, 'اعتماد عجز 10.00')
const sum = summarizeShift(closed, [], [])
assert.equal(sh.id, closed.id)
assert.equal(sum.varianceMinor, -1000)
ok('إقفال وردية بفارق يخزن اسم/سبب الاعتماد ويظهر العجز في الملخص')

console.log(`\n✅ فحص التشغيل الفعلي: ${pass} محطات — خضراء\n`)
