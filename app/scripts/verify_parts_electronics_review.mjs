/**
 * فحص جولة مراجعة نشاطي قطع الغيار والأجهزة الكهربائية (الطلبات 6–9 — الجولة 6):
 * ① أرقام OEM/البدائل: تطبيع الأرقام (شرطات/مسافات/حالة) + بحث الكاشير الموحد
 * ② التوافق (Fitment) ودرجة القطعة
 * ③ شهادة الضمان: تحمل السيريال والمدة والنهاية بلا تكلفة القطعة
 * تشغيل: node --experimental-strip-types scripts/verify_parts_electronics_review.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { normalizePartNumber, itemMatchesPartQuery, GRADE_LABELS } = await import('../src/core/items.ts')
const { renderWarrantyCardHtml } = await import('../src/ui/print/printWarranty.ts')
const { warrantyEndDate } = await import('../src/core/serials.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }

console.log('\n1️⃣ تطبيع أرقام القطع')
ok('شرطات ومسافات تُتجاهل', normalizePartNumber('BOSCH-0986 AB') === 'BOSCH0986AB')
ok('حروف صغيرة تُرفع', normalizePartNumber('md360935') === 'MD360935')
ok('نقاط وشرطات سفلية أيضاً', normalizePartNumber('a.b_c/d') === 'ABCD')

console.log('\n2️⃣ بحث الكاشير الموحد')
const part = {
  id: 1, nameAr: 'فلتر زيت لانسر', sku: 'P-100', barcodes: ['622001'], categoryId: 1,
  baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 5, priceMinor: 15_000, minQty: 0,
  trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
  variantColors: [], variantSizes: [], isActive: true,
  oemNumbers: ['MD-360935', '0986AB1234'], fitment: 'لانسر 2013-2017، أوتلاندر', grade: 'aftermarket',
}
ok('بحث برقم OEM كما هو', itemMatchesPartQuery(part, 'MD-360935'))
ok('بحث برقم OEM بلا شرطة وبحروف صغيرة', itemMatchesPartQuery(part, 'md360935'))
ok('بحث بجزء من رقم بديل', itemMatchesPartQuery(part, '0986ab'))
ok('بحث بالتوافق «لانسر 2013»', itemMatchesPartQuery(part, 'لانسر 2013'))
ok('بحث بالاسم يعمل كالعادة', itemMatchesPartQuery(part, 'فلتر'))
ok('رقم قصير جداً (<3) لا يطابق عشوائياً', !itemMatchesPartQuery(part, 'MD'))
ok('استعلام غريب لا يطابق', !itemMatchesPartQuery(part, 'XYZ999'))
ok('درجات القطع الثلاث معرفة', GRADE_LABELS.original && GRADE_LABELS.aftermarket && GRADE_LABELS.used)

console.log('\n3️⃣ الصنف في المخزن يحفظ الحقول الجديدة')
S().addItem({ ...part, id: undefined, nameAr: 'طرمبة بنزين', sku: '', barcodes: [], oemNumbers: ['WPS-771'], fitment: 'إلنترا CN7', grade: 'original' })
const saved = S().items.find((i) => i.nameAr === 'طرمبة بنزين')
ok('oemNumbers/fitment/grade محفوظة', saved.oemNumbers?.[0] === 'WPS-771' && saved.fitment === 'إلنترا CN7' && saved.grade === 'original')

console.log('\n4️⃣ شهادة الضمان')
const until = warrantyEndDate('2026-09-16T00:00:00Z', 12)
ok('نهاية ضمان 12 شهراً من 2026-09-16 = 2027-09-16', until === '2027-09-16')
const html = renderWarrantyCardHtml({
  shopName: 'تَحَكَّم', shopPhone: '0100', itemName: 'غسالة LG', serial: 'SN-778899',
  soldAt: '2026-09-16T10:00:00Z', invoiceNumber: 'S-0042', customerName: 'أحمد',
  warrantyMonths: 12, warrantyUntil: until,
})
ok('الشهادة تحمل السيريال والمدة والنهاية', html.includes('SN-778899') && html.includes('12 شهراً') && html.includes(until))
ok('الشهادة تحمل الجهاز والفاتورة والعميل', html.includes('غسالة LG') && html.includes('S-0042') && html.includes('أحمد'))
ok('تهريب HTML في المدخلات', renderWarrantyCardHtml({ shopName: '<script>x</script>', shopPhone: '', itemName: 'a', serial: 'b', soldAt: '2026-01-01', invoiceNumber: 'c', customerName: 'd', warrantyMonths: 1, warrantyUntil: '2026-02-01' }).includes('&lt;script&gt;'))

console.log(`\n${'─'.repeat(40)}\n✅ ${pass} ناجح — ❌ ${fail} فاشل`)
if (fail > 0) process.exit(1)
