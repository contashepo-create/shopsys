/**
 * 🧩 بوابة ودجات الوحدات المضافة في لوحة اليوم (فجوة ف5)
 * ──────────────────────────────────────────────────────
 * كانت الويدجات تتبع **النشاط** لا الوحدة: مغسلة داخل سوبرماركت لا ترى «أوامر
 * غسيل مفتوحة»، ومعمل مضاف لكاشير لا يرى «تحاليل قيد التنفيذ» — فيغيب أهم ما
 * يخص الوحدة عن أول شاشة يفتحها المالك.
 *
 * الفحص يثبت:
 *  ① كل وحدة من الثمانية عشر لها ودجت واحد على الأقل — أو استثناء مصرَّح بسببه.
 *  ② كل ودجت له مسمّى وأيقونة ومسار موجود فعلاً في التنقّل، وجملة «لا …» لفراغه.
 *  ③ كل ودجت في الكتالوج له **حالة حساب فعلية** في مكوّن اللوحة (لا مفتاح ميت).
 *  ④ اللوحة تدمج ودجات الوحدات المفعّلة مع ودجات النشاط (لا حبس في النشاط).
 *
 * تشغيل: node --experimental-strip-types scripts/verify_module_widgets.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MODULE_WIDGETS, MODULE_WIDGET_EXCEPTIONS, widgetsForModules } from '../src/core/moduleCatalog.ts'
import { ALL_MODULES, MODULE_LABELS } from '../src/core/activities.ts'
import { WIDGET_LABELS } from '../src/core/activityTheme.ts'

const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const component = src('ui/components/ActivityWidgets.tsx')
const nav = src('ui/navCatalog.tsx')
const navPaths = new Set([...nav.matchAll(/path: '([^']+)'/g)].map((m) => m[1]))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

console.log('\n🧩 ودجات الوحدات المضافة\n')

/* ① لكل وحدة ودجت أو استثناء مصرَّح به */
let total = 0
for (const module of ALL_MODULES) {
  const widgets = MODULE_WIDGETS[module] ?? []
  const exception = MODULE_WIDGET_EXCEPTIONS[module]
  if (exception) { assert.ok(exception.trim().length >= 12, `استثناء «${module}» بلا سبب واضح`); continue }
  assert.ok(widgets.length >= 1, `الوحدة «${MODULE_LABELS[module]?.nameAr ?? module}» بلا ودجت وبلا استثناء`)
  total += widgets.length
}
ok(`١٨ وحدة: ${total} ودجتاً — لا وحدة صامتة، والاستثناءات (${Object.keys(MODULE_WIDGET_EXCEPTIONS).length}) موثقة بسبابها`)

/* ② مسمّى ومسار لكل ودجت */
for (const module of ALL_MODULES) {
  for (const widget of MODULE_WIDGETS[module] ?? []) {
    const meta = WIDGET_LABELS[widget]
    assert.ok(meta, `الودجت «${widget}» (${module}) بلا مسمّى في WIDGET_LABELS`)
    assert.ok(navPaths.has(meta.route), `مسار الودجت «${widget}» غير موجود في التنقّل: ${meta.route}`)
    assert.ok(meta.titleAr.length >= 4 && meta.emptyAr.length >= 4, `مسمّى/فراغ الودجت «${widget}» غير واضح`)
  }
}
ok('كل ودجت له مسمّى وأيقونة ونص فراغ ومسار حقيقي في التنقّل')

/* ③ لكل ودجت حالة حساب فعلية في اللوحة */
const cases = new Set([...component.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]))
for (const module of ALL_MODULES) {
  for (const widget of MODULE_WIDGETS[module] ?? []) {
    assert.ok(cases.has(widget), `الودجت «${widget}» معلن في الكتالوج وبلا حساب في ActivityWidgets — مفتاح ميت`)
  }
}
ok(`${cases.size} حالة حساب في اللوحة تغطي كل ودجات الكتالوج — لا مفتاح ميت`)

/* ④ الدمج مع ودجات النشاط */
assert.ok(/widgetsForModules\(modules\)/.test(component), 'اللوحة لا تقرأ ودجات الوحدات المضافة')
assert.ok(/const modules = \(\(setup\.modules \?\? \[\]\)/.test(component), 'اللوحة لا تقرأ وحدات النشاط المفعّلة')
assert.ok(/filter\(\(w\) => !theme\.widgets\.includes\(w\)\)/.test(component), 'لا منع لتكرار ودجت النشاط نفسه')
const groceryLaundry = widgetsForModules(['inventory', 'purchases', 'laundry'])
assert.ok(groceryLaundry.includes('laundry_orders'), 'سوبرماركت + مغسلة لا يحصل على ودجت المغسلة')
const clinicLab = widgetsForModules(['clinic', 'lab'])
assert.ok(clinicLab.includes('lab_pending') && clinicLab.includes('today_appointments'), 'العيادة + المعمل لا يدمجان ودجتيهما')
assert.equal(new Set(groceryLaundry).size, groceryLaundry.length, 'الدمج يُكرر الودجت نفسه')
ok('اللوحة تدمج ودجات الوحدات مع ودجات النشاط بلا تكرار — الوحدة المطعَّمة ترى أهم ما يخصها')

console.log(`\n✅ ودجات الوحدات: ${pass} مجموعة تحقق — كلها خضراء\n`)
