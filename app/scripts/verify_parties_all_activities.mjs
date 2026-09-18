/**
 * العملاء والموردون في كل الأنشطة الـ16 + تكاملهم مع الأقسام المراجعة
 *
 * لكل نشاط متجر نظيف — دورة ذمم متشابكة:
 * 1) عميل بحد ائتمان + مورد، وافتتاحي لكل منهما بقيد فعلي
 * 2) شراء آجل ⇒ مستحق المورد يتراكم فوق الافتتاحي
 * 3) بيع آجل داخل الحد ⇒ ذمة العميل فوق افتتاحيه؛ بيع يكسر الحد يُرفض
 * 4) سداد جزئي بسند لكل طرف ⇒ الكشفان يطابقان 1104/2101
 * 5) أعمار الديون: مجموع الشرائح = الرصيد لكل طرف (الافتتاحي +90)
 * 6) حذف الطرفين مرفوض (رصيد+معاملات)، والاسم المكرر مرفوض
 * 7) الثوابت: قيود متوازنة و1104/2101 = Σ الأرصدة
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }

const { ACTIVITY_TEMPLATES } = await import(join(root, 'src/core/activities.ts'))
const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
const { agingFromStatement, supplierRowsForAging, statementBalance } = await import(join(root, 'src/core/statements.ts'))

const ACTIVITIES = ACTIVITY_TEMPLATES.map((a) => a.id)
assert.equal(ACTIVITIES.length, 18)

let pass = 0
const repoUrl = pathToFileURL(join(root, 'src/data/repo.ts')).href
const today = new Date().toISOString().slice(0, 10)

for (const activityId of ACTIVITIES) {
  const nameAr = ACTIVITY_TEMPLATES.find((a) => a.id === activityId).nameAr
  mem.clear()
  mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  done: true, countryCode: 'EG', activityId, vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))
  const { useDataStore } = await import(`${repoUrl}?partiesactivity=${activityId}`)
  const st = () => useDataStore.getState()
  const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

  st().seed([])
  // 1) الأطراف والافتتاحي
  st().addCustomer({ nameAr: `عميل ${nameAr}`, phone: '0111', address: '', notes: '', openingMinor: 0, creditLimitMinor: 100000 })
  const cust = st().customers.at(-1)
  st().setOpeningBalance({ kind: 'customer', refId: cust.id, amountMinor: 30000, label: cust.nameAr })
  st().addSupplier({ nameAr: `مورد ${nameAr}`, phone: '0100', notes: '' })
  const sup = st().suppliers.at(-1)
  st().setOpeningBalance({ kind: 'supplier', refId: sup.id, amountMinor: 20000, label: sup.nameAr })
  assert.equal(st().getCustomerBalance(cust.id), 30000, `${activityId}: افتتاحي العميل`)
  assert.equal(st().getSupplierBalance(sup.id), 20000, `${activityId}: افتتاحي المورد`)

  // 2) شراء آجل
  st().addItem({ nameAr: `صنف ${nameAr}`, sku: 'PA-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, priceMinor: 20000, minQty: 0, stockQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = st().items.at(-1)
  st().postPurchase({ supplierId: sup.id, date: today, lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 10000 }], expenses: [], paidMinor: 0, notes: '' })
  assert.equal(st().getSupplierBalance(sup.id), 120000, `${activityId}: مستحق المورد بعد الشراء`)

  // 3) بيع آجل داخل الحد (300 افتتاحي + 400 = 700 < 1000) ثم كسر الحد
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 20000, unitCostMinor: 10000, discountPercent: 0, soldByWeight: false }], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  assert.equal(st().getCustomerBalance(cust.id), 70000, `${activityId}: ذمة العميل`)
  assert.throws(
    () => st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 20000, unitCostMinor: 10000, discountPercent: 0, soldByWeight: false }], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' }),
    /ائتمان/,
    `${activityId}: كسر حد الائتمان`,
  )

  // 4) سدادات جزئية
  st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 25000, description: 'دفعة', partyKind: 'customer', partyId: cust.id })
  st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 45000, description: 'سداد', partyKind: 'supplier', partyId: sup.id })
  assert.equal(st().getCustomerBalance(cust.id), 45000, `${activityId}: العميل بعد السداد`)
  assert.equal(st().getSupplierBalance(sup.id), 75000, `${activityId}: المورد بعد السداد`)
  assert.equal(statementBalance(st().getCustomerStatementRows(cust.id)), 45000, `${activityId}: الكشف=الرصيد`)

  // 5) الأعمار
  const ca = agingFromStatement(st().getCustomerStatementRows(cust.id), today)
  assert.equal(ca.totalMinor, 45000, `${activityId}: Σ شرائح العميل`)
  // السداد 250 أكل الافتتاحي 300 جزئياً FIFO ⇒ بقي 50 افتتاحياً (+90) و400 حديثة
  assert.equal(ca.over90Minor, 5000, `${activityId}: بقية الافتتاحي +90`)
  assert.equal(ca.currentMinor, 40000, `${activityId}: الفاتورة الحديثة 0–30`)
  const sa = agingFromStatement(supplierRowsForAging(st().getSupplierStatementRows(sup.id)), today)
  assert.equal(sa.totalMinor, 75000, `${activityId}: Σ شرائح المورد`)

  // 6) الحمايات
  assert.throws(() => st().removeCustomer(cust.id), /رصيد قائم/, `${activityId}: حذف عميل مدين`)
  assert.throws(() => st().removeSupplier(sup.id), /رصيد قائم/, `${activityId}: حذف مورد دائن`)
  assert.throws(() => st().addCustomer({ nameAr: `عميل ${nameAr}`, phone: '', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 }), /بنفس الاسم/, `${activityId}: تكرار عميل`)
  assert.throws(() => st().addSupplier({ nameAr: `مورد ${nameAr}`, phone: '', notes: '' }), /بنفس الاسم/, `${activityId}: تكرار مورد`)

  // 7) الثوابت
  for (const e of st().journal) assertBalanced(e.lines)
  assert.equal(bal('1104'), st().customers.reduce((s, c) => s + st().getCustomerBalance(c.id), 0), `${activityId}: 1104=Σ`)
  assert.equal(-bal('2101'), st().suppliers.reduce((s, x) => s + st().getSupplierBalance(x.id), 0), `${activityId}: 2101=Σ`)

  pass++
  console.log(`  ✓ ${nameAr} (${activityId}): افتتاحي↔آجل↔حد ائتمان↔سندات↔أعمار FIFO — 1104/2101 = Σ الأرصدة بالقرش`)
}

assert.equal(pass, 18)
console.log(`\n✅ verify_parties_all_activities: دورة الذمم الكاملة سليمة على الأنشطة الـ${pass}`)
