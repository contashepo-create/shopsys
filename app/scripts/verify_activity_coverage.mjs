/**
 * فحص تغطية الأنشطة والوحدات (مراجعة المالك الشاملة):
 * 1) كل نشاط من الـ16: وحداته معرفة، ولكل وحدة قسم تنقل بمسارات، ولكل مسار صفحة مسجلة في App.tsx
 * 2) أي وحدة تُفعَّل لأي نشاط (من الإعدادات أو البوت) تجد شاشاتها — لا مسار يتيماً
 * 3) حسابات كل وحدة موجودة في شجرة الحسابات المعيارية (إيراد/تكلفة/ذمم)
 * 4) السلف والخصومات والمسيرات والعُهد متاحة لكل الأنشطة (قسم عام غير مشروط بوحدة)
 * تشغيل: node --experimental-strip-types scripts/verify_activity_coverage.mjs
 */
import { readFileSync } from 'node:fs'
import { ACTIVITY_TEMPLATES, ALL_MODULES, MODULE_LABELS, toggleModuleList } from '../src/core/activities.ts'
import { STANDARD_COA } from '../src/core/ledger.ts'

/* navCatalog.tsx يحتوي JSX فلا يُستورد في Node — نحلله نصياً بنفس الدقة */
const navSrc = readFileSync(new URL('../src/ui/navCatalog.tsx', import.meta.url), 'utf8')
const bodyStart = navSrc.indexOf('NAV_SECTIONS: NavSection[] = [')
const body = navSrc.slice(bodyStart)
const NAV_SECTIONS = []
const secRe = /id: '([^']+)', nameAr: '([^']+)', icon: \w+, color: '\w+'(?:, module: '(\w+)')?(?:, accountingOnly: true)?,\s*children: \[([\s\S]*?)\],\s*\n  \}/g
let m
while ((m = secRe.exec(body))) {
  const children = []
  const childRe = /\{ id: '([^']+)', nameAr: '([^']+)', icon: \w+, path: '([^']+)'(?:, module: '(\w+)')? \}/g
  let c
  while ((c = childRe.exec(m[4]))) children.push({ id: c[1], nameAr: c[2], path: c[3], module: c[4] })
  NAV_SECTIONS.push({ id: m[1], nameAr: m[2], module: m[3], children })
}
if (NAV_SECTIONS.length < 10) { console.log('❌ فشل تحليل navCatalog — عدّل السكربت'); process.exit(1) }

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) } }

const appTsx = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const routedPaths = new Set([...appTsx.matchAll(/Route path="([^"]+)"/g)].map((m) => m[1]))

console.log('🗺️ كل مسار في كتالوج التنقل له صفحة مسجلة (لا شاشة بيضاء أبداً)')
for (const sec of NAV_SECTIONS) {
  for (const c of sec.children) {
    ok(`${sec.nameAr} ← ${c.nameAr} (${c.path})`, routedPaths.has(c.path))
  }
}

console.log('\n🧩 كل وحدة عمل لها قسم/فرع في التنقل — أي نشاط يفعّلها يرى شاشاتها')
const modulesInNav = new Set()
for (const sec of NAV_SECTIONS) {
  if (sec.module) modulesInNav.add(sec.module)
  for (const c of sec.children) if (c.module) modulesInNav.add(c.module)
}
for (const m of ALL_MODULES) {
  ok(`وحدة «${MODULE_LABELS[m].nameAr}» (${m}) لها واجهة`, modulesInNav.has(m))
}

console.log('\n🏪 الأنشطة الـ16: وحدات معرفة + وحدة عمل واحدة على الأقل')
const workModules = ['pos', 'maintenance', 'equipment_rental', 'logistics', 'lab', 'contracting', 'clinic', 'cars']
for (const a of ACTIVITY_TEMPLATES) {
  const allKnown = a.modules.every((m) => ALL_MODULES.includes(m))
  const hasWork = a.modules.some((m) => workModules.includes(m))
  ok(`${a.icon} ${a.nameAr}: وحدات سليمة وعمل موجود`, allKnown && hasWork,
    !allKnown ? 'وحدة غير معرفة' : 'بلا وحدة عمل')
}

console.log('\n🔀 محاكاة البوت/الإعدادات: تفعيل كل وحدة على كل نشاط ثم إطفاؤها')
let toggleOk = true
for (const a of ACTIVITY_TEMPLATES) {
  for (const m of ALL_MODULES) {
    let mods = [...a.modules]
    try {
      if (!mods.includes(m)) {
        mods = toggleModuleList(mods, m) // تفعيل
        if (!mods.includes(m)) toggleOk = false
        mods = toggleModuleList(mods, m) // إطفاء
        if (mods.includes(m)) toggleOk = false
      }
    } catch { toggleOk = false }
  }
}
ok('كل تفعيل/إطفاء لأي وحدة على أي نشاط يعمل', toggleOk)
// وإطفاء آخر وحدة عمل يُرفض دائماً
let lastWorkGuard = true
for (const a of ACTIVITY_TEMPLATES) {
  const works = a.modules.filter((m) => workModules.includes(m))
  if (works.length === 1) {
    try { toggleModuleList(a.modules, works[0]); lastWorkGuard = false } catch { /* متوقع */ }
  }
}
ok('إطفاء آخر وحدة عمل يُرفض في كل الأنشطة', lastWorkGuard)

console.log('\n📒 حسابات كل وحدة موجودة في الشجرة المعيارية')
const codes = new Set(STANDARD_COA.map((a) => a.code))
const MODULE_ACCOUNTS = {
  pos: ['4101', '4102', '5101', '1103', '1104', '2102'],
  inventory: ['1103'],
  purchases: ['2101', '1103'],
  maintenance: ['4103'],
  equipment_rental: ['4104', '2103', '5105'],
  logistics: ['4105', '5106'],
  lab: ['4106', '5109', '2105'],
  contracting: ['4107', '5110', '1105'],
  clinic: ['4108'],
  cars: ['4101', '5101', '1103'],
  installments: ['1104'],
}
for (const [m, accts] of Object.entries(MODULE_ACCOUNTS)) {
  const missing = accts.filter((c) => !codes.has(c))
  ok(`حسابات «${MODULE_LABELS[m].nameAr}» كاملة`, missing.length === 0, missing.join('،'))
}

console.log('\n👥 الرواتب والسلف والعُهد لكل الأنشطة (قسم عام غير مشروط)')
const parties = NAV_SECTIONS.find((s) => s.id === 'parties')
ok('قسم «العملاء والموظفون» غير مربوط بوحدة', parties && !parties.module)
ok('الموظفون (مسيرات وسلف وخصومات) بلا شرط وحدة', parties.children.find((c) => c.id === 'employees' && !c.module) != null)
ok('ملفات عهد الموظفين بلا شرط وحدة', parties.children.find((c) => c.id === 'custody' && !c.module) != null)
for (const acct of ['5102', '2104', '1107', '1108', '2107']) {
  ok(`حساب الرواتب/السلف/العهد ${acct} معرف`, codes.has(acct))
}

console.log('\n🧾 حسابات النظام الحرجة العامة')
for (const acct of ['1101', '1102', '1106', '2106', '3101', '3102', '5107', '1201', '1202', '5108']) {
  ok(`حساب ${acct} معرف`, codes.has(acct))
}

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 كل نشاط مغطى: شاشات + مسارات + حسابات + رواتب وسلف وعهد للجميع')
