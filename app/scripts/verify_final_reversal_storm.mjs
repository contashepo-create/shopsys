/**
 * 🌀 الفحص الختامي 1/3 — عاصفة عكس القيود (منهجية مختلفة عن الرحلات):
 * نبني مستندات من كل فئة ثم نهاجم reverseEntry من كل زاوية:
 * 1) المحمي بقائمة المنع (بيع/شراء/مرتجع/شيك/عمولة/إقفال…) يُرفض برسالة مسار بديل.
 * 2) السند الآلي (مقدم قسط/تمويل عهدة/سلفة/تحصيل عيادة) يُرفض رغم أن نوعه voucher.
 * 3) السند الحقيقي واليدوي يُعكسان — ثم: لا عكس مرتين، لا عكس للعاكس.
 * 4) البيع المؤمَّن: عكسه يرجع المخزون بالقيمة التاريخية ويصفّر المطالبة —
 *    وبعد تحصيل المطالبة يُمنع عكسه.
 * 5) بعد العاصفة كلها: الميزان متزن وكل قيد متوازن ولا سطر سالب/كسري.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_final_reversal_storm.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'pharmacy', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }
const entryBySource = (type) => [...st().journal].reverse().find((e) => e.sourceType === type)

// ───── تجهيز: مستندات من كل فئة ─────
st().addItem({ nameAr: 'دواء ألفا', categoryId: null, unit: 'علبة', priceMinor: 5000, barcode: 'A1', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
st().addSupplier({ nameAr: 'مورد الأدوية', phone: '', notes: '', ...EXT })
st().addCustomer({ nameAr: 'عميل نقدي', phone: '', creditLimitMinor: 10000000, notes: '', ...EXT })
st().addEmployee({ nameAr: 'موظف الصرف', phone: '', jobTitle: 'صيدلي', hireDate: '2025-01-01', baseSalaryMinor: 300000, allowancesMinor: 0, active: true, notes: '', ...EXT })
const item = st().items[0]
const supplier = st().suppliers[0]
const customer = st().customers[0]
const emp = st().employees[0]
st().postPurchase({ supplierId: supplier.id, date: '2026-09-01', treasury: '1101', notes: '', paidMinor: 0, expenses: [], lines: [{ itemId: item.id, qty: 100, unitPriceMinor: 3000 }] })
st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 5, unitPriceMinor: 5000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false }], payment: 'cash', treasury: '1101', customerId: customer.id, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, allowNegativeStock: false })

console.log('\n═══ 1) قائمة المنع: كل مستند بدفتر مساعد يُرفض عكسه برسالة مسار بديل ═══')
{
  const saleEntry = entryBySource('sale')
  const purchaseEntry = entryBySource('purchase')
  assert.throws(() => st().reverseEntry(saleEntry.id, 'محاولة'), /مرتجع مبيعات/)
  assert.throws(() => st().reverseEntry(purchaseEntry.id, 'محاولة'), /مرتجع شراء/)
  // شيك وارد
  const ch = st().receiveCheque({ chequeNumber: '9001', partyId: customer.id, bankName: 'CIB', amountMinor: 10000, dueDate: '2026-10-01', notes: '' })
  assert.throws(() => st().reverseEntry(entryBySource('cheque_receive').id, 'x'), /دفتر الشيكات/)
  st().setChequeStatus(ch.id, 'bounced') // تنظيف: الدين يعود
  // قيد شبح
  assert.throws(() => st().reverseEntry(999999, 'x'), /غير موجود/)
  ok('بيع وشراء وشيك مرفوضون بعكس مباشر — وكلٌّ برسالة مساره الصحيح، والقيد الشبح مرفوض')
}

console.log('\n═══ 2) السندات الآلية تُرفض رغم أن نوعها voucher ═══')
{
  // مقدم خطة أقساط (receipt_voucher آلي ليس في سجل السندات)
  st().setOpeningBalance({ kind: 'customer', refId: customer.id, amountMinor: 200000, label: 'مديونية' })
  st().createInstallmentPlan({ customerId: customer.id, saleId: null, totalMinor: 200000, downPaymentMinor: 50000, count: 3, intervalMonths: 1, firstDueDate: '2026-10-01', treasury: '1101', notes: '' })
  const downEntry = [...st().journal].reverse().find((e) => e.sourceType === 'receipt_voucher')
  assert.throws(() => st().reverseEntry(downEntry.id, 'x'), /مولد آلياً/)
  // تمويل عهدة (payment_voucher آلي مرتبط بحركة عهدة)
  const file = st().openCustodyFile({ employeeId: emp.id, projectId: null, reason: 'عهدة', notes: '' })
  st().fundCustodyFile({ fileId: file.id, amountMinor: 30000, treasury: '1101', description: 'تعزيز' })
  const fundEntry = [...st().journal].reverse().find((e) => e.sourceType === 'payment_voucher')
  assert.throws(() => st().reverseEntry(fundEntry.id, 'x'), /مولد آلياً|عهدة/)
  // سلفة موظف
  st().grantEmployeeAdvance({ employeeId: emp.id, amountMinor: 20000, treasury: '1101', notes: '' })
  const advEntry = [...st().journal].reverse().find((e) => e.sourceType === 'payment_voucher')
  assert.throws(() => st().reverseEntry(advEntry.id, 'x'), /مولد آلياً|سلفة/)
  ok('مقدم القسط وتمويل العهدة والسلفة — ثلاثتها سندات آلية محمية من العكس')
}

console.log('\n═══ 3) اليدوي والسند الحقيقي يُعكسان — ولا عكس مزدوج ولا عكس للعاكس ═══')
{
  const manual = st().postManualEntry({ date: '2026-09-20', description: 'تسوية يدوية', lines: [
    { accountCode: '5108', debit: 7000, credit: 0, note: '' },
    { accountCode: '1101', debit: 0, credit: 7000, note: '' },
  ] })
  const rev = st().reverseEntry(manual.id, 'خطأ إدخال')
  assert.equal(rev.sourceType, 'reversal')
  assert.deepEqual(
    rev.lines.map((l) => [l.accountCode, l.debit, l.credit]),
    [['5108', 0, 7000], ['1101', 7000, 0]],
    'العاكس مرآة تامة'
  )
  assert.throws(() => st().reverseEntry(manual.id, 'ثانية'), /معكوس بالفعل/)
  assert.throws(() => st().reverseEntry(rev.id, 'عكس العاكس'), /قيد عاكس/)
  // سند حقيقي من شاشة السندات (مسجل في سجل السندات) يُعكس
  st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5103', amountMinor: 12000, description: 'إيجار مدفوع بالغلط' })
  const realVoucherEntry = [...st().journal].reverse().find((e) => e.sourceType === 'payment_voucher')
  const rev2 = st().reverseEntry(realVoucherEntry.id, 'دفع مكرر')
  assert.equal(rev2.reversesEntryId, realVoucherEntry.id)
  ok('اليدوي والسند الحقيقي عُكسا بمرآة تامة — والمزدوج وعكس العاكس مرفوضان')
}

console.log('\n═══ 4) البيع المؤمَّن: العكس يرجع المخزون ويصفّر المطالبة — وبعد التحصيل يُمنع ═══')
{
  st().addInsuranceProvider({ nameAr: 'شركة تأمين النيل', coveragePercent: 70 })
  const provider = st().insuranceProviders[0]
  const stockBefore = st().items.find((i) => i.id === item.id).stockQty
  st().postInsuredSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 10, unitPriceMinor: 5000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false }], providerId: provider.id, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  assert.equal(st().items.find((i) => i.id === item.id).stockQty, stockBefore - 10, 'خُصم المخزون')
  const claim1 = st().insuranceClaims.find((c) => !c.settled && c.claimMinor > 0)
  assert.equal(claim1.claimMinor, 35000, 'مطالبة الجهة 70%')
  const insEntry1 = entryBySource('insured_sale')
  st().reverseEntry(insEntry1.id, 'بيانات تغطية خاطئة')
  assert.equal(st().items.find((i) => i.id === item.id).stockQty, stockBefore, 'المخزون رجع كاملاً')
  assert.equal(st().insuranceClaims.find((c) => c.id === claim1.id).claimMinor, 0, 'المطالبة صُفّرت — لن تُحصَّل عن بيع ملغي')
  // بيع مؤمَّن ثانٍ يُحصَّل ثم تُحاوَل إعادة عكسه
  st().postInsuredSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 4, unitPriceMinor: 5000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false }], providerId: provider.id, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  st().settleInsuranceClaims(provider.id, '1101')
  const insEntry2 = entryBySource('insured_sale')
  assert.throws(() => st().reverseEntry(insEntry2.id, 'x'), /حُصِّلت/)
  ok('عكس المؤمَّن أرجع 10 علب وصفّر مطالبة 350 — وبعد تحصيل الجهة العكس ممنوع')
}

console.log('\n═══ 5) سلامة الدفاتر بعد العاصفة كلها ═══')
{
  let totalD = 0, totalC = 0
  for (const e of st().journal) {
    const d = e.lines.reduce((s, l) => s + l.debit, 0)
    const c = e.lines.reduce((s, l) => s + l.credit, 0)
    assert.equal(d, c, `قيد ${e.id} (${e.sourceType}) مختل`)
    totalD += d; totalC += c
    for (const l of e.lines) {
      assert.ok(l.debit >= 0 && l.credit >= 0, `سطر سالب في قيد ${e.id}`)
      assert.ok(Number.isInteger(l.debit) && Number.isInteger(l.credit), `كسور في قيد ${e.id}`)
      assert.ok(!(l.debit > 0 && l.credit > 0), `سطر مدين ودائن معاً في قيد ${e.id}`)
    }
  }
  assert.equal(totalD, totalC)
  // ترابط العكس: كل reversal يشير لأصله والأصل يشير له
  for (const e of st().journal.filter((x) => x.sourceType === 'reversal')) {
    const orig = st().journal.find((x) => x.id === e.reversesEntryId)
    assert.equal(orig.reversedByEntryId, e.id, `ترابط عكس مكسور بين ${orig.id} و${e.id}`)
  }
  ok(`${st().journal.length} قيداً بعد العاصفة: متوازنة، لا سوالب/كسور، وترابط العكس سليم (${totalD})`)
}

console.log(`\n✅ الفحص الختامي 1/3 (عاصفة العكس): ${pass} محطات — كلها خضراء\n`)
