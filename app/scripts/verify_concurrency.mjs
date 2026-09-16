/**
 * تحقق التزامن وسلامة التسلسلات (البند 4):
 * ① قفل الكاتب الواحد بين التبويبات (نبضة/استيلاء على قفل ميت/قراءة فقط).
 * ② كشف تكرار أرقام المستندات وخطة إعادة الترقيم (الأقدم يحتفظ برقمه).
 * ③ الحسم الزمني الحتمي بين نسختين أوفلاين.
 * ④ فحص حي: مستندات المخزن الحقيقي كلها بأرقام فريدة بعد عمليات متتابعة.
 * تشغيل: node --experimental-strip-types scripts/verify_concurrency.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))

import {
  decideTabLock, parseTabLock, TAB_LOCK_STALE_MS,
  findDuplicateNumbers, planRenumbering, applyRenumbering, resolveByTimestamp,
} from '../src/core/concurrency.ts'

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }

console.log('— ① قفل الكاتب الواحد —')
const now = 1_000_000
ok(decideTabLock(null, 'A', now).kind === 'acquired', 'لا قفل = أول تبويب يكتب')
ok(decideTabLock({ tabId: 'A', heartbeatAt: now - 1000 }, 'A', now).kind === 'acquired', 'قفلي أنا = أستمر')
ok(decideTabLock({ tabId: 'A', heartbeatAt: now - 1000 }, 'B', now).kind === 'read_only', 'تبويب آخر حي = قراءة فقط')
ok(decideTabLock({ tabId: 'A', heartbeatAt: now - TAB_LOCK_STALE_MS - 1 }, 'B', now).kind === 'takeover', 'قفل ميت (تبويب انهار) = استيلاء آمن')
ok(parseTabLock('{"tabId":"A","heartbeatAt":5}')?.tabId === 'A', 'قراءة سجل سليم')
ok(parseTabLock('نص تالف') === null && parseTabLock(null) === null, 'سجل تالف/غائب = null (لا انهيار)')

console.log('— ② كشف التكرار وإعادة الترقيم —')
const docs = [
  { id: 1, number: 'S-0001', createdAt: '2026-09-01T10:00' },
  { id: 2, number: 'S-0002', createdAt: '2026-09-01T11:00' },
  { id: 3, number: 'S-0002', createdAt: '2026-09-01T12:00' }, // مكرر أوفلاين
  { id: 4, number: 'S-0003', createdAt: '2026-09-01T13:00' },
  { id: 5, number: 'S-0002', createdAt: '2026-09-01T11:30' }, // مكرر ثانٍ
]
const groups = findDuplicateNumbers(docs)
ok(groups.length === 1 && groups[0].number === 'S-0002', 'اكتُشف الرقم المكرر')
ok(groups[0].docs.map((d) => d.id).join(',') === '2,5,3', 'الترتيب زمني: الأقدم أولاً')
const plan = planRenumbering(docs, 'S')
ok(plan.length === 2, 'مستندان يُرقَّمان (الأقدم يحتفظ)')
ok(plan[0].docId === 5 && plan[0].newNumber === 'S-0004', 'الأوسط زمنياً يأخذ S-0004 (بعد أكبر مستخدم 0003)')
ok(plan[1].docId === 3 && plan[1].newNumber === 'S-0005', 'الأحدث يأخذ S-0005')
const fixed = applyRenumbering(docs, plan, (d, n) => ({ ...d, number: n }))
ok(findDuplicateNumbers(fixed).length === 0, 'بعد التطبيق: لا تكرار')
ok(fixed.length === docs.length, 'لا حذف أي مستند (لا ضياع بيانات)')
ok(planRenumbering([{ id: 1, number: 'S-0001', createdAt: 'x' }], 'S').length === 0, 'لا تكرار = لا خطة')

console.log('— ③ الحسم الزمني الحتمي —')
const va = { updatedAt: '2026-09-01T10:00', deviceId: 'DEV-B', v: 'قديم' }
const vb = { updatedAt: '2026-09-01T11:00', deviceId: 'DEV-A', v: 'جديد' }
ok(resolveByTimestamp(va, vb).v === 'جديد', 'الأحدث زمنياً يفوز')
ok(resolveByTimestamp(vb, va).v === 'جديد', 'الترتيب لا يهم (تبادلية)')
const t1 = { updatedAt: '2026-09-01T10:00', deviceId: 'DEV-B', v: 'ب' }
const t2 = { updatedAt: '2026-09-01T10:00', deviceId: 'DEV-A', v: 'أ' }
ok(resolveByTimestamp(t1, t2).v === 'أ' && resolveByTimestamp(t2, t1).v === 'أ', 'تعادل زمني = الجهاز الأصغر معرفاً (حتمية كاملة)')

console.log('— ④ فحص حي: تفرد أرقام المستندات الحقيقية —')
const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()
S().seed([])
const cat = S().categories.at(-1).id
S().addItem({ nameAr: 'ص', sku: '', barcodes: [], categoryId: cat, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
const it = S().items.at(-1)
S().addSupplier({ nameAr: 'مورد', phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const sup = S().suppliers.at(-1)
S().postPurchase({ supplierId: sup.id, date: '2026-09-01', lines: [{ itemId: it.id, qty: 100, unitPriceMinor: 500, expiryDate: null }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
for (let i = 0; i < 5; i++) {
  S().postSale({ lines: [{ itemId: it.id, nameAr: 'ص', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101' })
  S().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5102', amountMinor: 100, description: `مصروف ${i}` })
}
const saleDocs = S().sales.map((x) => ({ id: x.id, number: x.invoiceNumber, createdAt: x.createdAt ?? '' }))
const voucherDocs = S().vouchers.map((x) => ({ id: x.id, number: x.voucherNumber, createdAt: x.createdAt ?? '' }))
const entryNums = S().journal.map((e) => e.entryNumber)
ok(findDuplicateNumbers(saleDocs).length === 0, `فواتير البيع فريدة (${saleDocs.length})`)
ok(findDuplicateNumbers(voucherDocs).length === 0, `السندات فريدة (${voucherDocs.length})`)
ok(new Set(entryNums).size === entryNums.length, `أرقام القيود فريدة (${entryNums.length})`)

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
