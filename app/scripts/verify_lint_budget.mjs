/**
 * بوابة سقف تحذيرات الليت في كود الواجهة (جولة «مراجعة البرنامج بالكامل» §97).
 *
 * كانت التحذيرات 38 في src — منها أخطاء حقيقية أُصلحت هذه الجولة:
 *   • memo قائمة مراجعة الفاتورة لم تتحدث عند تعديل العمولات/المصروفات (عودة بلاغ المالك)
 *   • تركيز آخر سطر يتجاهل استبدال السطور بنفس العدد
 *   • بطاقات KPI بالمطعم تعاد تركيبها كل تصيير (مكوّن داخل التصيير)
 *   • قراءة متغير في طور تهيئته بأثر تعبئة مرتجع الشراء
 *   • هويات غير مستقرة (cur/collectNote/shiftFor/…) تُبطل المذكرات كل تصيير
 *
 * السقف الآن 6 تحذيرات مقصودة فقط — كل واحدة موثقة سببها:
 *   • AnimatedMinor ×2 (set-state-in-effect): محرك العدّ الحي نفسه (rAF + فرع تقليل الحركة)
 *   • PurchaseReturnsPage ×1 (set-state-in-effect): تعبئة أحادية محروسة من رابط «منتهي الصلاحية»
 *   • AnimatedMinor/PrintSwitches/HrPage ×3 (only-export-components): اقتراح fast-refresh فقط
 * أي ارتفاع فوق السقف = تراجع يجب مراجعته أو توثيق سببه هنا وفي الكود.
 */
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('سقف تحذيرات الليت في src (جودة الواجهة)')

const BUDGET = 6
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))
// cwd نظيف بلا شرطة ختامية + --config صريح:
// على ويندوز لم يُطبَّق التكوين (اكتشافاً ولا صراحةً بcwd ختامي) فخرجت قواعد مختلفة
const APP_DIR = APP_ROOT.replace(/[\\/]$/, '')
const output = execFileSync(process.execPath, [join(APP_DIR, 'node_modules', 'oxlint', 'bin', 'oxlint'), '--config', join(APP_DIR, '.oxlintrc.json'), 'src'], { cwd: APP_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const match = output.match(/Found (\d+) warnings? and (\d+) errors?/)
assert.ok(match, 'تعذّر قراءة مخرجات oxlint')
const [, warnings, errors] = match.map(Number)

assert.equal(errors, 0, `أخطاء ليت في src: ${errors} — ممنوعة تماماً`)
R.ok(`صفر أخطاء ليت في 338 ملفاً`)

if (warnings > BUDGET || /react-hooks\(exhaustive-deps\)|react\(immutability\)/.test(output)) {
  console.error(`── مخرجات oxlint الكاملة (التحذيرات ${warnings}) ──\n${output}`)
}
assert.ok(warnings <= BUDGET, `تحذيرات الليت ${warnings} تجاوزت السقف ${BUDGET} — أصلح الجديد أو وثّق سببه في بوابة verify_lint_budget.mjs`)
R.ok(`التحذيرات ${warnings} ≤ السقف ${BUDGET} — الباقي أنماط مقصودة موثقة (محرك العدّ الحي · تعبئة أحادية · اقتراحات fast-refresh)`)

/* الأنماط المقبولة تحديداً: لا سماح بتحذيرات exhaustive-deps/immutability جديدة (بيانات بائتة وتحوير حالة) */
const forbidden = output.match(/react-hooks\(exhaustive-deps\)|react\(immutability\)/)
assert.ok(!forbidden, `تحذير من النوع الخطير (${forbidden?.[0]}) عاد إلى src — بيانات بائتة/تحوير حالة لا يُتسامح معها`)
R.ok('لا تحذيرات exhaustive-deps أو immutability في src — أخطر صنفي تحذير صفهران')

R.done()
