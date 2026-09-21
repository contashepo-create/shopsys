/**
 * فحص جولة مراجعة نشاط اللوجستيات (الطلبات 6–9 — الجولة 10):
 * بوليصة النقل المطبوعة — الورقة التي تسافر مع السائق:
 * تُظهر أجرة النقل + مصاريف «على حساب العميل» فقط، وتُخفي التكلفة والربح
 * ومصاريف الخزينة/الآجلة تماماً.
 * تشغيل: node --experimental-strip-types scripts/verify_logistics_review.mjs
 */
const { renderWaybillHtml } = await import('../src/ui/print/printWaybill.ts')
const { computeTripTotals } = await import('../src/core/logistics.ts')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }

console.log('\n1️⃣ تكامل الأرقام مع نواة النقلات')
const totals = computeTripTotals({
  qty: 2, unitPriceMinor: 500_000, vatPercent: 0,
  expenses: [
    { nameAr: 'رسوم ميناء', qty: 1, unitAmountMinor: 30_000, source: 'customer' },
    { nameAr: 'سولار', qty: 1, unitAmountMinor: 80_000, source: 'cash' },
  ],
})
ok('أجرة 1,000,000 + على العميل 30,000 = مستحق 1,030,000', totals.grandMinor === 1_030_000)
ok('السولار تكلفة لا تدخل مستحق العميل', totals.costMinor === 80_000 && totals.billableMinor === 30_000)

console.log('\n2️⃣ البوليصة المطبوعة')
const html = renderWaybillHtml({
  shopName: 'النسر للنقل', tripNumber: 'TR-0033', dateIso: '2026-09-16T08:00:00Z',
  customerName: 'شركة الدلتا', fromLoc: 'ميناء دمياط', toLoc: 'العاشر من رمضان',
  vehiclePlate: 'ق ن ر 1234', vehicleType: 'تريلا', driverName: 'أحمد سعيد',
  containerNumbers: ['MSKU1234567', 'TGHU7654321'], qty: 2, unitPrice: '5,000 ج.م',
  freightTotal: '10,000 ج.م',
  customerExpenses: [{ nameAr: 'رسوم ميناء', amount: '300 ج.م' }],
  grandTotal: '10,300 ج.م', payment: 'credit', notes: 'تسليم صباحي',
})
ok('الرقم والمسار والعميل', html.includes('TR-0033') && html.includes('ميناء دمياط') && html.includes('العاشر من رمضان') && html.includes('شركة الدلتا'))
ok('المركبة والسائق والحاويتان', html.includes('ق ن ر 1234') && html.includes('أحمد سعيد') && html.includes('MSKU1234567') && html.includes('(2)'))
ok('أجرة النقل ومصروف العميل والإجمالي', html.includes('10,000') && html.includes('رسوم ميناء') && html.includes('10,300'))
ok('آجل ظاهر بوضوح', html.includes('آجل'))
ok('لا ذكر للتكلفة أو الربح أو السولار', !html.includes('ربح') && !html.includes('تكلفة') && !html.includes('سولار'))
ok('توقيعا السائق والمستلم', html.includes('السائق') && html.includes('المستلم'))
const noC = renderWaybillHtml({ shopName: 'ن', tripNumber: 't', dateIso: '2026-01-01', customerName: 'ع', fromLoc: '', toLoc: '', vehiclePlate: '', vehicleType: '', driverName: '', containerNumbers: [''], qty: 1, unitPrice: '1', freightTotal: '1', customerExpenses: [], grandTotal: '1', payment: 'cash', notes: '' })
ok('حاويات فارغة لا تطبع قسم الحاويات', !noC.includes('الحاويات'))
ok('تهريب HTML', renderWaybillHtml({ shopName: '<b>x</b>', tripNumber: 't', dateIso: '2026-01-01', customerName: 'ع', fromLoc: '', toLoc: '', vehiclePlate: '', vehicleType: '', driverName: '', containerNumbers: [], qty: 1, unitPrice: '1', freightTotal: '1', customerExpenses: [], grandTotal: '1', payment: 'cash', notes: '' }).includes('&lt;b&gt;'))

console.log(`\n${'─'.repeat(40)}\n✅ ${pass} ناجح — ❌ ${fail} فاشل`)
if (fail > 0) process.exit(1)
