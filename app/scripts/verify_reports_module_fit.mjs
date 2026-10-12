/**
 * 📊 بوابة تطابق تبويبات مركز التقارير مع الأنشطة والوحدات المضافة (فجوة ف1 + ف2)
 * ────────────────────────────────────────────────────────────────────────────────
 * كانت التبويبات السبعة تُرسم دائماً: نشاط بلا كاشير يفتح «المبيعات اليومية» على
 * صفر، ونشاط بلا مخزون يفتح «المخزون» على فراغ — ولا باب من المركز إلى تقارير
 * الوحدة المطعَّمة.
 *
 * الفحص يثبت:
 *  ① سجل واحد للتبويبات `core/reportTabs.ts` — والصفحة ترسم منه لا من نسخة محلية.
 *  ② الشرط محقّق: تبويب الوحدة يظهر بوحدتها **أو** ببيانات فعلية، ووسم «لا حركة بعد»
 *    يظهر بدل الفراغ.
 *  ③ محاكاة تسعة وعشرين نشاطاً: كل نشاط يرى تبويبات نواة غير فارغة، والأنشطة بلا
 *    كاشير لا ترى تبويب المبيعات بلا بيانات، ونشاط به بيع يراها.
 *  ④ بطاقة «تقارير أقسامك المضافة» مبنية من كتالوج الوحدات (ف2) ومصادرها مسارات
 *    حقيقية موجودة في `navCatalog`.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_reports_module_fit.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { REPORT_TABS, visibleReportTabs } from '../src/core/reportTabs.ts'
import { ACTIVITY_TEMPLATES, effectiveModules, ALL_MODULES, MODULE_LABELS } from '../src/core/activities.ts'
import { MODULE_REPORT_LINKS } from '../src/core/moduleCatalog.ts'

const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const page = src('ui/pages/ReportsPage.tsx')
const nav = src('ui/navCatalog.tsx')
const navPaths = new Set([...nav.matchAll(/path: '([^']+)'/g)].map((m) => m[1]))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

console.log('\n📊 تطابق تبويبات مركز التقارير\n')

/* ① سجل واحد + رسم من السجل */
assert.equal(REPORT_TABS.length, 7, 'عدد التبويبات تغيّر — راجع السجل')
assert.equal(new Set(REPORT_TABS.map((t) => t.id)).size, 7, 'معرّف تبويب مكرر في السجل')
ok('سجل التبويبات: ٧ تبويبات بمعرّفات فريدة')
assert.ok(/visibleReportTabs\(enabledModules, tabHasData\)/.test(page), 'الصفحة لا تُصفّي التبويبات من السجل')
assert.ok(/visibleTabs\.map\(/.test(page), 'الصفحة لا ترسم التبويبات من السجل')
assert.ok(!/setTab\('sales'\)/.test(page), 'بقي زر تبويب ثابت مكتوب يدوياً في الصفحة')
assert.ok(/visibleTabs\.some\(\(def\) => def\.id === tab\)/.test(page), 'لا حماية من تبويب مخفي يبقى نشطاً')
ok('الصفحة ترسم من السجل + تُخفّض التبويب النشط إن اختفى شرطه')

/* ② شرط الظهور + وسم «لا حركة بعد» */
for (const tab of REPORT_TABS) assert.ok(tab.labelAr && tab.dataHintAr, `التبويب ${tab.id} بلا وصف`)
for (const tab of REPORT_TABS) if (tab.module) assert.ok(ALL_MODULES.includes(tab.module), `تبويب ${tab.id} يشير لوحدة غير موجودة`)
assert.ok(/data-report-tab=/.test(page) && /data-report-empty/.test(page), 'لا وسم مرئي للتبويب الفارغ أو لا معرّف للتبويب')
assert.ok(/empty && <span/.test(page), 'وسم «لا حركة بعد» غير مربوط بغياب الحركة')
ok('الشرط محقّق: وحدة أو بيانات + وسم «لا حركة بعد» بدل الفراغ')

/* ③ محاكاة ٢٩ نشاطاً */
const NO_DATA = () => false
const WITH_DATA = () => true
let coreTabCount = 0
for (const template of ACTIVITY_TEMPLATES) {
  const modules = effectiveModules(template.id, undefined)
  const tabs = visibleReportTabs(modules, NO_DATA)
  assert.ok(tabs.length >= 3, `النشاط ${template.id} يرى ${tabs.length} تبويباً فقط بلا بيانات`)
  const coreTabs = tabs.filter((tab) => tab.always === true)
  coreTabCount += coreTabs.length
  assert.ok(coreTabs.some((tab) => tab.id === 'financial'), `النشاط ${template.id} بلا تبويب القوائم المالية`)
  const salesTab = tabs.find((tab) => tab.id === 'sales')
  if (modules.includes('pos')) assert.ok(salesTab, `النشاط ${template.id} له كاشير ولا يرى تبويب المبيعات`)
  else assert.ok(!salesTab, `النشاط ${template.id} بلا كاشير ومع ذلك يرى تبويب المبيعات بلا بيانات`)
  if (!modules.includes('pos')) {
    const withSales = visibleReportTabs(modules, (id) => id === 'sales')
    assert.ok(withSales.some((tab) => tab.id === 'sales'), `النشاط ${template.id} له مبيعات فعلية ولا يرى تبويبها`)
  }
}
ok(`٢٩ نشاطاً: التبويبات تُحسب من وحداتها (${coreTabCount} تبويب نواة مضمون) — والبيع بلا كاشير يظهر ببياناته`)

/* ④ بطاقة تقارير الأقسام (ف2) */
assert.ok(/reportCentersForModules\(/.test(page), 'البطاقة لا تقرأ كتالوج الوحدات')
assert.ok(/data-report-module-card/.test(page) && /data-report-module=/.test(page), 'لا معرّف للبطاقة أو لعناصرها')
const centered = Object.entries(MODULE_REPORT_LINKS).filter(([, center]) => center.links.length > 0)
assert.equal(centered.length, ALL_MODULES.length, 'وحدة بلا روابط تقارير في الكتالوج')
let links = 0
for (const [module, center] of centered) {
  assert.ok(MODULE_LABELS[module], `وحدة بلا مسمّى: ${module}`)
  assert.ok(center.labelAr.length > 3, `عنوان مركز ${module} غير واضح`)
  for (const link of center.links) {
    assert.ok(navPaths.has(link.path), `رابط تقرير غير موجود في التنقّل: ${link.path} (${module})`)
    assert.ok(link.labelAr.length > 3, `رابط بلا وصف: ${link.path}`)
    links++
  }
}
ok(`بطاقة «تقارير أقسامك المضافة»: ${centered.length} وحدة و${links} رابطاً كلها مسارات حقيقية`)

console.log(`\n✅ تطابق مركز التقارير: ${pass} مجموعة تحقق — كلها خضراء\n`)
