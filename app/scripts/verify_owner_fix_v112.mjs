#!/usr/bin/env node
/**
 * بوابة جولة v1.0.12 — تنفيذ الاقتراحات بالترتيب (1-3 من 6):
 *   ① الولاء في الكاشير (نمط Square/Lightspeed): منتقي العميل يظهر مع الولاء + رصيد
 *      النقاط وزر الاستبدال + نقاط ستُضاف للسلة الحالية + العميل يُسجل دائماً
 *      (الكسب في النقدي) + سقف استبدال للعملية الواحدة
 *   ② بطاقة مواعيد اليوم في الداشبورد (لوحدة booking)
 *   ③ تذكيرات واتساب من صفحة المواعيد (رسالة لكل عميل بضغطة)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(DIR, '..', p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const failedNames = []
const check = (name, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) { failed++; failedNames.push(name) }
}

/* ─── ① الولاء في الكاشير ─── */
const loyalty = read('src/core/loyalty.ts')
check('① النواة: سقف استبدال maxRedeemPoints (0 = بلا سقف) مفحوص في validateRedeem', loyalty.includes('maxRedeemPoints') && loyalty.includes('سقف الاستبدال في العملية الواحدة'))
const pos = read('src/ui/pages/PosPage.tsx')
check('① منتقي العميل يظهر مع الولاء حتى بلا قوائم أسعار', pos.includes('|| (loyalty.enabled && customers.length > 0)'))
check('① شارة رصيد نقاط العميل المختار + زر استبدال (يحترم السقف) بجوار المنتقي', pos.includes('⭐') && pos.includes('redeemLoyaltyPoints(selectedCustomer.id, capped)') && pos.includes('سقف الاستبدال للعملية الواحدة'))
check('① «نقاط ستُضاف» فوق الإجمالي بحساب السلة الحية', pos.includes('نقاط ستُضاف لـ') && pos.includes('earnedPoints(totals.totalMinor, cur.decimals, loyalty)'))
check('① العميل المختار يُسجل دائماً (كسب النقاط في النقدي) — القيد يتحدد بالمدفوع فقط', pos.includes('customerId: customerId ?? null'))
const settings = read('src/ui/pages/GeneralSettingsPage.tsx')
check('① إعداد السقف في بطاقة الولاء', settings.includes('سقف الاستبدال للعملية الواحدة') && settings.includes('updateLoyalty({ maxRedeemPoints'))

/* ─── ② بطاقة مواعيد اليوم بالداشبورد ─── */
const dash = read('src/ui/pages/Dashboard.tsx')
check('② بطاقة مواعيد اليوم — لوحدة booking فقط وعدد المحجوزين والقادمون الأربعة', dash.includes("setup.modules.includes('booking')") && dash.includes('مواعيد اليوم') && dash.includes('upcomingToday'))

/* ─── ③ تذكيرات واتساب ─── */
const booking = read('src/core/booking.ts')
check('③ رسالة تذكير عربية + رابط واتساب بتحويل الرقم المصري', booking.includes('buildBookingReminderMessage') && booking.includes('bookingWhatsappLink') && booking.includes('`2${digits}`'))
const bookingsPage = read('src/ui/pages/BookingsPage.tsx')
check('③ حوار التذكيرات: اختيار اليوم (اليوم/غداً) + زر لكل عميل محجوز برقم + نسخ الرقم', bookingsPage.includes('تذكيرات واتساب') && bookingsPage.includes('bookingWhatsappLink(b.phone, msg)') && bookingsPage.includes('لا تذكيرات'))

if (failed === 0) console.log('\nبوابة v1.0.12: ✓ الاقتراحات 1-3 منفذة بالكامل')
else {
  console.log(`\nبوابة v1.0.12: ✗ ${failed} فحص فاشل — الفاشلة: ${failedNames.join(' · ')}`)
  process.exit(1)
}
