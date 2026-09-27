/**
 * تحقق الهوية اللونية حسب النشاط (قرار المالك بعد النقاش):
 * كل نشاط من الـ18 له لوحة موجودة فعلاً، مع احتفاظ المستخدم بحرية التغيير.
 * تشغيل: node --experimental-strip-types scripts/verify_activity_theming.mjs
 */
import { ACCENTS, ACTIVITY_ACCENTS, activityAccentId, DEFAULT_ACCENT_ID, sanitizeAppearance, DEFAULT_APPEARANCE } from '../src/core/appearance.ts'
import { ACTIVITY_TEMPLATES } from '../src/core/activities.ts'

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }

ok(ACTIVITY_TEMPLATES.length === 29, `29 نشاطاً (${ACTIVITY_TEMPLATES.length})`)
for (const a of ACTIVITY_TEMPLATES) {
  const acc = activityAccentId(a.id)
  ok(ACCENTS.some((p) => p.id === acc), `${a.nameAr} → لوحة «${acc}» موجودة`)
}
ok(Object.keys(ACTIVITY_ACCENTS).length === ACTIVITY_TEMPLATES.length, `خريطة الأنشطة تغطي الـ${ACTIVITY_TEMPLATES.length} كلها`)
ok(activityAccentId(null) === DEFAULT_ACCENT_ID, 'نشاط غائب → اللوحة الافتراضية')
ok(activityAccentId('no_such') === DEFAULT_ACCENT_ID, 'نشاط مجهول → الافتراضية بأمان')
ok(activityAccentId('jewelry') === 'gold', 'المجوهرات ذهبي فاخر')
ok(activityAccentId('pharmacy') === 'teal' && activityAccentId('clinic') === 'cyan', 'الأنشطة الطبية ألوان طبية')
// حرية المستخدم: sanitizeAppearance يقبل أي لوحة معرفة
const s1 = sanitizeAppearance({ ...DEFAULT_APPEARANCE, accentId: 'gold' })
ok(s1.accentId === 'gold', 'المستخدم يستطيع اختيار أي لوحة (حرية التغيير)')
const s2 = sanitizeAppearance({ ...DEFAULT_APPEARANCE, accentId: 'bogus' })
ok(s2.accentId === DEFAULT_ACCENT_ID, 'لوحة مجهولة تُرفض بأمان')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
