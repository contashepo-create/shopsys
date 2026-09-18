// تحقق نواة المظهر (استكمال المرحلة 1):
// لوحات الألوان، buildAccentCssVars، sanitizeAppearance، مستويات التكبير
// التشغيل: node --experimental-strip-types scripts/verify_appearance.mjs
import {
  ACCENTS,
  DEFAULT_ACCENT_ID,
  DEFAULT_APPEARANCE,
  ZOOM_LEVELS,
  buildAccentCssVars,
  sanitizeAppearance,
} from '../src/core/appearance.ts'

let pass = 0
let fail = 0
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

console.log('— اللوحات —')
check('١٣ لوحة (٨ أصلية + ٣ لهوية الأنشطة + قرمزي الجزارة وتمري صحراوي)', ACCENTS.length === 13)
check('المعرفات فريدة', new Set(ACCENTS.map((a) => a.id)).size === ACCENTS.length)
check('الافتراضي موجود', ACCENTS.some((a) => a.id === DEFAULT_ACCENT_ID))
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900']
check('كل لوحة بعشر درجات hex سليمة', ACCENTS.every((a) => SHADES.every((s) => /^#[0-9a-f]{6}$/i.test(a.shades[s]))))
check('النيلي 500 = #6366f1 (هوية العلامة)', ACCENTS.find((a) => a.id === 'indigo').shades['500'] === '#6366f1')
check('لكل لوحة اسم عربي', ACCENTS.every((a) => a.nameAr.length > 0))

console.log('— buildAccentCssVars —')
const vars = buildAccentCssVars('emerald')
check('عشرة متغيرات', Object.keys(vars).length === 10)
check('الصيغة --color-brand-*', Object.keys(vars).every((k) => k.startsWith('--color-brand-')))
check('القيمة تطابق اللوحة', vars['--color-brand-500'] === '#10b981')
const fallback = buildAccentCssVars('غير-موجود')
check('لوحة مجهولة ← الافتراضي', fallback['--color-brand-500'] === '#6366f1')

console.log('— ZOOM_LEVELS —')
check('أربعة مستويات تشمل 1', ZOOM_LEVELS.length === 4 && ZOOM_LEVELS.some((z) => z.value === 1))
check('مرتبة تصاعدياً', ZOOM_LEVELS.every((z, i) => i === 0 || z.value > ZOOM_LEVELS[i - 1].value))

console.log('— sanitizeAppearance —')
check('null ← الافتراضيات', JSON.stringify(sanitizeAppearance(null)) === JSON.stringify(DEFAULT_APPEARANCE))
check('undefined ← الافتراضيات', sanitizeAppearance(undefined).accentId === DEFAULT_ACCENT_ID)
check('لوحة صحيحة تمر', sanitizeAppearance({ accentId: 'rose' }).accentId === 'rose')
check('لوحة مجهولة ← الافتراضي', sanitizeAppearance({ accentId: 'neon' }).accentId === DEFAULT_ACCENT_ID)
check('تكبير صحيح يمر', sanitizeAppearance({ zoom: 1.25 }).zoom === 1.25)
check('تكبير شاذ ← 1', sanitizeAppearance({ zoom: 99 }).zoom === 1)
check('reduceMotion يقبل true فقط', sanitizeAppearance({ reduceMotion: true }).reduceMotion === true && sanitizeAppearance({ reduceMotion: 'yes' }).reduceMotion === false)

console.log(`\nالمظهر: PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
