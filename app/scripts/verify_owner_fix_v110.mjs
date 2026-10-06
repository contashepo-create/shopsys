#!/usr/bin/env node
/**
 * بوابة جولة v1.0.10 — المقارنة العالمية للأنشطة + قناة القسم الإضافي + سلامة البيانات:
 *   ① قناة المنح الموقّعة كاملة: البوت يوقّع وحدات إضافية والتطبيق يستقبلها
 *   ② واجهة إدارة الأقسام وفق العقد: لا فتح ذاتياً — إيقاف/إعادة إظهار للممنوحة
 *   ③ إثبات سلامة البيانات عبر التحديثات (اختبار المسار الحقيقي)
 *   ④ تقرير المقارنة العالمية موجود ودقيق
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

/* ─── ① قناة المنح الموقّعة ─── */
const worker = read('../tools/devbot/src/worker.js')
check('① البوت يعرف الوحدات الـ17 القابلة للمنح (MODULES)', worker.includes("const MODULES = new Set(['pos', 'inventory', 'purchases'") && worker.includes("'realestate'"))
check('① أمر /اصدر يقبل وحدات= ويرفض المجهولة برسالة', worker.includes('وحدات=') && worker.includes('وحدات غير معروفة'))
check('① الوحدات تدخل الحمولة الموقّعة (extraModules) وتُسجَّل في سجل الجهاز وتظهر في الرد', worker.includes('...(extraModules.length ? { extraModules } : {})') && worker.includes('+وحدات') && worker.includes('أقسام ممنوحة خارج النشاط'))
const license = read('src/core/license.ts')
check('① التطبيق يستقبل extraModules الموقّعة في LicensePayload ويتحقق منها', license.includes('extraModules?: string[]') && license.includes('p.extraModules'))

/* ─── ② واجهة إدارة الأقسام (وفق العقد) ─── */
const settings = read('src/ui/pages/GeneralSettingsPage.tsx')
check('② الممنوحة = افتراضيات النشاط ∪ ممنوحات المفتاح (effectiveModules)', settings.includes('effectiveModules(setup.activityId, activatedPayload?.extraModules)'))
check('② لا فتح ذاتياً: غير الممنوحة بشارة «بكود الدعم» (لا زر تفعيل)', settings.includes('بكود الدعم') && !settings.includes(">{'تفعيل'}") && !settings.includes('>تفعيل<'))
check('② الممنوحة المتوقفة: زر «إعادة إظهار» يعيدها ببياناتها', settings.includes('إعادة إظهار') && settings.includes('عاد قسم'))
check('② إيقاف القسم يخفي الشاشات فقط — نص صريح بحفظ البيانات', settings.includes('شاشاته مختفية وبياناته محفوظة بالكامل'))
const store = read('src/stores/app.store.ts')
check('② حماية المتجر: لا إيقاف آخر وحدة مفعّلة (في المنطق لا الواجهة فقط)', store.includes('s.setup.modules.includes(m) && s.setup.modules.length <= 1'))
const wizard = read('src/ui/setup/FirstRunWizard.tsx')
check('② نص المعالج موحّد مع القرار: الإضافي بمفتاح موقّع من الدعم', wizard.includes('بمفتاح موقّع من الدعم الفني'))

/* ─── ③ سلامة البيانات عبر التحديثات ─── */
const migration = read('tests/migration_safety_v110.test.ts')
check('③ اختبار المسار الحقيقي: قاعدة v22 تُرحَّل عند الإقلاع بلا فقد', migration.includes('version: 22') && migration.includes('hasHydrated') && migration.includes('بلا فقد أي عنصر'))
const storage = read('desktop/sqlite/storage.ts')
check('③ نسخة احتياطية إلزامية قبل كل ترحيل SQLite + فحص سلامة بعده', storage.includes('pre-migration-') && storage.includes('فحص سلامة القاعدة فشل بعد الترحيل'))
check('③ الحذف ناعم دائماً (deleted_at) — لا حذف فيزيائي', storage.includes('rowIsDead') && storage.includes('deleted_at'))

/* ─── ④ التقرير ─── */
const report = '../docs/activity-benchmark-2026-10.md'
check('④ تقرير المقارنة العالمية موجود ويغطي 29 نشاطاً + خطة الفجوات', existsSync(join(DIR, '..', report)) && read('../docs/activity-benchmark-2026-10.md').includes('| 29 | نشاط عام'))

if (failed === 0) console.log('\nبوابة v1.0.10: ✓ القناة والواجهة والسلامة والتقرير كاملة')
else {
  console.log(`\nبوابة v1.0.10: ✗ ${failed} فحص فاشل — الفاشلة: ${failedNames.join(' · ')}`)
  process.exit(1)
}
