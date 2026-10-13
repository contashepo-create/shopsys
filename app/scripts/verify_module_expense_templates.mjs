/**
 * 🧾 بوابة قوالب مصروف الوحدات المضافة (فجوة ف4)
 * ─────────────────────────────────────────────
 * كانت الوحدة المطعَّمة (مغسلة، سيارات، صيانة…) بلا بنود مصروف جاهزة في مركز
 * بنود المصروف، فيكتب المحاسب بنوداً من الصفر أو يستخدم «مصروفات عمومية».
 *
 * الفحص يثبت:
 *  ① كل وحدة من الثمانية عشر لها بند قالب واحد على الأقل (بلا وحدة صامتة).
 *  ② حساب كل قالب موجود في الشجرة القياسية **وحساب مصروف فعلاً** (جذر 5).
 *  ③ لا تكرار اسم داخل الوحدة، والاسم واضح (لا «أخرى»).
 *  ④ الشاشة تقرأ الكتالوج (لا نسخة ميتة) وتُضيف البند فعلاً بضغطة، مع منع الازدواج.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_module_expense_templates.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MODULE_EXPENSE_TEMPLATES, expenseTemplatesForModules } from '../src/core/moduleCatalog.ts'
import { ALL_MODULES, MODULE_LABELS } from '../src/core/activities.ts'
import { STANDARD_COA } from '../src/core/ledger.ts'

const page = readFileSync(new URL('../src/ui/pages/CostCentersPage.tsx', import.meta.url), 'utf8')
const accounts = new Map(STANDARD_COA.map((account) => [account.code, account]))

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

console.log('\n🧾 قوالب مصروف الوحدات المضافة\n')

/* ① كل وحدة لها بند */
let total = 0
for (const module of ALL_MODULES) {
  const rows = MODULE_EXPENSE_TEMPLATES[module]
  assert.ok(Array.isArray(rows) && rows.length >= 1, `الوحدة «${MODULE_LABELS[module]?.nameAr ?? module}» بلا بند مصروف قالب`)
  total += rows.length
}
ok(`١٨ وحدة × ${ALL_MODULES.length === 18 ? 'بنودها' : 'الوحدات'}: ${total} بند قالب — لا وحدة صامتة`)

/* ② الحساب موجود وحساب مصروف */
for (const module of ALL_MODULES) {
  for (const template of MODULE_EXPENSE_TEMPLATES[module]) {
    const account = accounts.get(template.accountCode)
    assert.ok(account, `حساب غير موجود في الشجرة: ${template.accountCode} (قالب «${template.nameAr}»)`)
    assert.equal(account.rootType, 'expenses', `الحساب ${template.accountCode} ليس حساب مصروف (${account.nameAr})`)
    assert.ok(template.nameAr.trim().length >= 5, `اسم قالب قصير/غامض في ${module}: «${template.nameAr}»`)
  }
}
ok(`${total} قالباً كلها على حسابات مصروف حقيقية من الشجرة القياسية`)

/* ③ لا تكرار داخل الوحدة */
for (const module of ALL_MODULES) {
  const names = MODULE_EXPENSE_TEMPLATES[module].map((t) => t.nameAr)
  assert.equal(new Set(names).size, names.length, `اسم قالب مكرر في ${module}`)
  assert.ok(MODULE_EXPENSE_TEMPLATES[module].length <= 4, `قوالب ${module} أكثر من ٤ — القالب للدوري لا للحصر`)
}
ok('لا تكرار ولا إفراط: القالب للمصروف الدوري لا لكل مصروف')

/* ④ الشاشة تقرأ الكتالوج وتُضيف فعلاً */
assert.ok(/expenseTemplatesForModules\(effectiveModules\(/.test(page), 'شاشة بنود المصروف لا تقرأ كتالوج الوحدات')
assert.ok(/data-module-templates/.test(page) && /data-module-template=/.test(page), 'لا معرّف لبطاقة القوالب في الشاشة')
assert.ok(/addExpenseTemplate\(\{/.test(page), 'الضغطة لا تُضيف بنداً فعلياً')
assert.ok(/const added = expenseTemplates\.some\(/.test(page), 'لا منع لازدواج القالب')
assert.ok(/module !== 'pos' && module !== 'inventory' && module !== 'purchases'/.test(page), 'البطاقة تعرض قوالب النواة بدل الأقسام المضافة')
const expanded = expenseTemplatesForModules(ALL_MODULES)
assert.equal(expanded.length, total, 'الدالة لا تُرجع كل القوالب')
assert.ok(expanded.every((row) => ALL_MODULES.includes(row.module)), 'دالة التوسيع تُرجع وحدة مجهولة')
ok('الشاشة تقرأ الكتالوج وتُضيف البند بضغطة بلا ازدواج — لا كتالوج ميت')

console.log(`\n✅ قوالب مصروف الوحدات: ${pass} مجموعة تحقق — كلها خضراء\n`)
