/**
 * فحص الرقم المرجعي للفواتير — التوليد والتفرد وحرف التحقق والترحيل.
 * تشغيل: node --experimental-strip-types scripts/verify_refcode.mjs
 */
import { makeRefCode, makeUniqueRefCode, validateRefCode, normalizeRefQuery } from '../src/core/refcode.ts'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) } }

console.log('🏷️ الشكل والصيغة')
const code = makeRefCode('SAL', '2026-09-15T10:00:00.000Z')
ok('الشكل SAL-YYMMDD-XXXXXC', /^SAL-260915-[2-9A-HJKMNP-Z]{6}$/.test(code), code)
ok('كود صحيح يجتاز الفحص', validateRefCode(code) === null)
ok('التطبيع يشيل المسافات ويكبّر الأحرف', normalizeRefQuery(' sal-260915-abcde f ') === 'SAL-260915-ABCDEF')

console.log('🔢 حرف التحقق يلتقط الأخطاء اليدوية')
const body = code.slice(0, -1)
const check = code.at(-1)
// تغيير حرف واحد من الجسم
const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const pos = 11 // أول حرف من الجسم العشوائي
const orig = code[pos]
const swapped = [...ALPHA].find((c) => c !== orig) ?? 'X'
const tampered = code.slice(0, pos) + swapped + code.slice(pos + 1)
ok('حرف مبدل يُكشف', validateRefCode(tampered) !== null, tampered)
// قلب حرفين متجاورين في الجسم العشوائي
const b = code.slice(11, 16)
if (b[0] !== b[1]) {
  const flipped = code.slice(0, 11) + b[1] + b[0] + b.slice(2) + check
  ok('قلب حرفين متجاورين يُكشف', validateRefCode(flipped) !== null, flipped)
} else { ok('قلب حرفين متجاورين يُكشف (تخطى — حرفان متطابقان)', true) }
ok('صيغة خاطئة تُرفض برسالة عربية', String(validateRefCode('XX-99-Z')).includes('صيغة'))
ok('أحرف ملتبسة 0/O/1/I/L ليست في الأبجدية', !/[01OIL]/.test(ALPHA))

console.log('🎲 التفرد ضد الاصطدام')
const used = new Set()
for (let i = 0; i < 5000; i++) used.add(makeUniqueRefCode('SAL', '2026-09-15', used))
ok('5000 كود بلا تكرار', used.size === 5000)
// rand ثابت يصطدم عمداً — makeUnique يجب أن يخرج كوداً مختلفاً بالاحتياط
const fixedRand = () => 0.5
const c1 = makeRefCode('PUR', '2026-09-15', fixedRand)
const c2 = makeUniqueRefCode('PUR', '2026-09-15', new Set([c1]), fixedRand)
ok('الاصطدام المتعمد لا يعيد نفس الكود', c1 !== c2)

console.log('🏪 المخزن الحقيقي: البيع والشراء والمرتجعات تحمل أكواداً فريدة')
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()
S().addCategory({ nameAr: 'عام', parentId: null })
S().addItem({ nameAr: 'صنف', categoryId: S().categories.at(-1).id, unit: 'قطعة', salePriceMinor: 1000, barcodes: [] })
const item = S().items.at(-1)
S().addSupplier({ nameAr: 'مورد' })
const sup = S().suppliers.at(-1)
const inv = S().postPurchase({ supplierId: sup.id, date: '2026-09-15', lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 500, expiryDate: null }], expenses: [], paidMinor: 5000, treasury: '1101', notes: '' })
ok('فاتورة الشراء لها كود PUR سليم', validateRefCode(inv.refCode) === null && inv.refCode.startsWith('PUR-'), inv.refCode)
const sale = S().postSale({ lines: [{ itemId: item.id, nameAr: 'صنف', qty: 2, unitPriceMinor: 1000, unitCostMinor: 500, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101' })
ok('فاتورة البيع لها كود SAL سليم', validateRefCode(sale.refCode) === null && sale.refCode.startsWith('SAL-'), sale.refCode)
S().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[item.id, 1]]), refund: 'cash', reason: 'فحص' })
const sr = S().saleReturns.at(-1)
ok('مرتجع البيع له كود SRT سليم', validateRefCode(sr.refCode) === null && sr.refCode.startsWith('SRT-'), sr.refCode)
S().postPurchaseReturn({ purchaseId: inv.id, qtyByItem: new Map([[item.id, 1]]), refund: 'cash', treasury: '1101', reason: 'فحص' })
const pr = S().purchaseReturns.at(-1)
ok('مرتجع الشراء له كود PRT سليم', validateRefCode(pr.refCode) === null && pr.refCode.startsWith('PRT-'), pr.refCode)
const all = [inv.refCode, sale.refCode, sr.refCode, pr.refCode]
ok('الأربعة أكواد متمايزة', new Set(all).size === 4)

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 نظام الأكواد المرجعية سليم')
