/**
 * تحقق سد فجوة تقرير النشاط #19 (صالون حلاقة وتجميل — دفعة ب):
 * ① عمولة الموظف المنفّذ للخدمة على الكاشير السريع — أهم ميزة متفق عليها
 *    بإجماع كامل في كل برامج الصالونات العالمية (Fresha/Booksy/Vagaro/
 *    GlossGenius/Zenoti/Mindbody — راجع البحث): "Automatically calculate
 *    commissions from every service and product sold" عند الدفع مباشرة.
 *    كانت موجودة فعلياً كمحرك خلفي (staffCommission في postSale) ومُستخدَمة
 *    فقط من شاشة الفاتورة المتقدمة (AdvancedSalesInvoicePage) — غائبة
 *    تماماً عن شاشة الكاشير السريعة (PosPage) التي يستخدمها الصالون يومياً
 *    لكل عميل عابر (قص شعر/صبغة) بلا فاتورة متقدمة.
 * ② الإصلاح: نسبة عمولة افتراضية اختيارية على الموظف (Employee.
 *    defaultCommissionPercent) تُملأ تلقائياً عند اختياره في الكاشير، وتُحسب
 *    على صافي الفاتورة قبل الضريبة (نفس basis='net' المستخدم في الفاتورة
 *    المتقدمة لثبات المعيار) عبر الدالة الخالصة الموجودة أصلاً
 *    calculateInvoiceCommissionMinor — فتُستحق تلقائياً (5117/2116) مع
 *    ترحيل البيع.
 * تشغيل: node --experimental-strip-types scripts/verify_salon_phase_b.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis

const { useDataStore } = await import('../src/data/repo.ts')
const { calculateInvoiceCommissionMinor } = await import('../src/core/invoiceCommissions.ts')
const { getActivity } = await import('../src/core/activities.ts')

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }
const throwsErr = (fn, msg) => { try { fn(); FAIL++; console.log(`  ✗ ${msg} (لم يرمِ خطأ)`) } catch { PASS++; console.log(`  ✓ ${msg}`) } }

console.log('— ① بطاقة النشاط: صالون من فصيلة أنشطة الحجز وله موظفون نشطون —')
const salon = getActivity('salon')
ok(!!salon && salon.modules.includes('booking'), 'نشاط الصالون يملك وحدة booking — بوابة إظهار عمولة الكاشير')
ok(!!salon && salon.description.includes('عمولات'), 'العمولات مذكورة صراحة في وصف النشاط نفسه — ليست ميزة مفترضة')

console.log('— ② calculateInvoiceCommissionMinor (الدالة الخالصة المُعاد استخدامها) —')
ok(calculateInvoiceCommissionMinor({ basis: 'net', value: 10, grossMinor: 10000, netMinor: 10000, profitMinor: 6000 }) === 1000, '10٪ من صافي 10000 = 1000')
ok(calculateInvoiceCommissionMinor({ basis: 'net', value: 0, grossMinor: 10000, netMinor: 10000, profitMinor: 6000 }) === 0, 'نسبة صفر = عمولة صفر')

mem.clear()
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'salon', vatPercent: 14, taxInclusive: false, allowNegativeTreasury: false }, license: { plan: 'pro' } }, version: 0 }))
const S = () => useDataStore.getState()
S().seed([])
S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 500000, label: 'خزينة' })
const haircut = (() => {
  S().addItem({ nameAr: 'قص شعر رجالي', sku: 'SVC-1', barcodes: [], categoryId: 1, baseUnit: 'خدمة', extraUnits: [], costMinor: 0, priceMinor: 10000, minQty: 0, stockQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, isService: true })
  return S().items.at(-1)
})()
S().addEmployee({ nameAr: 'كريم الحلاق', phone: '01000000000', jobTitle: 'حلاق', hireDate: '2026-01-01', baseSalaryMinor: 500000, allowancesMinor: 0, active: true, notes: '', defaultCommissionPercent: 20 })
const stylist = S().employees.at(-1)

console.log('— ③ Employee.defaultCommissionPercent يُحفظ ويُسترجع —')
ok(stylist.defaultCommissionPercent === 20, 'نسبة العمولة الافتراضية 20٪ محفوظة على سجل الموظف')
S().updateEmployee(stylist.id, { defaultCommissionPercent: null })
ok(S().employees.find((e) => e.id === stylist.id).defaultCommissionPercent == null, 'يمكن إزالة النسبة الافتراضية (موظف بلا عمولة تلقائية)')
S().updateEmployee(stylist.id, { defaultCommissionPercent: 20 })

console.log('— ④ postSale مع staffCommission (نفس استدعاء الكاشير الجديد) يستحق عمولة صحيحة —')
const beforeCount = S().staffCommissions.length
const commissionMinor = calculateInvoiceCommissionMinor({ basis: 'net', value: 20, grossMinor: 10000, netMinor: 10000, profitMinor: 10000 })
ok(commissionMinor === 2000, '20٪ من صافي خدمة 100ج = 20ج (2000 هللة)')
const sale = S().postSale({
  lines: [{ itemId: haircut.id, nameAr: haircut.nameAr, qty: 1, unitPriceMinor: 10000, unitCostMinor: 0, discountPercent: 0 }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101',
  staffCommission: { employeeId: stylist.id, amountMinor: commissionMinor },
})
ok(S().staffCommissions.length === beforeCount + 1, 'عمولة جديدة أُنشئت فعلياً مع ترحيل الفاتورة')
const commission = S().staffCommissions.at(-1)
ok(commission.employeeId === stylist.id, 'العمولة مسندة للحلاق الصحيح')
ok(commission.amountMinor === 2000, 'قيمة العمولة 2000 هللة (20٪ من 100ج) مطابقة')
ok(commission.source === 'sale' && commission.sourceId === sale.id, 'العمولة مربوطة بفاتورة البيع كمصدرها')
ok(commission.status === 'accrued', 'حالة العمولة: مستحقة فور الترحيل')

console.log('— ⑤ القيد المحاسبي متوازن وصحيح الحسابات (5117 مدين / 2116 دائن) —')
const commissionEntry = S().journal.find((e) => e.sourceType === 'staff_commission' && e.sourceId === commission.id)
ok(!!commissionEntry, 'قيد استحقاق العمولة موجود')
const debit5117 = commissionEntry.lines.filter((l) => l.accountCode === '5117').reduce((a, l) => a + l.debit, 0)
const credit2116 = commissionEntry.lines.filter((l) => l.accountCode === '2116').reduce((a, l) => a + l.credit, 0)
ok(debit5117 === 2000 && credit2116 === 2000, 'مصروف عمولات 5117 مدين = مستحق 2116 دائن = 2000 بالضبط')
ok(commissionEntry.lines.reduce((a, l) => a + l.debit, 0) === commissionEntry.lines.reduce((a, l) => a + l.credit, 0), 'القيد متوازن (مدين = دائن)')

console.log('— ⑥ بيع بلا عمولة (موظف غير مختار) لا يُنشئ أي عمولة — لا سلوك مفروض —')
const beforeCount2 = S().staffCommissions.length
S().postSale({
  lines: [{ itemId: haircut.id, nameAr: haircut.nameAr, qty: 1, unitPriceMinor: 10000, unitCostMinor: 0, discountPercent: 0 }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101',
})
ok(S().staffCommissions.length === beforeCount2, 'فاتورة بلا موظف مختار لا تنشئ أي عمولة')

console.log('— ⑦ حُرّاس: موظف غير نشط أو غير موجود يُرفض صراحة —')
S().updateEmployee(stylist.id, { active: false })
throwsErr(() => S().postSale({
  lines: [{ itemId: haircut.id, nameAr: haircut.nameAr, qty: 1, unitPriceMinor: 10000, unitCostMinor: 0, discountPercent: 0 }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101',
  staffCommission: { employeeId: stylist.id, amountMinor: 1000 },
}), 'يرفض عمولة لموظف غير نشط')
throwsErr(() => S().postSale({
  lines: [{ itemId: haircut.id, nameAr: haircut.nameAr, qty: 1, unitPriceMinor: 10000, unitCostMinor: 0, discountPercent: 0 }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false, treasury: '1101',
  staffCommission: { employeeId: 999999, amountMinor: 1000 },
}), 'يرفض عمولة لموظف غير موجود')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) { console.error('❌ فشل تحقق دفعة ب — صالون حلاقة وتجميل'); process.exit(1) }
console.log('🎉 نجح تحقق سد فجوة عمولة الموظف على الكاشير السريع — نشاط الصالون (دفعة ب)')
