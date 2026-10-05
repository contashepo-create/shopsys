#!/usr/bin/env node
/**
 * بوابة جولة v1.0.11 — سد الفجوات العالمية (طلب المالك):
 *   ① الفجوة 1 (حقيقية): المواعيد والحجوزات — وحدة booking كاملة للصالون/المعمل/المغسلة
 *   ② الفجوة 3 (حقيقية): إشعار العميل بحالة تذكرة الصيانة عبر واتساب
 *   ③ الفجوتان 2 و4: كانتا مسدودتين أصلاً (Gantt+عمالة / fitment) — تصحيح تقريري + شارة عرض
 *   ④ التقرير محدث بحقيقة ما بعد التدقيق العميق
 */
import { readFileSync, existsSync } from 'node:fs'
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

/* ─── ① المواعيد والحجوزات ─── */
const booking = read('src/core/booking.ts')
check('① نواة نقية: نموذج + تحقق + قائمة يوم + كشف تداخل + إحصاءات', booking.includes('export interface Booking') && booking.includes('bookingConflicts') && booking.includes('bookingDayStats'))
const repo = read('src/data/repo.ts')
check('① المتجر: bookings + إضافة بتحذير تعارض + حالات + تعديل + حذف', repo.includes('bookings: Booking[]') && repo.includes('addBooking') && repo.includes('setBookingStatus') && repo.includes('deleteBooking'))
check('① ترحيل آمن: bookings تستكمل افتراضياً في migrate', repo.includes('bookings: s.bookings ?? []'))
const activities = read('src/core/activities.ts')
check('① وحدة booking مسجلة: نوع + وصف + ALL_MODULES (18 وحدة)', activities.includes("| 'booking'") && activities.includes('booking: { nameAr:') && activities.includes("'laundry', 'booking'"))
check('① القوالب الافتراضية: الصالون والمعمل والمغسلة تضم المواعيد', activities.includes("modules: ['lab', 'booking']") && activities.includes("modules: ['laundry', 'booking']") && activities.includes("modules: ['pos', 'inventory', 'purchases', 'booking']"))
const bookingsPage = read('src/ui/pages/BookingsPage.tsx')
check('① صفحة اليوم: تنقل أيام + إحصاءات + حالات + تحذير تداخل بمرحلتين', bookingsPage.includes('حجز موعد') && bookingsPage.includes('لم يحضر') && bookingsPage.includes('متابعة رغم التداخل') && bookingsPage.includes('stats.done'))
const app = read('src/App.tsx')
check('① مسار /bookings + صلاحية + قائمة ملاحة', app.includes('/bookings') && read('src/ui/navCatalog.tsx').includes("module: 'booking'") && read('src/core/permissions.ts').includes("prefix: '/bookings'"))
check('① صراحة محاسبية: الموعد وعد تشغيلي بلا قيد — الدفع عند البيع', bookingsPage.includes('لا يلمس الدفاتر') && booking.includes('لا يلمس الدفاتر'))
check('① البوت يمنح وحدة booking للمفاتيح (MODULES)', read('../tools/devbot/src/worker.js').includes("'laundry', 'booking'"))

/* ─── ② إشعار حالة التذكرة ─── */
const maintenance = read('src/core/maintenance.ts')
check('② بناء رسالة حالة عربية لكل حالة + رابط واتساب بتحويل الرقم المصري', maintenance.includes('buildTicketStatusMessage') && maintenance.includes('ticketWhatsappLink') && maintenance.includes("`2${digits}`"))
const maintPage = read('src/ui/pages/MaintenancePage.tsx')
check('② زر واتساب بكل تذكرة برقم العميل (بلا سحابة — نمط RepairShopr)', maintPage.includes('ticketWhatsappLink') && maintPage.includes('إبلاغ العميل بحالة الجهاز عبر واتساب'))

/* ─── ③ الفجوتان المصححتان (مسدودتان أصلاً) ─── */
check('③ Gantt المهام موجود أصلاً (أشرطة زمنية + تأخير أحمر)', read('src/ui/pages/ContractingPlanPages.tsx').includes('insetInlineStart') && read('src/ui/pages/ContractingPlanPages.tsx').includes('late'))
check('③ عمالة اليومية موجودة أصلاً (تسوية 5110/5108)', read('src/core/contracting.ts').includes('buildDailyWorkSettlementEntry') && read('src/ui/pages/ContractingDepthPages.tsx').includes('DailyWorkersPage'))
check('③ fitment موجود أصلاً (إدخال + بحث الكاشير) + شارة عرض بالقائمة', read('src/core/items.ts').includes('fitment?: string') && read('src/ui/pages/ItemsPage.tsx').includes('يناسب:') && read('src/ui/pages/ItemsPage.tsx').includes('draft.fitment'))

/* ─── ④ التقرير ─── */
const report = read('../docs/activity-benchmark-2026-10.md')
check('④ التقرير مصحح: سد الفجوتين الحقيقيتين وتوثيق التصحيح التقريري', report.includes('سُدّت') && report.includes('تصحيح تقريري') && report.includes('Gantt المهام'))

if (failed === 0) console.log('\nبوابة v1.0.11: ✓ كل الفجوات الأربع مغلقة (اثنتان سُددتا الآن واثنتان كانتا مسدودتين أصلاً)')
else {
  console.log(`\nبوابة v1.0.11: ✗ ${failed} فحص فاشل — الفاشلة: ${failedNames.join(' · ')}`)
  process.exit(1)
}
