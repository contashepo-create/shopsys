/**
 * فحص جولة مراجعة نشاط المقاولات (الطلبات 6–9 — الجولة 14):
 * المستخلص المطبوع للجهة المالكة — تراكمي سابق + حالي + نسبة إنجاز
 * + محتجز خصماً + صافي مستحق + توقيعات ثلاثية (مقاول/استشاري/مالك).
 * تشغيل: node --experimental-strip-types scripts/verify_contracting_review.mjs
 */
const { renderExtractHtml } = await import('../src/ui/print/printExtract.ts')
const { computeExtractTotals } = await import('../src/core/contracting.ts')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }

console.log('\n1️⃣ تكامل الأرقام مع نواة المستخلصات')
const t = computeExtractTotals(1_000_000, 5, 14)
ok('مستخلص 10,000: ضريبة 1,400 محتجز 500 مستحق 10,900', t.vatMinor === 140_000 && t.retentionMinor === 50_000 && t.dueMinor === 1_090_000)

console.log('\n2️⃣ المستخلص المطبوع')
const html = renderExtractHtml({
  shopName: 'الإعمار للمقاولات', extractNumber: 'EXT-0003', dateIso: '2026-09-16T09:00:00Z',
  projectName: 'برج النيل', projectCode: 'PRJ-0001', clientName: 'هيئة المجتمعات',
  contractValue: '5,000,000 ج.م', description: 'أعمال الهيكل الخرساني — الدور الخامس',
  previousGross: '1,500,000 ج.م', currentGross: '500,000 ج.م', cumulativeGross: '2,000,000 ج.م',
  progressPercent: 40, vat: '70,000 ج.م', retention: '25,000 ج.م', retentionPercent: 5,
  due: '545,000 ج.م', payment: 'credit',
})
ok('الرقم والمشروع والجهة المالكة', html.includes('EXT-0003') && html.includes('برج النيل') && html.includes('هيئة المجتمعات'))
ok('السابق والحالي والتراكمي', html.includes('1,500,000') && html.includes('500,000') && html.includes('2,000,000'))
ok('نسبة الإنجاز 40٪ بشريط', html.includes('40٪') && html.includes('width:40%'))
ok('المحتجز خصماً بين قوسين وبنسبته', html.includes('محتجز ضمان الأعمال 5٪') && html.includes('(25,000'))
ok('الصافي والمطالبة على الجهة', html.includes('545,000') && html.includes('مطالبة على الجهة'))
ok('توقيعات ثلاثية', html.includes('المقاول') && html.includes('الاستشاري') && html.includes('الجهة المالكة'))

console.log('\n3️⃣ الحالات الخاصة')
const min = renderExtractHtml({
  shopName: 'م', extractNumber: 'EXT-0001', dateIso: '2026-01-01', projectName: 'p', projectCode: 'PRJ-0002',
  clientName: 'c', contractValue: '', description: '', previousGross: '0', currentGross: '100', cumulativeGross: '100',
  progressPercent: null, vat: '', retention: '', retentionPercent: 0, due: '100', payment: 'cash',
})
ok('عقد بلا قيمة = لا شريط إنجاز ولا قيمة عقد', !min.includes('نسبة الإنجاز') && !min.includes('قيمة العقد'))
ok('بلا محتجز/ضريبة لا تُطبع صفوفهما', !min.includes('محتجز') && !min.includes('ضريبة القيمة'))
ok('نقدي = «حُصّل نقداً»', min.includes('حُصّل نقداً'))
ok('إنجاز فوق 100 يُقص للشريط', renderExtractHtml({ shopName: 'م', extractNumber: 'e', dateIso: '2026-01-01', projectName: 'p', projectCode: 'c', clientName: 'c', contractValue: '1', description: '', previousGross: '0', currentGross: '1', cumulativeGross: '1', progressPercent: 130, vat: '', retention: '', retentionPercent: 0, due: '1', payment: 'cash' }).includes('width:100%'))
ok('تهريب HTML', renderExtractHtml({ shopName: '<x>', extractNumber: 'e', dateIso: '2026-01-01', projectName: 'p', projectCode: 'c', clientName: 'c', contractValue: '', description: '', previousGross: '0', currentGross: '1', cumulativeGross: '1', progressPercent: null, vat: '', retention: '', retentionPercent: 0, due: '1', payment: 'cash' }).includes('&lt;x&gt;'))

console.log(`\n${'─'.repeat(40)}\n✅ ${pass} ناجح — ❌ ${fail} فاشل`)
if (fail > 0) process.exit(1)
