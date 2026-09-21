/**
 * فحص جولة مراجعة نشاط معرض السيارات (الطلبات 6–9 — الجولة 13):
 * عقد بيع السيارة المطبوع — الورقة التي يتسلمها المشتري:
 * بيانات السيارة كاملة + الثمن + إقرارات — بلا تكلفة ولا ربح،
 * وصيغة الوكالة بالعمولة لسيارات الأمانة.
 * تشغيل: node --experimental-strip-types scripts/verify_cars_review.mjs
 */
const { renderCarSaleContractHtml } = await import('../src/ui/print/printCarSale.ts')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }

const base = {
  shopName: 'معرض النجم', dateIso: '2026-09-16T12:00:00Z', buyerName: 'خالد حسن',
  make: 'تويوتا', model: 'كورولا', year: 2022, plateOrVin: 'س ط و 5821', odometerKm: 45210,
  price: '950,000 ج.م', vat: '', payment: 'cash', consignment: false, notes: '',
}

console.log('\n1️⃣ عقد بيع سيارة المعرض')
const html = renderCarSaleContractHtml(base)
ok('الطرفان والتاريخ', html.includes('معرض النجم') && html.includes('خالد حسن') && html.includes('2026-09-16'))
ok('السيارة: ماركة/موديل/سنة/لوحة/عداد', html.includes('تويوتا كورولا') && html.includes('2022') && html.includes('س ط و 5821') && html.includes('45,210'))
ok('الثمن ونقداً', html.includes('950,000') && html.includes('سُدد نقداً'))
ok('إقرار المعاينة ونقل الملكية والتوقيعان', html.includes('النافية للجهالة') && html.includes('نقل الملكية') && html.includes('البائع') && html.includes('المشتري'))
ok('لا وكالة بالعمولة في بيع المعرض', !html.includes('وكيلاً بالعمولة'))
ok('لا ذكر للتكلفة أو الربح', !html.includes('تكلفة') && !html.includes('ربح'))

console.log('\n2️⃣ الحالات الخاصة')
const cg = renderCarSaleContractHtml({ ...base, consignment: true, payment: 'credit', vat: '10,000 ج.م' })
ok('سيارة أمانة = «وكيلاً بالعمولة عن المالك»', cg.includes('وكيلاً بالعمولة عن المالك'))
ok('آجل يظهر «بذمة المشتري» والضريبة تطبع', cg.includes('بذمة المشتري') && cg.includes('10,000'))
ok('تهريب HTML', renderCarSaleContractHtml({ ...base, buyerName: '<svg/onload=x>' }).includes('&lt;svg'))
ok('بلا مشترٍ يطبع شرطة لا فراغاً', renderCarSaleContractHtml({ ...base, buyerName: '' }).includes('<b>—</b>'))

console.log(`\n${'─'.repeat(40)}\n✅ ${pass} ناجح — ❌ ${fail} فاشل`)
if (fail > 0) process.exit(1)
