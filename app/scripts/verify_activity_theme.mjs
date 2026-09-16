/**
 * تحقق حزمة الهوية البصرية لكل نشاط (بند 11 — قرار المالك بعد النقاش):
 * ① كل نشاط له هوية كاملة: شخصية + نمط كاشير + ترحيب + ويدجات.
 * ② الاتساق: الأنشطة الغذائية/الطبية fast_list، المطعم visual_grid، الموبايل detail_cards.
 * ③ كل الويدجات معرّفة العناوين والمسارات، وكل الشخصيات لها أصناف CSS.
 * ④ الربط: Dashboard (رأس + ويدجات) وPosPage (3 أنماط).
 * تشغيل: node --experimental-strip-types scripts/verify_activity_theme.mjs
 */
import { readFileSync } from 'node:fs'
import { ACTIVITY_THEMES, themeForActivity, PERSONA_STYLES, WIDGET_LABELS } from '../src/core/activityTheme.ts'
import { ACTIVITY_TEMPLATES as ACTIVITIES } from '../src/core/activities.ts'

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }

console.log('— ① تغطية كل الأنشطة —')
const missing = ACTIVITIES.filter((a) => !ACTIVITY_THEMES[a.id])
ok(missing.length === 0, `كل الأنشطة الـ${ACTIVITIES.length} لها هوية${missing.length ? ` — ناقص: ${missing.map((a) => a.id)}` : ''}`)
for (const [id, t] of Object.entries(ACTIVITY_THEMES)) {
  if (!t.heroLineAr || !t.heroEmoji || t.widgets.length === 0) { FAIL++; console.log(`  ✗ ${id} هوية ناقصة`) }
}
ok(true, 'كل هوية فيها ترحيب وإيموجي وويدجت واحد على الأقل')
ok(themeForActivity('نشاط_مجهول').persona === 'fresh', 'نشاط مجهول ⇒ الهوية العامة (لا انهيار)')
ok(themeForActivity(null).posLayout === 'fast_list', 'null ⇒ قائمة سريعة افتراضية')

console.log('— ② اتساق القرارات التصميمية —')
ok(ACTIVITY_THEMES.restaurant.posLayout === 'visual_grid', 'المطعم: شبكة بصرية كبيرة')
ok(ACTIVITY_THEMES.grocery.posLayout === 'fast_list' && ACTIVITY_THEMES.pharmacy.posLayout === 'fast_list', 'بقالة/صيدلية: قائمة سريعة بباركود')
ok(ACTIVITY_THEMES.mobile.posLayout === 'detail_cards' && ACTIVITY_THEMES.electronics.posLayout === 'detail_cards', 'موبايل/إلكترونيات: بطاقات تفصيلية')
ok(ACTIVITY_THEMES.jewelry.persona === 'luxury' && ACTIVITY_THEMES.cars.persona === 'luxury', 'مجوهرات/معارض: شخصية فاخرة')
ok(ACTIVITY_THEMES.clinic.persona === 'clinical' && ACTIVITY_THEMES.lab.persona === 'clinical', 'عيادة/معمل: شخصية طبية')
ok(ACTIVITY_THEMES.contracting.persona === 'industrial' && ACTIVITY_THEMES.logistics.persona === 'industrial', 'مقاولات/لوجستيات: شخصية صناعية')
ok(ACTIVITY_THEMES.clinic.widgets[0] === 'today_appointments', 'العيادة: مواعيد اليوم أولاً')
ok(ACTIVITY_THEMES.logistics.widgets[0] === 'active_trips', 'اللوجستيات: الرحلات النشطة أولاً')
ok(ACTIVITY_THEMES.restaurant.widgets[0] === 'kitchen_orders', 'المطعم: أوردرات المطبخ أولاً')
ok(ACTIVITY_THEMES.jewelry.widgets[0] === 'gold_position', 'المجوهرات: مركز الذهب أولاً')
ok(ACTIVITY_THEMES.grocery.widgets.includes('expiry_soon'), 'البقالة: مراقبة الصلاحية')

console.log('— ③ اكتمال التعريفات —')
const usedWidgets = new Set(Object.values(ACTIVITY_THEMES).flatMap((t) => t.widgets))
ok([...usedWidgets].every((w) => WIDGET_LABELS[w]?.titleAr && WIDGET_LABELS[w]?.route), 'كل ويدجت مستخدم له عنوان ومسار')
const usedPersonas = new Set(Object.values(ACTIVITY_THEMES).map((t) => t.persona))
ok([...usedPersonas].every((p) => PERSONA_STYLES[p]?.card && PERSONA_STYLES[p]?.hero), 'كل شخصية مستخدمة لها أصناف CSS')

console.log('— ④ الربط في الواجهات —')
const dash = readFileSync(new URL('../src/ui/pages/Dashboard.tsx', import.meta.url), 'utf8')
ok(dash.includes('themeForActivity') && dash.includes('PERSONA_STYLES'), 'Dashboard: رأس ترحيب بهوية النشاط')
ok(dash.includes('<ActivityWidgets'), 'Dashboard: ويدجات النشاط مدموجة')
const pos = readFileSync(new URL('../src/ui/pages/PosPage.tsx', import.meta.url), 'utf8')
ok(pos.includes("posLayout === 'fast_list'") && pos.includes("posLayout === 'visual_grid'"), 'PosPage: الأنماط الثلاثة مطبقة')
const aw = readFileSync(new URL('../src/ui/components/ActivityWidgets.tsx', import.meta.url), 'utf8')
ok(aw.includes('today_appointments') && aw.includes('gold_position') && aw.includes('kitchen_orders'), 'ActivityWidgets: كل الحالات مغطاة')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
