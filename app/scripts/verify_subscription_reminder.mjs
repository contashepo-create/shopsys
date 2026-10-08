#!/usr/bin/env node
/**
 * verify_subscription_reminder — بوابة بند 5 (تدقيق 2026-10-08):
 * «رسالة غير مزعجة للعميل أنه متبقي فقط 10 أيام على انتهاء اشتراكه».
 *
 * ما تُثبته:
 *   • التدرّج 30 (جرس) / 10 (شريط) / 3 (عاجل بزر تواصل) — والعتبات ثابتة معلنة.
 *   • يُحسب محلياً من الرخصة الموقّعة ⇒ يعمل أوفلاين (لا fetch في الوحدة).
 *   • غير مزعج فعلاً: الإسكات يُخفي الشريط بقية اليوم ولا يعود، والجرس يبقى.
 *   • منتهية/مدى الحياة/تاريخ تالف ⇒ لا شيء (شاشة القفل هي الواجهة بعد الانتهاء).
 *   • الأسلاك موجودة فعلاً في الواجهة (الشريط في التخطيطين، والإدراج في الجرس).
 *
 * node --experimental-strip-types scripts/verify_subscription_reminder.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import {
  renewalReminder, shouldShowReminderBar, reminderAsNotification, daysWordAr,
  REMINDER_BELL_DAYS, REMINDER_BANNER_DAYS, REMINDER_URGENT_DAYS,
} from '../src/core/subscriptionReminder.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const moduleSrc = src('../src/core/subscriptionReminder.ts')
const barSrc = src('../src/ui/components/RenewalNoticeBar.tsx')
const layoutSrc = src('../src/ui/layout/MainLayout.tsx')
const headerSrc = src('../src/ui/layout/Header.tsx')
const storeSrc = src('../src/stores/app.store.ts')
const noticesSrc = src('../src/core/notifications.ts')

const DAY = 86_400_000
const TODAY = '2026-10-08T09:00:00Z'
const at = (days) => new Date(Date.parse('2026-10-08T00:00:00Z') + days * DAY).toISOString().slice(0, 10)

console.log('بوابة بند 5 — تذكير قرب انتهاء الاشتراك (غير مزعج):')

ok('العتبات معلنة: 30 للجرس · 10 للشريط · 3 للعاجل', () => {
  assert.equal(REMINDER_BELL_DAYS, 30)
  assert.equal(REMINDER_BANNER_DAYS, 10) // الطلب الصريح للمالك: «متبقي فقط 10 أيام»
  assert.equal(REMINDER_URGENT_DAYS, 3)
})

ok('مدى الحياة/بعيدة/منتهية/تاريخ تالف ⇒ لا تذكير', () => {
  for (const expiresAt of [null, at(31), at(200), at(-1), at(-90), 'ليس تاريخاً']) {
    assert.equal(renewalReminder({ expiresAt, todayIso: TODAY }).kind, 'none', String(expiresAt))
    assert.equal(reminderAsNotification(renewalReminder({ expiresAt, todayIso: TODAY })), null)
  }
})

ok('التدرّج: 30 ⇒ bell · 10 ⇒ banner · 3 ⇒ urgent · 11 ⇒ bell', () => {
  assert.equal(renewalReminder({ expiresAt: at(30), todayIso: TODAY }).kind, 'bell')
  assert.equal(renewalReminder({ expiresAt: at(11), todayIso: TODAY }).kind, 'bell')
  assert.equal(renewalReminder({ expiresAt: at(10), todayIso: TODAY }).kind, 'banner')
  assert.equal(renewalReminder({ expiresAt: at(3), todayIso: TODAY }).kind, 'urgent')
  assert.equal(renewalReminder({ expiresAt: at(0), todayIso: TODAY }).kind, 'urgent') // ينتهي اليوم
})

ok('زر «تواصل للتجديد» يظهر عند 3 أيام فقط — لا استعجال قبلها', () => {
  assert.equal(renewalReminder({ expiresAt: at(10), todayIso: TODAY }).showContact, false)
  assert.equal(renewalReminder({ expiresAt: at(3), todayIso: TODAY }).showContact, true)
})

ok('غير مزعج: الإسكات يُخفي الشريط اليوم ويعود غداً، والجرس مستقل', () => {
  const r = renewalReminder({ expiresAt: at(8), todayIso: TODAY })
  assert.equal(shouldShowReminderBar({ reminder: r, todayIso: TODAY, dismissedDay: null }), true)
  assert.equal(shouldShowReminderBar({ reminder: r, todayIso: TODAY, dismissedDay: '2026-10-08' }), false)
  assert.equal(shouldShowReminderBar({ reminder: r, todayIso: TODAY, dismissedDay: '2026-10-07' }), true)
  assert.notEqual(reminderAsNotification(r), null) // الجرس لا يتأثر بالإسكات
})

ok('bell وحده لا شريط له (إدراج صامت في الجرس)', () => {
  const r = renewalReminder({ expiresAt: at(25), todayIso: TODAY })
  assert.equal(r.kind, 'bell')
  assert.equal(shouldShowReminderBar({ reminder: r, todayIso: TODAY }), false)
  assert.notEqual(reminderAsNotification(r), null)
})

ok('صيغة عربية صحيحة للعدد (مفرد/مثنى/جمع/11+)', () => {
  assert.equal(daysWordAr(1), 'يوم واحد')
  assert.equal(daysWordAr(2), 'يومان')
  assert.equal(daysWordAr(10), '10 أيام')
  assert.equal(daysWordAr(30), '30 يوماً')
  assert.match(renewalReminder({ expiresAt: at(10), todayIso: TODAY }).titleAr, /10 أيام/)
})

ok('يعمل أوفلاين: لا fetch ولا شبكة في الوحدة', () => {
  assert.ok(!/fetch\(|XMLHttpRequest|navigator\.onLine/.test(moduleSrc), 'الوحدة يجب ألا تلمس الشبكة')
  assert.match(moduleSrc, /expiresAt/, 'تُحسب من expiresAt الموقّع في الرخصة')
})

ok('إدراج الجرس: معرف ثابت لليوم وبلا صلاحية مطلوبة', () => {
  const n = reminderAsNotification(renewalReminder({ expiresAt: at(8), todayIso: TODAY }))
  assert.equal(n.perm, null)
  assert.equal(n.route, '/settings/license')
  assert.match(n.id, /^license:renewal:/)
  const tomorrow = reminderAsNotification(renewalReminder({ expiresAt: at(8), todayIso: new Date(Date.parse(TODAY) + DAY).toISOString() }))
  assert.notEqual(tomorrow.id, n.id) // يتجدد ولا يتكدس
})

ok('collectNotifications يستقبل التذكير ويدفعه أولاً', () => {
  assert.match(noticesSrc, /licenseReminder\?:\s*AppNotification\s*\|\s*null/)
  assert.match(noticesSrc, /licenseReminder/)
})

ok('الشريط موصول في تخطيطَي الواجهة (شريط علوي + شريط جانبي)', () => {
  assert.equal(layoutSrc.split('<RenewalNoticeBar/>').length - 1, 2, 'يجب عرضه في الفرعين معاً')
  assert.match(layoutSrc, /import \{ RenewalNoticeBar \}/)
})

ok('الشريط رفيع غير حاجب وفيه إسكات وتفاصيل وتواصل', () => {
  assert.match(barSrc, /role="status"/)
  assert.match(barSrc, /dir="rtl"/)
  assert.match(barSrc, /dismiss\(/)
  assert.match(barSrc, /\/settings\/license/)
  assert.match(barSrc, /\/settings\/support/)
  assert.match(barSrc, /shouldShowReminderBar/)
  assert.ok(!/\bModal\b/.test(barSrc), 'لا نافذة حوارية — المالك طلب «غير مزعجة»')
})

ok('الجرس يمرر التذكير ويعتمد على حمولة الرخصة ويوم الإسكات', () => {
  assert.match(headerSrc, /reminderAsNotification\(renewalReminder\(/)
  assert.match(headerSrc, /activatedPayload\?\.expiresAt/)
  assert.match(headerSrc, /renewalDismissedDay/)
})

ok('المتجر يحفظ يوم الإسكات (يبقى بعد الإقلاع)', () => {
  assert.match(storeSrc, /renewalDismissedDay: string \| null/)
  assert.match(storeSrc, /dismissRenewalNotice/)
  // partialize يُسقط الحمولة فقط — فيوم الإسكات يُحفظ
  assert.match(storeSrc, /const \{ activatedPayload: _payload, licenseAudit: _audit, \.\.\.rest \} = state/)
})

console.log(`\nالنتيجة: ${passed} فحوص ناجحة${process.exitCode ? ' — مع فشل أعلاه' : ' ✅'}`)
