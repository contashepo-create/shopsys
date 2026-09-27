/**
 * الخزينة والنقدية في كل الأنشطة الـ16 + تكاملها مع الأقسام المراجعة
 * (منهجية المالك: كل قسم يُفحص في كل الأنشطة وتكامله مع ما سبق)
 *
 * لكل نشاط متجر نظيف — دورة نقدية متشابكة مع البيع والشراء:
 * 1) افتتاحي خزينة 5000 وبنك 3000 (قيد رأس مال)
 * 2) شراء آجل ⇒ سند صرف جزئي للمورد ⇒ كشفه يطابق 2101
 * 3) بيع آجل لعميل ⇒ سند قبض جزئي ⇒ كشفه يطابق 1104
 * 4) شيك وارد من العميل بباقي دينه ⇒ تحصيل في البنك ⇒ دينه صفر
 * 5) شيك صادر للمورد بباقي دينه ⇒ صرف من البنك ⇒ مستحقه صفر
 * 6) تحويل خزينة→بنك برسوم ⇒ 5108
 * 7) جرد خزينة بعجز ⇒ 5112 بموافقة
 * 8) الحارس: صرف يكسر الرصيد يُرفض (الإعداد يمنع السالب)
 * 9) الثوابت: كل القيود متوازنة، الخزائن غير سالبة، كشوف الطرفين صفر
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
const { customerStatement, supplierStatement, statementBalance } = await import(join(root, 'src/core/statements.ts'))

const ACTIVITIES = ACTIVITY_TEMPLATES.map((a) => a.id)
assert.equal(ACTIVITIES.length, 29)

let pass = 0
const repoUrl = pathToFileURL(join(root, 'src/data/repo.ts')).href

for (const activityId of ACTIVITIES) {
  const nameAr = ACTIVITY_TEMPLATES.find((a) => a.id === activityId).nameAr
  mem.clear()
  // الإعداد يمنع الرصيد السالب — فحص الحارس المركزي في كل نشاط
  mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  done: true, countryCode: 'EG', activityId, vatPercent: 0, taxInclusive: true, allowNegativeTreasury: false }, license: { plan: 'pro' } }, version: 0 }))
  const { useDataStore } = await import(`${repoUrl}?trsactivity=${activityId}`)
  const st = () => useDataStore.getState()
  const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

  st().seed([])
  // 1) افتتاحي
  st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 500000, label: 'خزينة' })
  st().setOpeningBalance({ kind: 'treasury', refId: '1102', amountMinor: 300000, label: 'بنك' })
  st().addCustomer({ nameAr: `عميل ${nameAr}`, phone: '0111', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
  const cust = st().customers.at(-1)
  st().addSupplier({ nameAr: `مورد ${nameAr}`, phone: '0100', notes: '' })
  const sup = st().suppliers.at(-1)
  st().addItem({ nameAr: `صنف ${nameAr}`, sku: 'TR-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, priceMinor: 20000, minQty: 0, stockQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = st().items.at(-1)

  // 2) شراء آجل 1000 ⇒ سند صرف 400
  st().postPurchase({ supplierId: sup.id, date: '2026-09-18', lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 10000 }], expenses: [], paidMinor: 0, notes: '' })
  st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 40000, description: 'دفعة', partyKind: 'supplier', partyId: sup.id })
  const ssMid = statementBalance(supplierStatement({ supplierId: sup.id, openingMinor: 0, purchases: st().purchases, purchaseReturns: st().purchaseReturns, allPurchases: st().purchases, vouchers: st().vouchers, cheques: st().cheques }))
  assert.equal(ssMid, 60000, `${activityId}: كشف المورد بعد الصرف`)
  assert.equal(ssMid, -bal('2101'), `${activityId}: الكشف = 2101`)

  // 3) بيع آجل 600 ⇒ سند قبض 200
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 3, unitPriceMinor: 20000, unitCostMinor: 10000, discountPercent: 0, soldByWeight: false }], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 20000, description: 'دفعة', partyKind: 'customer', partyId: cust.id })
  assert.equal(st().getCustomerBalance(cust.id), 40000, `${activityId}: رصيد العميل`)

  // 4) شيك وارد بباقي الدين 400 ⇒ تحصيل بنكي
  const chqIn = st().receiveCheque({ chequeNumber: `IN-${activityId}`, partyId: cust.id, bankName: 'بنك مصر', amountMinor: 40000, dueDate: '2026-10-01', notes: '' })
  st().setChequeStatus(chqIn.id, 'deposited')
  st().setChequeStatus(chqIn.id, 'collected', '1102')
  assert.equal(st().getCustomerBalance(cust.id), 0, `${activityId}: دين العميل صفر بعد التحصيل`)
  const csFinal = statementBalance(customerStatement({ customerId: cust.id, openingMinor: 0, sales: st().sales, saleReturns: st().saleReturns, allSales: st().sales, vouchers: st().vouchers, cheques: st().cheques }))
  assert.equal(csFinal, 0, `${activityId}: كشف العميل صفر`)

  // 5) شيك صادر بباقي مستحق المورد 600 ⇒ صرف بنكي
  const chqOut = st().issueCheque({ chequeNumber: `OUT-${activityId}`, partyId: sup.id, bankName: 'CIB', amountMinor: 60000, dueDate: '2026-10-05', notes: '' })
  st().setChequeStatus(chqOut.id, 'cleared', '1102')
  const ssFinal = statementBalance(supplierStatement({ supplierId: sup.id, openingMinor: 0, purchases: st().purchases, purchaseReturns: st().purchaseReturns, allPurchases: st().purchases, vouchers: st().vouchers, cheques: st().cheques }))
  assert.equal(ssFinal, 0, `${activityId}: كشف المورد صفر`)
  assert.equal(bal('1106'), 0, `${activityId}: أوراق قبض صفر`)
  assert.equal(bal('2106'), 0, `${activityId}: أوراق دفع صفر`)

  // 6) تحويل برسوم
  const feesBefore = bal('5108')
  st().postVoucher({ kind: 'transfer', treasury: '1101', counterAccountCode: '1102', amountMinor: 50000, description: 'إيداع', feeMinor: 250 })
  assert.equal(bal('5108') - feesBefore, 250, `${activityId}: رسوم التحويل`)

  // 7) جرد خزينة بعجز 10 ⇒ 5112
  const cashBook = bal('1101')
  st().applySettlement({ section: 'treasury', refId: '1101', actualMinor: cashBook - 1000, reason: 'جرد', approvedBy: 'المشرف' })
  assert.equal(bal('5112'), 1000, `${activityId}: عجز الجرد 5112`)

  // 8) الحارس المركزي
  const cashNow = bal('1101')
  assert.throws(() => st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: cashNow + 1, description: 'كسر' }), /سالباً/, `${activityId}: الحارس`)
  assert.equal(bal('1101'), cashNow)

  // 9) الثوابت
  for (const e of st().journal) assertBalanced(e.lines)
  assert.ok(bal('1101') >= 0 && bal('1102') >= 0, `${activityId}: لا خزينة سالبة`)

  pass++
  console.log(`  ✓ ${nameAr} (${activityId}): سندات↔شيكات↔تحويل↔جرد خزينة — كشوف الطرفين صفر و${st().journal.length} قيداً متوازناً`)
}

assert.equal(pass, 29)
console.log(`\n✅ verify_treasury_all_activities: الدورة النقدية الكاملة سليمة على الأنشطة الـ${pass}`)
