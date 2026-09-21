import { buildWarehouseDocs, computeWarehouseStock } from '../src/core/transfers.ts'

let pass = 0, fail = 0
const ok = (name, cond) => cond ? (pass++, console.log(`  ✅ ${name}`)) : (fail++, console.log(`  ❌ ${name}`))

const items = [{ id: 1, stockQty: 17 }, { id: 2, stockQty: 8 }]
const warehouses = [{ id: 1, isMain: true }, { id: 2, isMain: false }]
const transfers = [{ fromWarehouseId: 1, toWarehouseId: 2, lines: [{ itemId: 1, qty: 7 }, { itemId: 2, qty: 3 }] }]
const sales = [{ id: 10, warehouseId: 1, lines: [
  { itemId: 1, qty: 2, warehouseId: 1 },
  { itemId: 2, qty: 1, warehouseId: 2 },
] }]
const stock = computeWarehouseStock(items, warehouses, transfers, buildWarehouseDocs([], sales))
// stockQty هو الإجمالي الحالي بعد البيع؛ المستندات توزعه بين المخازن ولا تخصمه مرة أخرى.
ok('سطر الرئيسي يبقى منسوباً إلى الرئيسي', stock.get(1).get(1) === 10)
ok('سطر المخزن الثاني يخصم من مخزنه', stock.get(2).get(2) === 2)
ok('يعاد توزيع إجمالي السطر بعيداً عن مخزن الرأس', stock.get(1).get(2) === 6)

const returns = [{ saleId: 10, lines: [{ itemId: 2, qty: 1, condition: 'resellable' }] }]
const afterReturn = computeWarehouseStock(items, warehouses, transfers, buildWarehouseDocs([], sales, returns))
ok('المرتجع يعيد الصنف إلى مخزن سطر الأصل', afterReturn.get(2).get(2) === 3)
ok('المرتجع لا يعيده إلى مخزن رأس الفاتورة', afterReturn.get(1).get(2) === 5)

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail) process.exit(1)
