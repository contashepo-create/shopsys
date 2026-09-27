/**
 * فحص جولة مراجعة نشاط إيجار المعدات (الطلبات 6–9 — الجولة 9):
 * ① rentalExpectedEnd/isRentalOverdue — إنذار التأخير عن الإرجاع
 * ② renderRentalContractHtml — عقد A4 بطرفين وبنود وتوقيعين
 * تشغيل: node --experimental-strip-types scripts/verify_rental_review.mjs
 */
const { rentalExpectedEnd, isRentalOverdue } = await import('../src/core/rental.ts')
const { renderRentalContractHtml } = await import('../src/ui/print/printRentalContract.ts')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }

console.log('\n1️⃣ نهاية العقد المتوقعة')
ok('يومي: 3 أيام من 10/1 = 13/1', rentalExpectedEnd('2026-01-10T08:00:00.000Z', 3, 'daily').startsWith('2026-01-13'))
ok('ساعي: 5 ساعات من 08:00 = 13:00', rentalExpectedEnd('2026-01-10T08:00:00.000Z', 5, 'hourly').includes('13:00'))
ok('شهري: شهران من 10/1 = 10/3', rentalExpectedEnd('2026-01-10T08:00:00.000Z', 2, 'monthly').startsWith('2026-03-10'))

console.log('\n2️⃣ إنذار التأخير')
const c = { status: 'active', date: '2026-01-10T08:00:00.000Z', days: 3, rateType: 'daily' }
ok('داخل المدة = ليس متأخراً', !isRentalOverdue(c, '2026-01-12T00:00:00.000Z'))
ok('بعد المدة = متأخر', isRentalOverdue(c, '2026-01-14T00:00:00.000Z'))
ok('العقد المقفل لا يتأخر أبداً', !isRentalOverdue({ ...c, status: 'closed' }, '2026-06-01T00:00:00.000Z'))
ok('عقد قديم بلا rateType يعامل يومياً', isRentalOverdue({ status: 'active', date: '2026-01-10T08:00:00.000Z', days: 1 }, '2026-01-12T00:00:00.000Z'))

console.log('\n3️⃣ عقد الإيجار المطبوع')
const html = renderRentalContractHtml({
  shopName: 'الوطنية للمعدات', shopPhone: '0100', contractNumber: 'RC-0009', dateIso: '2026-09-16T10:00:00Z',
  customerName: 'شركة النيل', customerPhone: '0111', equipmentName: 'حفار كوماتسو', equipmentCode: 'EX-200',
  units: 5, unitLabel: 'يوم', unitRate: '3,000 ج.م', rentTotal: '15,000 ج.م', vat: '', deposit: '10,000 ج.م',
  paymentLabel: 'مدفوع + آجل', paidRent: '8,000 ج.م', dueRent: '7,000 ج.م',
  startReading: 4520, expectedEnd: '2026-09-21T10:00:00Z', notes: '',
})
ok('العقد والطرفان والمعدة', html.includes('RC-0009') && html.includes('شركة النيل') && html.includes('حفار كوماتسو'))
ok('المدة وموعد الإرجاع', html.includes('5 يوم') && html.includes('2026-09-21'))
ok('قراءة العدّاد والتأمين', html.includes('4520') && html.includes('10,000'))
ok('المبلغ المدفوع والمتبقي في العقد', html.includes('مدفوع + آجل') && html.includes('8,000') && html.includes('7,000'))
ok('بنود الالتزام والتوقيعان', html.includes('من الباطن') && html.includes('الطرف الأول') && html.includes('الطرف الثاني'))
ok('تهريب HTML', renderRentalContractHtml({ shopName: '<script>', shopPhone: '', contractNumber: 'x', dateIso: '2026-01-01', customerName: 'a', customerPhone: '', equipmentName: 'b', equipmentCode: '', units: 1, unitLabel: 'يوم', unitRate: '1', rentTotal: '1', vat: '', deposit: '', startReading: null, expectedEnd: '2026-01-02', notes: '' }).includes('&lt;script&gt;'))

console.log(`\n${'─'.repeat(40)}\n✅ ${pass} ناجح — ❌ ${fail} فاشل`)
if (fail > 0) process.exit(1)
