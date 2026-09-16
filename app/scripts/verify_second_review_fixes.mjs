/**
 * فحص إصلاحات المراجعة الثانية الدقيقة لقسمي الكاشير والمشتريات (N1/N2):
 * N1 — تعديل فاتورة شراء عليها ض.ق.م مدخلات:
 *   • القيد المعاد بناؤه يحفظ مدين 2102 (كان يختفي بصمت قبل الإصلاح)
 *   • مستحق المورد بعد التعديل يشمل الضريبة
 * N2 — مرتجع شراء عن فاتورة بضريبة مدخلات:
 *   • نصيب البضاعة المرتجعة من الضريبة يُعكس (2102 دائن) نسبةً وتناسباً
 *   • المسترد من المورد = البضاعة + حصتها الضريبية
 *   • كشف المورد يطابق القيد، والمرتجعات المتتالية لا تعكس أكثر من ضريبة الفاتورة
 *   • فاتورة بلا ضريبة: لا سطر 2102 إطلاقاً (السلوك القديم)
 * تشغيل: node --experimental-strip-types scripts/verify_second_review_fixes.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { supplierStatement } = await import('../src/core/statements.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const item = (over) => ({
  nameAr: 'x', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})

console.log('🔷 N1: تعديل فاتورة شراء بضريبة مدخلات — الضريبة لا تختفي')
S().seed([])
S().addSupplier({ ...party('مورد ضريبي'), creditLimitMinor: 0 })
const sup = S().suppliers.at(-1)
S().addItem(item({ nameAr: 'طابعة' }))
const printer = S().items.at(-1)
// فاتورة: 10 × 1,000 = 10,000 + ضريبة 1,400 آجلة
S().postPurchase({ supplierId: sup.id, date: '2026-09-16', lines: [{ itemId: printer.id, qty: 10, unitPriceMinor: 100000, expiryDate: null }], expenses: [], paidMinor: 0, inputVatMinor: 140000, notes: '' })
const inv = S().purchases.at(-1)
ok('قبل التعديل: 2102 مدين 1,400', bal('2102') === 140000)
// تعديل: الكمية تصبح 12 (12,000 بضاعة) — الضريبة المسجلة تبقى كما هي
S().editPurchase({ purchaseId: inv.id, lines: [{ itemId: printer.id, qty: 12, unitPriceMinor: 100000 }], expenses: [], paidMinor: 0, treasury: '1101', reason: 'زيادة كمية', einvoiceActive: false })
const inv2 = S().purchases.find((p) => p.id === inv.id)
ok('بعد التعديل: 2102 ما زال مديناً 1,400 (عُكس وأُعيد بناؤه)', bal('2102') === 140000, `فعلي ${bal('2102')}`)
ok('1103 = 12,000 (البضاعة الجديدة بلا ضريبة)', bal('1103') === 1200000, `فعلي ${bal('1103')}`)
ok('مستحق المورد = 12,000 + 1,400', inv2.supplierDueMinor === 1340000, `فعلي ${inv2.supplierDueMinor}`)
ok('2101 دائن بالمستحق كاملاً', bal('2101') === -1340000, `فعلي ${bal('2101')}`)
ok('حقل inputVatMinor محفوظ على الفاتورة', inv2.inputVatMinor === 140000)
ok('الميزان متوازن', balanced())

console.log('\n🔷 N2: مرتجع شراء يعكس نصيبه من ضريبة المدخلات')
// مرتجع 3 من 12 على الحساب ⇒ بضاعة 3,000 + حصة ضريبة 1,400×3000/12000 = 350
const vatBefore = bal('2102'), apBefore = bal('2101'), invBefore = bal('1103')
const ret1 = S().postPurchaseReturn({ purchaseId: inv.id, qtyByItem: new Map([[printer.id, 3]]), refund: 'debt', reason: 'زيادة عن الحاجة' })
ok('2102 عُكس بنصيب المرتجع (350 دائن)', vatBefore - bal('2102') === 35000, `فعلي ${vatBefore - bal('2102')}`)
ok('1103 انخفض بقيمة البضاعة فقط (3,000)', invBefore - bal('1103') === 300000, `فعلي ${invBefore - bal('1103')}`)
ok('دين المورد انخفض بالبضاعة + الضريبة (3,350)', bal('2101') - apBefore === 335000, `فعلي ${bal('2101') - apBefore}`)
ok('المستند حفظ الحصة (inputVatShareMinor=350)', ret1.inputVatShareMinor === 35000)
ok('الميزان متوازن', balanced())

// كشف المورد: فاتورة 13,400 دائن − مرتجع 3,350 مدين = 10,050
const stmt = supplierStatement({ supplierId: sup.id, purchases: S().purchases, purchaseReturns: S().purchaseReturns, allPurchases: S().purchases, vouchers: [], cheques: [] })
const lastBal = stmt.at(-1)?.balanceMinor ?? 0
ok('كشف المورد = 10,050 (يطابق رصيد 2101)', lastBal === 1005000 && -bal('2101') === 1005000, `كشف ${lastBal} / دفتر ${-bal('2101')}`)

// مرتجع ثانٍ 9 (كل الباقي): الحصة = min(1400×9000/12000=1050، المتبقي 1400−350=1050) ⇒ كل الضريبة عادت صفراً
const ret2 = S().postPurchaseReturn({ purchaseId: inv.id, qtyByItem: new Map([[printer.id, 9]]), refund: 'debt', reason: 'إلغاء' })
ok('المرتجع الثاني عكس بقية الضريبة (1,050)', ret2.inputVatShareMinor === 105000, `فعلي ${ret2.inputVatShareMinor}`)
ok('2102 عاد صفراً — لا خصم مدخلات عن بضاعة مردودة', bal('2102') === 0, `فعلي ${bal('2102')}`)
ok('2101 عاد صفراً — الفاتورة أُلغيت بالكامل', bal('2101') === 0, `فعلي ${bal('2101')}`)
ok('الميزان متوازن بعد الإلغاء الكامل', balanced())

// فاتورة بلا ضريبة: مرتجعها بلا سطر 2102 (السلوك القديم سليم)
S().addItem(item({ nameAr: 'حبر' }))
const ink = S().items.at(-1)
S().postPurchase({ supplierId: sup.id, date: '2026-09-16', lines: [{ itemId: ink.id, qty: 5, unitPriceMinor: 10000, expiryDate: null }], expenses: [], paidMinor: 50000, notes: '' })
const noVatInv = S().purchases.at(-1)
const journalLen = S().journal.length
const ret3 = S().postPurchaseReturn({ purchaseId: noVatInv.id, qtyByItem: new Map([[ink.id, 2]]), refund: 'cash', treasury: '1101', reason: 'تالف' })
const retEntry = S().journal[journalLen]
ok('فاتورة بلا ضريبة: قيد المرتجع بلا سطر 2102', !retEntry.lines.some((l) => l.accountCode === '2102'))
ok('وحصتها الضريبية صفر', (ret3.inputVatShareMinor ?? 0) === 0)
ok('الميزان متوازن ختاماً', balanced())

console.log(`\n${'═'.repeat(50)}\nالنتيجة: نجح ${pass} — فشل ${fail}`)
if (fail > 0) process.exit(1)
