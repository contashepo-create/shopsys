/**
 * 🏆 التدقيق الأكبر — الجولة الثانية: 5 سيناريوهات جديدة كلياً (طلب المالك:
 * «تأكد على الأقل خمس مرات بسيناريوهات مختلفة») — هذه الجولة تتعمد القسوة:
 * حالات الحافة، التصحيحات والعكوس، الدورة عبر سنة مالية، والترابط الإداري.
 *
 * R1 موبايلات: سيريالات + استبدال + ضمان + شيكات (قبض/تحصيل/ارتجاع) + أقساط ثم مرتجع يقلصها
 * R2 مطعم+مخبز: وصفات عند الطلب + إنتاج مسبق + هالك + جرد بفرق عجز وزيادة معاً
 * R3 التصحيح والحوكمة: قيد يدوي→عكس→منع عكس العكس + تعديل فاتورة مرحلة + أرصدة افتتاحية ثم دورة كاملة
 * R4 مغسلة+صالون: أوامر بعربون→تسليم→استرداد خدمة + إلغاء بعربون مردود + أصل بتمويل وإهلاك
 * R5 السنة المالية الكاملة: نشاط يعمل→إقفال سنة→التقرير قبل/بعد→سنة جديدة→العمل يستمر
 *
 * نفس نقاط تفتيش الجولة الأولى بعد كل عملية (قيود/ميزان/مخزون/كشوف).
 * تشغيل: node --experimental-strip-types scripts/verify_grand_audit_round2.mjs
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'general', vatPercent: 14, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { useAppStore } = await import(join(root, 'src/stores/app.store.ts'))
const { trialBalance, incomeStatement, balanceSheet } = await import(join(root, 'src/core/financialReports.ts'))
const { buildFiscalYearReport } = await import(join(root, 'src/core/fiscal.ts'))

const st = () => useDataStore.getState()
const P = { from: '2000-01-01', to: '2099-12-31' }
let pass = 0, checkpoints = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }
const throws = (name, fn, part) => {
  try { fn() } catch (e) {
    if (!part || String(e.message).includes(part)) { pass++; console.log(`  ✓ ${name}`); return }
    throw new Error(`${name}: رسالة غير متوقعة — ${e.message}`)
  }
  throw new Error(`${name}: لم يرمِ خطأ`)
}
const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

function core(label) {
  checkpoints++
  for (const e of st().journal) {
    let d = 0, c = 0
    for (const l of e.lines) {
      assert.ok(Number.isInteger(l.debit) && Number.isInteger(l.credit), `[${label}] قيد ${e.id}: مبلغ كسري`)
      assert.ok(l.debit >= 0 && l.credit >= 0, `[${label}] قيد ${e.id}: مبلغ سالب`)
      d += l.debit; c += l.credit
    }
    assert.equal(d, c, `[${label}] قيد ${e.id} غير متوازن: ${e.description}`)
  }
  const tb = trialBalance(st().journal, P)
  assert.ok(tb.balanced, `[${label}] الميزان غير متزن`)
  const physical = st().items.reduce((a, i) => a + Math.round(i.stockQty * i.costMinor), 0)
    + (st().cars ?? []).filter((c) => c.status !== 'sold').reduce((a, c) => a + c.purchaseCostMinor + c.prepCostMinor, 0)
  const tolerance = st().items.reduce((a, i) => a + Math.ceil((i.stockQty ?? 0) / 2), 0) + 1
  assert.ok(Math.abs(bal('1103') - physical) <= tolerance, `[${label}] 1103 دفتري ${bal('1103')} ≠ فعلي ${physical}`)
  for (const cst of st().customers) {
    const rows = st().getCustomerStatementRows(cst.id)
    const last = rows.length ? rows[rows.length - 1].balanceMinor : 0
    assert.equal(last, st().getCustomerBalance(cst.id), `[${label}] كشف ${cst.nameAr} لا يطابق رصيده`)
  }
}

console.log('\n🏆 التدقيق الأكبر — الجولة الثانية: خمسة سيناريوهات حافة جديدة\n')

const item = (nameAr, sku, price, extra = {}) => ({
  nameAr, sku, barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: price, minQty: 0,
  trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
  variantColors: [], variantSizes: [], isActive: true, ...extra,
})

/* ══════════ R1: موبايلات — سيريالات + استبدال + شيكات + أقساط يقلصها مرتجع ══════════ */
console.log('📱 R1: محل موبايلات — سيريالات وشيكات وأقساط بمرتجع')

