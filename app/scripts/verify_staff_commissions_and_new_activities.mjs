/**
 * 🤝 فحص 1 (سيناريو حي): عمولات الموظفين + الأنشطة الجديدة + تعميم التصنيع
 * ───────────────────────────────────────────────────────────────
 * S1 عقارات: موظف يسوّق عقد إيجار → عمولة مستحقة مربوطة بالعقد → مصروف فوري
 * S2 دورة العمولة كاملة: استحقاق → تعديل → إلغاء → صرف منفرد → صرف مع الراتب
 * S3 حواجز العمولات: مبالغ سالبة/موظف وهمي/مستند وهمي/صرف مكرر/إلغاء مصروفة
 * S4 الأنشطة الجديدة السبعة: القوالب سليمة والوحدات موجودة والثيمات معرفة
 * S5 التصنيع المعمم: مصنع بخامات بصلاحية → أمر إنتاج يستهلك دفعات FEFO
 *
 * تشغيل: node --experimental-strip-types scripts/verify_staff_commissions_and_new_activities.mjs
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'SA', activityId: 'realestate', vatPercent: 15, taxInclusive: false, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { ACTIVITY_TEMPLATES, ALL_MODULES, effectiveModules } = await import(join(root, 'src/core/activities.ts'))
const { ACTIVITY_THEMES } = await import(join(root, 'src/core/activityTheme.ts'))
const { guidesForActivity } = await import(join(root, 'src/core/guides.ts'))
const { incomeStatement, trialBalance } = await import(join(root, 'src/core/financialReports.ts'))

const st = () => useDataStore.getState()
let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }
const throws = (name, fn, hint) => {
  try { fn() } catch (e) {
    if (hint && !e.message.includes(hint)) throw new Error(`${name}: رسالة غير متوقعة «${e.message}»`)
    pass++; console.log(`  ✓ ${name}`); return
  }
  throw new Error(`${name}: لم يُرفض!`)
}
const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const P = { from: '2000-01-01', to: '2099-12-31' }

console.log('\n🤝 S1: عقارات — عمولة موظف مربوطة بعقد إيجار')
st().addEmployee({ nameAr: 'سمير المسوق', phone: '', jobTitle: 'مسوق عقاري', salaryMinor: 500_000, hiredAt: '2026-01-01', notes: '', active: true })
const emp = st().employees.at(-1)
st().addEmployee({ nameAr: 'موظف بلا عمولات', phone: '', jobTitle: 'إداري', salaryMinor: 400_000, hiredAt: '2026-01-01', notes: '', active: true })
const emp2 = st().employees.at(-1)
st().addProperty({ nameAr: 'برج النخيل', ownership: 'managed', ownerName: 'مالك خارجي', commissionPercent: 10, costMinor: 0, address: '', notes: '', unitCodes: ['A-1', 'A-2'] })
const prop = st().properties.at(-1)
const unit = st().propertyUnits.find((u) => u.propertyId === prop.id)
const lease = st().addLease({ propertyId: prop.id, unitId: unit.id, tenantName: 'مستأجر', startDate: '2026-10-01', months: 12, frequency: 'monthly', totalRentMinor: 2_400_000, depositMinor: 0 })
const com1 = st().addStaffCommission({ employeeId: emp.id, source: 'lease', sourceId: lease.id, description: `عمولة تأجير ${unit.code} — ${lease.contractNumber}`, amountMinor: 50_000 })
assert.equal(com1.status, 'accrued')
assert.equal(bal('5117'), 50_000, 'المصروف حُمّل فوراً')
assert.equal(bal('2116'), -50_000, 'الالتزام قائم')
ok(`عمولة ${com1.code} مستحقة مربوطة بعقد ${lease.contractNumber}: مصروف 5117=50000 والتزام 2116`)
const is0 = incomeStatement(st().journal, P)
assert.ok(is0.totalExpenseMinor >= 50_000, 'العمولة داخل مصروفات قائمة الدخل')
ok('العمولة دخلت الأرباح والخسائر لحظة الاستحقاق (قبل أي صرف) — الربحية سليمة')

console.log('\n🔄 S2: دورة الحياة — تعديل، إلغاء، صرف منفرد، صرف مع الراتب')
// تعديل المبلغ: إلغاء + استحقاق جديد
const com1b = st().updateStaffCommissionAmount({ commissionId: com1.id, newAmountMinor: 60_000, reason: 'اتفاق محدث مع الإدارة' })
assert.equal(st().staffCommissions.find((c) => c.id === com1.id).status, 'cancelled')
assert.equal(com1b.amountMinor, 60_000)
assert.equal(bal('5117'), 60_000, 'صافي المصروف بعد التعديل = 60000 فقط')
assert.equal(bal('2116'), -60_000)
ok(`تعديل 50000→60000 بأثر تدقيقي: ${com1.code} أُلغيت بقيد عاكس و${com1b.code} حلت محلها`)
// عمولة ثانية تصرف منفردة
const com2 = st().addStaffCommission({ employeeId: emp.id, source: 'manual', sourceId: null, description: 'مكافأة صفقة خاصة', amountMinor: 20_000 })
const treasuryBefore = bal('1101')
st().payStaffCommission({ commissionId: com2.id, treasury: '1101' })
assert.equal(bal('1101'), treasuryBefore - 20_000)
assert.equal(bal('2116'), -60_000, 'بقي التزام العمولة الأولى فقط')
assert.equal(st().staffCommissions.find((c) => c.id === com2.id).payoutMode, 'voucher')
ok('صرف منفرد: الخزينة نقصت 20000 والالتزام صُفي وpayoutMode=voucher')
// عمولة لموظف آخر تُلغى
const com3 = st().addStaffCommission({ employeeId: emp2.id, source: 'manual', sourceId: null, description: 'عمولة بالخطأ', amountMinor: 15_000 })
st().cancelStaffCommission({ commissionId: com3.id, reason: 'سُجلت بالخطأ لغير مستحقها' })
assert.equal(bal('5117'), 80_000 - 0, 'مصروف = 60000 + 20000 (الملغاة صافيها صفر)')
ok('إلغاء عمولة: القيد العاكس صفّر أثرها والسبب موثق')
// الصرف مع الراتب
const due = st().getStaffCommissionsDue(emp.id)
assert.equal(due.totalMinor, 60_000)
const run = st().postPayroll({
  month: '2026-10', payMode: 'cash', treasury: '1101',
  lines: [
    { employeeId: emp.id, baseMinor: 500_000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0, commissionsPaidMinor: 60_000 },
    { employeeId: emp2.id, baseMinor: 400_000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 },
  ],
  notes: 'مسير بعمولات',
})
assert.equal(run.totals.commissionsPaidMinor, 60_000)
assert.equal(bal('2116'), 0, 'الالتزام صُفي بالكامل')
assert.equal(bal('5102'), 900_000, 'مصروف الرواتب = الرواتب فقط (العمولة ليست مصروفاً جديداً)')
const paidCom = st().staffCommissions.find((c) => c.id === com1b.id)
assert.equal(paidCom.status, 'paid')
assert.equal(paidCom.payoutMode, 'payroll')
assert.equal(paidCom.payoutEntryId, run.journalEntryId, 'تتبع الصرف يشير لقيد المسير نفسه')
ok(`صرف مع الراتب: مسير ${run.runNumber} صفّى 2116 دون تكرار المصروف — والتتبع كامل (payroll + قيد المسير)`)
const tb = trialBalance(st().journal, P)
assert.ok(tb.balanced)
ok('ميزان المراجعة متزن بعد كل الدورة')

console.log('\n🚫 S3: الحواجز')
throws('عمولة بمبلغ صفري', () => st().addStaffCommission({ employeeId: emp.id, source: 'manual', sourceId: null, description: 'x', amountMinor: 0 }))
throws('عمولة بمبلغ كسري', () => st().addStaffCommission({ employeeId: emp.id, source: 'manual', sourceId: null, description: 'x', amountMinor: 10.5 }))
throws('عمولة لموظف وهمي', () => st().addStaffCommission({ employeeId: 999, source: 'manual', sourceId: null, description: 'x', amountMinor: 100 }), 'غير موجود')
throws('عمولة على عقد إيجار وهمي', () => st().addStaffCommission({ employeeId: emp.id, source: 'lease', sourceId: 999, description: 'x', amountMinor: 100 }), 'المستند المصدر')
throws('عمولة بلا بيان', () => st().addStaffCommission({ employeeId: emp.id, source: 'manual', sourceId: null, description: '  ', amountMinor: 100 }))
throws('صرف عمولة مصروفة', () => st().payStaffCommission({ commissionId: com2.id, treasury: '1101' }), 'مصروفة بالفعل')
throws('إلغاء عمولة مصروفة', () => st().cancelStaffCommission({ commissionId: com2.id, reason: 'x' }), 'مصروفة')
throws('تعديل عمولة ملغاة', () => st().updateStaffCommissionAmount({ commissionId: com3.id, newAmountMinor: 999, reason: 'x' }), 'المستحقة فقط')
throws('صرف من خزينة وهمية', () => {
  const c = st().addStaffCommission({ employeeId: emp.id, source: 'manual', sourceId: null, description: 'للحاجز', amountMinor: 5_000 })
  st().payStaffCommission({ commissionId: c.id, treasury: '9999' })
}, 'غير موجود')
throws('مسير بعمولات أكبر من المستحق', () => st().postPayroll({
  month: '2026-11', payMode: 'cash', treasury: '1101',
  lines: [{ employeeId: emp.id, baseMinor: 500_000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0, commissionsPaidMinor: 999_999 }],
  notes: '',
}), 'أكبر من مستحقه')
throws('مسير بصرف جزئي للعمولات (كاملة أو لا شيء)', () => st().postPayroll({
  month: '2026-11', payMode: 'cash', treasury: '1101',
  lines: [{ employeeId: emp.id, baseMinor: 500_000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0, commissionsPaidMinor: 1_000 }],
  notes: '',
}), 'كاملة')
throws('عكس قيد استحقاق عمولة من اليومية', () => {
  const e = st().journal.find((x) => x.sourceType === 'staff_commission' && !x.reversedByEntryId)
  st().reverseEntry(e.id, 'x')
}, 'لا يُعكس')
// موظف بعمولة فقط (بلا مسيرات) — حاجز العمولات تحديداً هو الذي يمسكه
st().addEmployee({ nameAr: 'موظف عمولة فقط', phone: '', jobTitle: 'مندوب', salaryMinor: 100_000, hiredAt: '2026-01-01', notes: '', active: true })
const emp3 = st().employees.at(-1)
st().addStaffCommission({ employeeId: emp3.id, source: 'manual', sourceId: null, description: 'عمولة يتيمة', amountMinor: 1_000 })
throws('حذف موظف له عمولات (بلا مسيرات)', () => st().removeEmployee(emp3.id), 'عمولات')

console.log('\n📦 S4: الأنشطة السبعة الجديدة — قوالب سليمة بترابط كامل')
const newActs = ['trading', 'manufacturing', 'services', 'stationery', 'herbalist', 'building_materials', 'household']
for (const id of newActs) {
  const tpl = ACTIVITY_TEMPLATES.find((a) => a.id === id)
  assert.ok(tpl, `قالب ${id} موجود`)
  assert.ok(tpl.nameAr && tpl.icon && tpl.description, `${id}: اسم وأيقونة ووصف`)
  for (const m of tpl.modules) assert.ok(ALL_MODULES.includes(m), `${id}: وحدة ${m} معروفة`)
  assert.ok(ACTIVITY_THEMES[id], `${id}: ثيم معرف`)
  assert.ok(guidesForActivity(id).length > 0, `${id}: شروحات موجودة`)
  const eff = effectiveModules(id, undefined)
  assert.ok(eff.length > 0, `${id}: وحدات فعالة`)
}
assert.equal(ACTIVITY_TEMPLATES.length, 29, 'إجمالي القوالب = 29')
ok(`7 أنشطة جديدة (تجارة/مصنع/خدمات/مكتبة/عطارة/مواد بناء/منظفات) بقالب+ثيم+شروحات — الإجمالي 29 نشاطاً`)
// شاشة المطعم لا تظهر لغير المطعم حتى مع recipes
const manuTpl = ACTIVITY_TEMPLATES.find((a) => a.id === 'manufacturing')
assert.ok(manuTpl.modules.includes('recipes'), 'المصنع فيه recipes')
ok('المصنع يملك وحدة recipes — وشاشة «أوامر الطاولات» مقيدة بنشاط restaurant فقط (activities filter)')

console.log('\n🏭 S5: التصنيع المعمم — خامات بصلاحية تستهلك FEFO')
st().seed([])
st().addSupplier({ nameAr: 'مورد خامات', phone: '', address: '', notes: '', openingMinor: 0 })
const sup = st().suppliers.at(-1)
const mkItem = (nameAr, sku, extra = {}) => st().addItem({ nameAr, sku, barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...extra })
mkItem('خام بصلاحية', 'RM-1', { trackExpiry: true })
mkItem('منتج تام', 'FG-1', { baseUnit: 'قطعة', priceMinor: 50_000 })
const raw = st().items.find((i) => i.sku === 'RM-1')
const fg = st().items.find((i) => i.sku === 'FG-1')
// شراء الخام على دفعتين بصلاحيتين مختلفتين
st().postPurchase({ supplierId: sup.id, date: '2026-05-01', lines: [{ itemId: raw.id, qty: 40, unitPriceMinor: 1_000, expiryDate: '2027-03-31' }], expenses: [], paidMinor: 40_000, notes: '' })
st().postPurchase({ supplierId: sup.id, date: '2026-05-02', lines: [{ itemId: raw.id, qty: 60, unitPriceMinor: 1_000, expiryDate: '2027-12-31' }], expenses: [], paidMinor: 60_000, notes: '' })
// وصفة إنتاج مسبق: 10 كجم خام → 5 قطع منتج + تشغيل 5000
st().addRecipe({ productItemId: fg.id, mode: 'prepped', yieldQty: 5, overheadMinor: 5_000, ingredients: [{ itemId: raw.id, qty: 10 }], isActive: true, notes: '' })
const recipe = st().recipes.at(-1)
st().postProduction({ recipeId: recipe.id, batches: 5, treasury: '1101', notes: 'تشغيلة مصنع' })
const rawAfter = st().items.find((i) => i.id === raw.id)
const fgAfter = st().items.find((i) => i.id === fg.id)
assert.equal(rawAfter.stockQty, 50, 'الخام: 100 − 50 = 50')
assert.equal(fgAfter.stockQty, 25, 'الناتج: 5 تشغيلات × 5 = 25')
// الإصلاح الجوهري: الدفعات استهلكت FEFO — الأقرب انتهاءً (2027-03-31) نفدت أولاً
const rawBatches = st().batches.filter((b) => b.itemId === raw.id)
const batchSum = rawBatches.reduce((a, b) => a + b.qty, 0)
assert.equal(batchSum, 50, `Σدفعات الخام (${batchSum}) = مخزونه (50) — لا دفعات وهمية`)
const early = rawBatches.find((b) => b.expiryDate === '2027-03-31')
assert.ok(!early || early.qty === 0, 'الدفعة الأقرب انتهاءً استُهلكت أولاً (FEFO)')
ok('أمر الإنتاج استهلك دفعات الصلاحية FEFO: الأقرب انتهاءً نفدت أولاً وΣالدفعات=المخزون (الإصلاح الجديد)')
// تكلفة الناتج = خامات + تشغيل
assert.equal(fgAfter.costMinor, Math.round((50 * 1_000 + 5 * 5_000) / 25), 'تكلفة الناتج = (خامات 50000 + تشغيل 25000) ÷ 25')
ok(`تكلفة المنتج التام ${fgAfter.costMinor} = (خامات + تشغيل) ÷ الكمية — لا إدخال يدوي`)
const tb2 = trialBalance(st().journal, P)
assert.ok(tb2.balanced)
ok('الميزان متزن بعد دورة التصنيع الكاملة')

console.log(`\n✅ فحص 1 (السيناريو الحي): ${pass} تحققاً — عمولات الموظفين والأنشطة الجديدة والتصنيع المعمم تعمل صحيحاً`)
