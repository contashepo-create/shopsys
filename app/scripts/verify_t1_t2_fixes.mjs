/**
 * فحص إصلاحي المراجعة المحاسبية T1 وT2:
 * T1 — ض.ق.م مدخلات المشتريات (للمسجلين ضريبياً):
 *   • فاتورة بضريبة مدخلات: 1103 بالتكلفة الصافية + 2102 مدين بالضريبة
 *   • مستحق المورد = بضاعة + ضريبة؛ والتكلفة (المتوسط المرجح) لا تشمل الضريبة
 *   • تقرير الضريبة: صافي المستحق = مخرجات − مدخلات
 *   • بلا الحقل (غير مسجل): السلوك القديم كما هو — الضريبة ضمن التكلفة
 *   • ضريبة سالبة تُرفض
 * T2 — المخزون الافتتاحي (بضاعة أول المدة):
 *   • نوع item_stock يقيد 1103/3101 وميزان متوازن
 *   • التعديل يرحّل قيد الفرق فقط (delta) — والصفر يصفّر بقيد معاكس
 *   • صنف غير موجود يُرفض
 * تشغيل: node --experimental-strip-types scripts/verify_t1_t2_fixes.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { vatReport } = await import('../src/core/financialReports.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const item = (over) => ({
  nameAr: 'x', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})

console.log('🧾 T1: ض.ق.م مدخلات المشتريات')
S().seed([])
S().addSupplier({ ...party('مورد مسجل ضريبياً'), creditLimitMinor: 0 })
const sup = S().suppliers.at(-1)
S().addItem(item({ nameAr: 'جهاز تابلت' }))
const tablet = S().items.at(-1)

// فاتورة: 10 أجهزة × 1,000ج = 10,000 + ض.ق.م 14% = 1,400 — آجلة بالكامل
const vat2102Before = bal('2102')
S().postPurchase({
  supplierId: sup.id, date: '2026-09-16',
  lines: [{ itemId: tablet.id, qty: 10, unitPriceMinor: 100000, expiryDate: null }],
  expenses: [], paidMinor: 0, inputVatMinor: 140000, notes: '',
})
const inv1 = S().purchases.at(-1)
const after1 = S().items.find((i) => i.id === tablet.id)
ok('1103 بالتكلفة الصافية فقط (10,000ج بلا ضريبة)', bal('1103') === 1000000, `فعلي ${bal('1103')}`)
// bal = مدين − دائن ⇒ المدين يظهر موجباً
ok('2102 مدين بضريبة المدخلات (1,400ج)', bal('2102') - vat2102Before === 140000, `فعلي ${bal('2102') - vat2102Before}`)
ok('تكلفة الوحدة بالمرجح = 1,000ج (الضريبة لا تدخل التكلفة)', after1.costMinor === 100000, `فعلي ${after1.costMinor}`)
ok('مستحق المورد = بضاعة + ضريبة (11,400ج)', inv1.supplierDueMinor === 1140000, `فعلي ${inv1.supplierDueMinor}`)
ok('2101 دائن بمستحق المورد كاملاً', bal('2101') === -1140000, `فعلي ${bal('2101')}`)
ok('الفاتورة حفظت inputVatMinor', inv1.inputVatMinor === 140000)
ok('الميزان متوازن', balanced())

// بيع 4 أجهزة بـ1,500ج + 14% مضافة ⇒ مخرجات 840
S().postSale({
  lines: [{ itemId: tablet.id, nameAr: 'جهاز تابلت', qty: 4, unitPriceMinor: 150000, unitCostMinor: 100000, discountPercent: 0 }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: false,
})
const rep = vatReport(S().journal, { from: '2026-01-01', to: '2026-12-31' })
ok('تقرير الضريبة: مخرجات 840ج', rep.outputVatMinor === 84000, `فعلي ${rep.outputVatMinor}`)
ok('تقرير الضريبة: مدخلات 1,400ج', rep.inputVatMinor === 140000, `فعلي ${rep.inputVatMinor}`)
ok('صافي الضريبة = مخرجات − مدخلات = -560ج (رصيد دائن لنا)', rep.netDueMinor === -56000, `فعلي ${rep.netDueMinor}`)

// بلا الحقل: السلوك القديم — الضريبة ضمن التكلفة (فاتورة عادية لغير المسجل)
const v2102Snapshot = bal('2102')
S().addItem(item({ nameAr: 'شاحن' }))
const charger = S().items.at(-1)
S().postPurchase({
  supplierId: sup.id, date: '2026-09-16',
  lines: [{ itemId: charger.id, qty: 5, unitPriceMinor: 11400, expiryDate: null }], // سعر شامل الضريبة
  expenses: [], paidMinor: 0, notes: '',
})
ok('بلا الحقل: 2102 لم يتحرك (الضريبة ضمن التكلفة كما كان)', bal('2102') === v2102Snapshot)
ok('بلا الحقل: تكلفة الوحدة = السعر الشامل', S().items.find((i) => i.id === charger.id).costMinor === 11400)

throws('ضريبة مدخلات سالبة تُرفض', () => S().postPurchase({
  supplierId: sup.id, date: '2026-09-16',
  lines: [{ itemId: charger.id, qty: 1, unitPriceMinor: 1000, expiryDate: null }],
  expenses: [], paidMinor: 0, inputVatMinor: -5, notes: '',
}), 'سالبة')

console.log('\n📦 T2: المخزون الافتتاحي (بضاعة أول المدة)')
// صنف قائم قبل البرنامج: رصيد 50 بتكلفة افتتاحية 200ج = 10,000ج
S().addItem(item({ nameAr: 'بضاعة قديمة', stockQty: 50, costMinor: 20000 }))
const legacy = S().items.at(-1)
const inv1103Before = bal('1103'), capBefore = bal('3101')
S().setOpeningBalance({ kind: 'item_stock', refId: legacy.id, amountMinor: 1000000, label: 'بضاعة قديمة' })
ok('1103 زاد بقيمة بضاعة أول المدة (10,000ج)', bal('1103') - inv1103Before === 1000000, `فعلي ${bal('1103') - inv1103Before}`)
ok('3101 دائن بالمقابل (المعادلة المحاسبية سليمة)', capBefore - bal('3101') === 1000000)
ok('الميزان متوازن بعد الإثبات', balanced())

// تعديل بفرق: من 10,000 إلى 12,000 ⇒ قيد فرق +2,000 فقط
S().setOpeningBalance({ kind: 'item_stock', refId: legacy.id, amountMinor: 1200000, label: 'بضاعة قديمة' })
ok('التعديل رحّل الفرق فقط (+2,000ج)', bal('1103') - inv1103Before === 1200000, `فعلي ${bal('1103') - inv1103Before}`)
// تصفير: قيد معاكس كامل
S().setOpeningBalance({ kind: 'item_stock', refId: legacy.id, amountMinor: 0, label: 'بضاعة قديمة' })
ok('التصفير عكس الرصيد كاملاً', bal('1103') - inv1103Before === 0)
ok('الميزان متوازن بعد كل التعديلات', balanced())

throws('صنف غير موجود يُرفض', () => S().setOpeningBalance({ kind: 'item_stock', refId: 99999, amountMinor: 100, label: 'شبح' }), 'الصنف غير موجود')

console.log(`\n${'═'.repeat(50)}\nالنتيجة: نجح ${pass} — فشل ${fail}`)
if (fail > 0) process.exit(1)