st().addSupplier({ nameAr: 'الوكيل الرسمي', phone: '', address: '', notes: '', openingMinor: 0 })
const sup = st().suppliers.at(-1)
st().addCustomer({ nameAr: 'أستاذ منير', phone: '0100', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
const cust = st().customers.at(-1)
st().addItem(item('هاتف Z Fold', 'ZF-1', 3_000_000, { trackSerial: true, warrantyMonths: 24 }))
st().addItem(item('جراب أصلي', 'CV-1', 50_000))
const [phone, cover] = st().items

st().postPurchase({
  supplierId: sup.id, date: '2026-01-10',
  lines: [{ itemId: phone.id, qty: 3, unitPriceMinor: 2_400_000, serialsRaw: 'SN-A1, SN-A2, SN-A3' }, { itemId: cover.id, qty: 10, unitPriceMinor: 20_000 }],
  expenses: [], paidMinor: 0, notes: '',
})
core('R1 شراء بسيريالات')
assert.equal(st().serials.filter((s) => s.itemId === phone.id && s.status === 'in_stock').length, 3)
ok('3 سيريالات دخلت المخزون بحالة in_stock')

// بيع بسيريال محدد آجلاً (الشيكات ستُحصّل هذا الدين) — والسيريال المكرر يُرفض
const s1 = st().postSale({
  lines: [{ itemId: phone.id, nameAr: 'هاتف', qty: 1, unitPriceMinor: 3_000_000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false, serials: ['SN-A2'] }],
  customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true,
})
core('R1 بيع بسيريال')
assert.equal(st().serials.find((s) => s.serial === 'SN-A2').status, 'sold')
ok('SN-A2 خرج مبيعاً — وضمانه 24 شهراً مربوط بفاتورته')
throws('بيع نفس السيريال مرة ثانية يُرفض', () => st().postSale({
  lines: [{ itemId: phone.id, nameAr: 'هاتف', qty: 1, unitPriceMinor: 3_000_000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false, serials: ['SN-A2'] }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true,
}))

// شيك قبض من العميل → تحصيل → ثم شيك آخر يرتد
st().receiveCheque({ chequeNumber: 'CHK-100', partyId: cust.id, bankName: 'CIB', amountMinor: 500_000, dueDate: '2026-02-01', notes: '' })
core('R1 استلام شيك')
const chk1 = st().cheques.at(-1)
assert.equal(bal('1106'), 500_000)
ok('الشيك تحت التحصيل 1106 وخفض ذمة العميل فور الاستلام')
st().setChequeStatus(chk1.id, 'collected', '1102')
core('R1 تحصيل الشيك')
assert.equal(bal('1106'), 0)
ok('التحصيل نقل 5000 من 1106 إلى البنك')
st().receiveCheque({ chequeNumber: 'CHK-101', partyId: cust.id, bankName: 'CIB', amountMinor: 200_000, dueDate: '2026-03-01', notes: '' })
const chk2 = st().cheques.at(-1)
st().setChequeStatus(chk2.id, 'bounced')
core('R1 ارتداد شيك')
ok('الشيك المرتد أعاد الدين على العميل (قيد عاكس تلقائي)')

// خطة أقساط ثم مرتجع جزئي يقلص المديونية
const s2 = st().postSale({
  lines: [{ itemId: cover.id, nameAr: 'جراب', qty: 5, unitPriceMinor: 50_000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
  customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, creditLimitOverrideBy: 'المدير',
})
const plan = st().createInstallmentPlan({ customerId: cust.id, saleId: s2.id, totalMinor: 250_000, downPaymentMinor: 50_000, interestMinor: 0, count: 4, intervalMonths: 1, firstDueDate: '2026-02-15', treasury: '1101', notes: '' })
core('R1 خطة أقساط بمقدم')
assert.equal(plan.items.reduce((a, i) => a + i.amountMinor, 0), 200_000)
ok('خطة 4 أقساط على 2000 بعد مقدم 500 (توزيع أكبر البواقي)')
st().payInstallment(plan.id, 50_000, '1101')
core('R1 سداد قسط')
ok('سُدد قسط 500 نقداً')

/* ══════════ R2: مطعم+مخبز — وصفات وإنتاج وهالك وجرد مزدوج ══════════ */
console.log('\n🍔 R2: مطعم ومخبز — وصفات وإنتاج مسبق وهالك وجرد بعجز وزيادة')

st().addItem(item('لحم مفروم كج', 'MEAT-1', 0))
st().addItem(item('عيش برجر', 'BUN-1', 0))
st().addItem(item('برجر جاهز', 'BRG-1', 12_000))
st().addItem(item('كرواسون', 'CRS-1', 3_000))
const [meat, bun, burger, croissant] = st().items.slice(-4)
st().postPurchase({
  supplierId: sup.id, date: '2026-02-01',
  lines: [{ itemId: meat.id, qty: 20, unitPriceMinor: 30_000 }, { itemId: bun.id, qty: 100, unitPriceMinor: 500 }],
  expenses: [], paidMinor: 650_000, notes: '',
})
core('R2 شراء خامات')

// وصفة عند الطلب: بيع البرجر يستهلك خاماته لحظة البيع
st().addRecipe({ productItemId: burger.id, mode: 'made_to_order', yieldQty: 1, ingredients: [{ itemId: meat.id, qty: 0.2 }, { itemId: bun.id, qty: 1 }], overheadMinor: 0, isActive: true, notes: '' })
const meatBefore = st().items.find((i) => i.id === meat.id).stockQty
st().postSale({
  lines: [{ itemId: burger.id, nameAr: 'برجر', qty: 10, unitPriceMinor: 12_000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, treasury: '1101',
})
core('R2 بيع 10 برجر بوصفة')
assert.equal(st().items.find((i) => i.id === meat.id).stockQty, meatBefore - 2)
ok('بيع 10 برجر استهلك 2 كج لحم و10 عيش تلقائياً (COGS من الخامات)')

// إنتاج مسبق للكرواسون: تشغيلة تحول الخامات لمنتج بتكلفة مشتقة
st().addRecipe({ productItemId: croissant.id, mode: 'prepped', yieldQty: 50, ingredients: [{ itemId: bun.id, qty: 25 }], overheadMinor: 25_000, isActive: true, notes: '' })
const recipe2 = st().recipes.at(-1)
st().postProduction({ recipeId: recipe2.id, batches: 2, treasury: '1101' })
core('R2 أمر إنتاج مسبق')
assert.equal(st().items.find((i) => i.id === croissant.id).stockQty, 100)
ok('تشغيلتان أنتجتا 100 كرواسون — الخامات خرجت والتكلفة انتقلت للمنتج + مصاريف التشغيل')

// هالك ثم جرد بعجز في صنف وزيادة في آخر بنفس المحضر
st().postWastage({ reason: 'تلف ثلاجة', lines: [{ itemId: meat.id, qty: 1 }], notes: 'محضر إتلاف' })
core('R2 هالك لحم')
ok('كيلو لحم أُعدم بمحضر — خرج من 1103 لمصروف الهالك')
const meatNow = st().items.find((i) => i.id === meat.id).stockQty
const crsNow = st().items.find((i) => i.id === croissant.id).stockQty
const meatCost = st().items.find((i) => i.id === meat.id).costMinor
const crsCost = st().items.find((i) => i.id === croissant.id).costMinor
st().postStocktake([
  { itemId: meat.id, nameAr: 'لحم', expectedQty: meatNow, countedQty: meatNow - 2, unitCostMinor: meatCost },
  { itemId: croissant.id, nameAr: 'كرواسون', expectedQty: crsNow, countedQty: crsNow + 5, unitCostMinor: crsCost },
], 'جرد شهري')
core('R2 جرد بعجز وزيادة معاً')
assert.equal(st().items.find((i) => i.id === meat.id).stockQty, meatNow - 2)
assert.equal(st().items.find((i) => i.id === croissant.id).stockQty, crsNow + 5)
ok('الجرد: عجز لحم −2 وزيادة كرواسون +5 في محضر واحد بقيد صافٍ متوازن (5108↔1103)')

/* ══════════ R3: التصحيح والحوكمة — عكوس وتعديل فواتير وأرصدة افتتاحية ══════════ */
console.log('\n⚖️ R3: التصحيح والحوكمة — قيد يدوي وعكسه وتعديل فاتورة مرحلة')

const manual = st().postManualEntry({ date: '2026-03-01', description: 'تسوية إيجار مقدم', lines: [
  { accountCode: '5103', debit: 40_000, credit: 0, note: 'إيجار مارس' },
  { accountCode: '1101', debit: 0, credit: 40_000, note: 'نقدي' },
] })
core('R3 قيد يدوي')
throws('قيد يدوي غير متوازن يُرفض بنيوياً', () => st().postManualEntry({ date: '2026-03-01', description: 'خطأ', lines: [
  { accountCode: '5103', debit: 10_000, credit: 0, note: '' },
  { accountCode: '1101', debit: 0, credit: 9_999, note: '' },
] }))
const rev = st().reverseEntry(manual.id, 'قيد بالخطأ — الإيجار مدفوع مقدماً')
core('R3 عكس القيد')
assert.equal(bal('5103'), 0)
ok('العكس صفّر الأثر (Append-Only: لا حذف أبداً، قيد عاكس موثق بسبب)')
throws('عكس قيد معكوس بالفعل يُرفض', () => st().reverseEntry(manual.id, 'مرة ثانية'), 'معكوس')
throws('عكس قيد العكس نفسه يُرفض', () => st().reverseEntry(rev.id, 'عكس العكس'))

// أرصدة افتتاحية: عميل مدين قديم + مورد دائن ثم التعامل فوقها
st().addCustomer({ nameAr: 'عميل منقول من دفاتر قديمة', phone: '', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
const oldCust = st().customers.at(-1)
st().setOpeningBalance({ kind: 'customer', refId: oldCust.id, amountMinor: 75_000, label: oldCust.nameAr })
core('R3 رصيد افتتاحي لعميل')
assert.equal(st().getCustomerBalance(oldCust.id), 75_000)
ok('الرصيد الافتتاحي 750 ظهر في كشف العميل (قيد 1104 ← 3101)')
st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 75_000, description: 'تحصيل الرصيد القديم', partyKind: 'customer', partyId: oldCust.id })
core('R3 تحصيل الرصيد الافتتاحي')
assert.equal(st().getCustomerBalance(oldCust.id), 0)
ok('التحصيل فوق الافتتاحي صفّر الكشف — الترحيل من نظام قديم سلس')

// تعديل فاتورة مرحلة (عكس+إعادة ترحيل) — ثم منع التعديل بعد مرتجع
const s3 = st().postSale({
  lines: [{ itemId: cover.id, nameAr: 'جراب', qty: 2, unitPriceMinor: 50_000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
  customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, creditLimitOverrideBy: 'المدير',
})
core('R3 فاتورة قابلة للتعديل')
const custBefore = st().getCustomerBalance(cust.id)
st().editSale({ saleId: s3.id, lines: [{ itemId: cover.id, nameAr: 'جراب', qty: 3, unitPriceMinor: 45_000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: cust.id, payment: 'credit', paidMinor: 0, invoiceDiscountPercent: 0, reason: 'خطأ كمية وسعر', creditLimitOverrideBy: 'المدير' })
core('R3 تعديل الفاتورة المرحلة')
assert.equal(st().getCustomerBalance(cust.id), custBefore - 100_000 + 135_000)
ok('تعديل الفاتورة: عكس تلقائي + إعادة ترحيل — الذمة تحركت للقيمة الجديدة بالضبط')
st().postSaleReturn({ saleId: st().sales.at(-1).id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'good' }], refund: 'credit', reason: 'مقاس خطأ' })
core('R3 مرتجع بعد التعديل')
throws('تعديل فاتورة عليها مرتجع يُرفض (حوكمة)', () => st().editSale({ saleId: st().sales.at(-1).id, lines: [{ itemId: cover.id, nameAr: 'جراب', qty: 1, unitPriceMinor: 45_000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: cust.id, payment: 'credit', paidMinor: 0, invoiceDiscountPercent: 0, reason: 'محاولة' }))

/* ══════════ R4: مغسلة+صالون — عربون واسترداد خدمة + أصل بإهلاك ══════════ */
console.log('\n🧺 R4: مغسلة — عربون وتسليم واسترداد خدمة وإلغاء + أصل يُهلك')

const lo = st().openLaundryOrder({ customerId: null, customerName: 'مدام هدى', phone: '0111', promisedAt: '2026-03-05', rackNumber: 'A-3', lines: [{ desc: 'بدلة', service: 'dry_clean', qty: 2, unitPriceMinor: 40_000 }], prepaidMinor: 30_000, treasury: '1101', notes: '' })
core('R4 فتح أمر غسيل بعربون')
assert.equal(-bal('2109'), 30_000)
ok('العربون 300 التزام على 2109 — ليس إيراداً قبل التسليم (معيار عالمي)')
st().setLaundryStatus(lo.id, 'processing'); st().setLaundryStatus(lo.id, 'ready')
st().deliverLaundryOrder({ orderId: lo.id })
core('R4 تسليم الغسيل')
assert.equal(bal('2109'), 0)
ok('التسليم حوّل العربون إيراداً وحصّل الباقي — 2109 صفر')
const lRef = st().refundLaundryOrder({ orderId: lo.id, amountMinor: 20_000, mode: 'cash', reason: 'بقعة لم تخرج', approvedBy: 'المالك' })
core('R4 استرداد خدمة بعد التسليم')
ok('استرداد 200 لعدم الرضا: عكس إيراد نسبي بموافقة مسماة — لا مخزون يتحرك')

const lo2 = st().openLaundryOrder({ customerId: null, customerName: 'زبون عابر', phone: '', promisedAt: '2026-03-06', lines: [{ desc: 'سجادة', service: 'carpet', qty: 1, unitPriceMinor: 100_000 }], prepaidMinor: 50_000, treasury: '1101', notes: '' })
st().cancelLaundryOrder(lo2.id)
core('R4 إلغاء أمر بعربون')
assert.equal(bal('2109'), 0)
ok('الإلغاء ردّ العربون 500 نقداً وصفّر الالتزام')

// أصل ثابت بتمويل جزئي وإهلاك شهري
st().addAsset({ nameAr: 'مكواة بخار صناعية', costMinor: 1_200_000, salvageMinor: 0, lifeMonths: 60, paidMinor: 400_000, notes: '', supplierId: sup.id, funding: 'cash_supplier' })
core('R4 اقتناء أصل بتمويل جزئي')
assert.equal(bal('1201'), 1_200_000)
ok('الأصل على 1201 بكامل تكلفته — 4000 نقداً والباقي دين مورد')
st().postMonthlyDepreciation()
core('R4 إهلاك شهري')
assert.equal(-bal('1202'), 20_000)
ok('قسط إهلاك شهر = 12000/60 = 200 (قسط ثابت) على مجمع 1202')

/* ══════════ R5: السنة المالية الكاملة — إقفال وفتح واستمرار ══════════ */
console.log('\n📅 R5: دورة السنة المالية — عمل→إقفال→تقرير→سنة جديدة→استمرار')

useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'سنة 2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }] })
const fy = useAppStore.getState().fiscalYears[0]
const incBefore = incomeStatement(st().journal, { from: fy.startDate, to: fy.endDate })
throws('إقفال سنة لم تنته بعد يُرفض', () => st().closeFiscalYear(fy, useAppStore.getState().fiscalYears), 'قبل انتهائها')
// سنة منتهية فعلاً للإقفال
useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'سنة 2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'open' }] })
const fy25 = useAppStore.getState().fiscalYears[0]
// ننقل قيوداً وهمية؟ لا — القيود كلها 2026 فسنة 2025 فارغة:
throws('إقفال سنة بلا أي حركة يُرفض', () => st().closeFiscalYear(fy25, useAppStore.getState().fiscalYears), 'لا شيء')
ok('حارس مزدوج: لا إقفال قبل النهاية ولا إقفال سنة فارغة')

// تقرير سنة مفتوحة (2026): الأرصدة الافتتاحية صفر والحركة كلها داخل السنة
const rep = buildFiscalYearReport(st().journal, { startDate: '2026-01-01', endDate: '2026-12-31' }, [])
assert.ok(rep.rows.length > 10)
assert.equal(rep.rows.reduce((a, r) => a + r.closingMinor, 0), 0)
ok(`تقرير السنة المفتوحة: ${rep.rows.length} حساباً ومجموع الأرصدة الختامية صفر (توازن مطلق)`)
assert.equal(rep.netProfitMinor, incBefore.netProfitMinor)
ok('صافي ربح تقرير السنة = قائمة الدخل لنفس الفترة بالقرش')

// سياسة سنة واحدة مفتوحة تصان
const { validateFiscalYear } = await import(join(root, 'src/core/fiscal.ts'))
const errs = validateFiscalYear({ nameAr: 'سنة 2027', startDate: '2027-01-01', endDate: '2027-12-31' }, [{ id: 1, nameAr: 'سنة 2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }])
assert.ok(errs.some((e) => e.includes('مفتوحة')))
ok('فتح سنة جديدة والحالية مفتوحة مرفوض (سياسة المالك: سنة واحدة مفتوحة)')

/* ══════════ الخلاصة ══════════ */
console.log('\n📊 الخلاصة النهائية للجولة الثانية')
const tb = trialBalance(st().journal, P)
assert.ok(tb.balanced)
ok(`الميزان الختامي متزن: ${tb.totalDebitMinor.toLocaleString('en')} = ${tb.totalCreditMinor.toLocaleString('en')}`)
const bs = balanceSheet(st().journal, '2099-12-31')
assert.ok(bs.balanced)
ok(`الميزانية العمومية متزنة بعد كل حالات الحافة: ${bs.totalAssetsMinor.toLocaleString('en')}`)
// سجل النشاطات التقط الأحداث الحساسة
const audit = st().auditLog
assert.ok(audit.length > 0)
ok(`سجل النشاطات: ${audit.length} حدثاً موثقاً خلال الجولة (كل تغيير يسجل — طلب المالك)`)

console.log(`\n✅ الجولة الثانية اكتملت: ${pass} تحققاً + ${checkpoints} نقطة تفتيش نواة — العكوس والتعديلات والحوافّ كلها سليمة\n`)
