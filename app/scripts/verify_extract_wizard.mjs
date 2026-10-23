/**
 * 🔎 فحص دائم — معالج إصدار المستخلص (تبسيط إنشاء المستخلص — حزمة المالك):
 *  أ) الأسلاك: صنف النافذة مسجل (متجر + مضيف + أيقونة)، والفاتح موجود،
 *     وزر «معالج سريع» بصفحة المشروعات، والخطوات الثلاث موسومة.
 *  ب) المحرك واحد: المعالج يرحّل عبر addProjectExtract نفسه (لا مسار موازٍ)،
 *     وحسابات العرض (computeExtractTotals/بنود) هي نفس دوال النواة.
 *  ج) سلوك بنفس وسائط المعالج: مستخلص مقطوعية باسترداد دفعة مقدمة يطابق
 *     أرقام بطاقة التسوية بالمعالج، ومستخلص بندي بنسب إنجاز يرفع التراكمي.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_extract_wizard.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const mem = new Map()
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 14, taxInclusive: true, activityId: 'contracting', countryCode: 'EG' }, license: { plan: 'pro' } } }))

let pass = 0
const ok = (cond, name) => { assert.ok(cond, name); pass++; console.log('  ✓', name) }
const eq = (a, b, name) => { assert.equal(a, b, `${name} — الفعلي ${a}، المتوقع ${b}`); pass++; console.log('  ✓', name) }
const src = (rel) => readFileSync(join(root, rel), 'utf8')

console.log('\n═══ أ+ب) الأسلاك ووحدة المحرك ═══')
{
  const store = src('src/ui/windows/windowStore.ts')
  ok(store.includes("'extract-wizard'"), 'صنف النافذة مسجل في AppWindowKind')
  ok(store.includes('export function openExtractWizardWindow'), 'الفاتح openExtractWizardWindow موجود')
  const host = src('src/ui/windows/WindowHost.tsx')
  ok(host.includes("'extract-wizard': FileCheck2") && host.includes("case 'extract-wizard': return <ExtractWizardWindowView />"), 'المضيف يعرف الصنف بأيقونته وعرضه')
  const view = src('src/ui/windows/ExtractWizardWindowView.tsx')
  ok(view.includes('data-wizard-steps') && view.includes('١ — المشروع') && view.includes('٣ — التسوية والاعتماد'), 'الخطوات الثلاث موسومة ومرسومة')
  ok(view.includes('data-wizard-mode="gross"') && view.includes('data-wizard-mode="lines"'), 'نمطا الأعمال: مبلغ إجمالي أو بنود كميات')
  ok(view.includes('data-wizard-totals') && view.includes('data-wizard-post'), 'بطاقة التسوية وزر الترحيل موجودان')
  ok(view.includes('addProjectExtract({'), 'الترحيل بنفس محرك الصفحة addProjectExtract — لا مسار موازٍ')
  ok(view.includes('computeExtractTotals(') && view.includes('computeExtractLines('), 'معاينة الأرقام بدوال النواة نفسها')
  ok(src('src/ui/pages/ContractingPages.tsx').includes('data-open-extract-wizard'), 'زر المعالج السريع في صفحة المشروعات')
  ok(view.includes('data-wizard-new-project') && view.includes('openProjectEditorWindow(0,'), 'المعالج ينشئ مشروعاً جديداً في نافذة ابنة ويختاره (+ جديد كاملة)')
}

console.log('\n═══ ج) سلوك بوسائط المعالج نفسها ═══')
const { useDataStore } = await import(`${pathToFileURL(join(root, 'src/data/repo.ts')).href}?exwizard=1`)
const { computeExtractTotals } = await import(pathToFileURL(join(root, 'src/core/contracting.ts')).href)
const S = () => useDataStore.getState()
S().seed([])
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }
S().addCustomer({ nameAr: 'الجهة المالكة', phone: '0100', notes: '', creditLimitMinor: 0, ...EXT })
const client = S().customers.at(-1)
const prj = S().addProject({ nameAr: 'مجمع سكني', clientName: client.nameAr, clientId: client.id, contractValueMinor: 50_000_000, retentionPercent: 10, startDate: '2026-10-01', notes: '' })
S().receiveClientAdvance({ projectId: prj.id, amountMinor: 10_000_000, treasury: '1101' })

/* نفس ما يبنيه المعالج في خطوته الثالثة: مقطوعية 200,000 + ضريبة 14٪ + استرداد 50,000 */
const preview = computeExtractTotals(20_000_000, 10, 14)
const ex = S().addProjectExtract({
  projectId: prj.id, grossMinor: 20_000_000, vatPercent: 14, payment: 'credit',
  description: 'أعمال خرسانات', treasury: '1101', advanceRecoveryMinor: 5_000_000, isFinal: false,
})
eq(ex.totals.grossMinor, preview.grossMinor, 'بطاقة المعالج = أرقام المستخلص (الأعمال)')
eq(ex.totals.vatMinor, preview.vatMinor, 'بطاقة المعالج = أرقام المستخلص (الضريبة)')
eq(ex.totals.retentionMinor, preview.retentionMinor, 'بطاقة المعالج = أرقام المستخلص (المحتجز)')
eq(ex.totals.dueMinor - (ex.advanceRecoveryMinor ?? 0), 20_000_000 + 2_800_000 - 2_000_000 - 5_000_000, 'المستحق بعد استرداد الدفعة كما تعرضه البطاقة')

/* مسار البنود: بند BOQ بنسبة إنجاز تراكمية */
S().addBoqItem({ projectId: prj.id, code: '1.1', descriptionAr: 'حفر وردم', unit: 'م3', qty: 100, unitPriceMinor: 10_000 })
const boq = S().boqItems.find((b) => b.projectId === prj.id)
const ex2 = S().addProjectExtract({
  projectId: prj.id, extractLines: [{ boqItemId: boq.id, newProgressPercent: 40 }],
  vatPercent: 14, payment: 'credit', description: 'شريحة بنود', treasury: '1101', advanceRecoveryMinor: 0, isFinal: false,
})
eq(ex2.totals.grossMinor, 400_000, 'شريحة 40٪ من بند 10,000 = 4,000 أعمال')

console.log(`\n✅ verify_extract_wizard PASS=${pass}`)
