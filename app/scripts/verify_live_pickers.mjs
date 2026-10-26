/**
 * 🔎 فحص دائم — المنتقي الحي الموحّد (طلب المالك — بندا ٥ و٩):
 *  أ) سلوك: إنشاء موظف سريع بنفس شكل نافذة الموظف الابنة يمرّ بحرّاس المستودع
 *     (تطابق الاسم يُرفض)، وإنشاء مشروع سريع يعيد مشروعاً مرقّماً، والتعديل يعمل.
 *  ب) النوافذ: الأنواع الثلاثة مسجلة مع أيقوناتها وحالاتها في المضيف،
 *     والفاتحات موجودة بعناوينها ومنع تكرار لكل أم.
 *  ج) اللوحات: بنفس تصميم منتقي الأصناف (بحث/مرشّحات/أزرار إنشاء وتعديل وكشف)
 *     وموسومة للفحص، ونافذة المنتقي تصل الإنشاء بنوافذ ابنة تعود بالاختيار.
 *  د) الأسلاك: النقر المزدوج على عميل البيع ومشروع الفاتورة وموظف العمولة
 *     ومورّد الشراء ومشروع/مورّد نافذة المصروف يفتح المنتقي الحي.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_live_pickers.mjs
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
const eq = (a, b, name) => { assert.equal(a, b, `${name} — الفعلي ${a}`); pass++; console.log('  ✓', name) }

const { useDataStore } = await import(`${pathToFileURL(join(root, 'src/data/repo.ts')).href}?livepick=1`)
const S = () => useDataStore.getState()
S().seed([])
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }

// إنشاء موظف سريع بنفس شكل نافذة «موظف جديد» الابنة
S().addEmployee({ ...EXT, nameAr: 'مهندس الموقع', phone: '0100', jobTitle: 'مهندس تنفيذ', roleId: null, hireDate: '2026-10-01', baseSalaryMinor: 1500000, allowancesMinor: 200000, active: true, notes: '' })
const emp = S().employees.at(-1)
ok(emp?.nameAr === 'مهندس الموقع' && emp.active, 'أ: إنشاء موظف سريع يعمل')
assert.throws(() => S().addEmployee({ ...EXT, nameAr: 'مهندس الموقع', phone: '', jobTitle: '', roleId: null, hireDate: '2026-10-01', baseSalaryMinor: 0, allowancesMinor: 0, active: true, notes: '' }), /نفس الاسم/)
pass++; console.log('  ✓ أ: تكرار اسم الموظف يُرفض من الحارس')
S().updateEmployee(emp.id, { jobTitle: 'مدير موقع' })
eq(S().employees.find((e) => e.id === emp.id)?.jobTitle, 'مدير موقع', 'أ: تعديل الموظف السريع يعمل')

// إنشاء مشروع سريع بنفس شكل النافذة الابنة
const prj = S().addProject({ nameAr: 'برج سكني — مدينة نصر', clientName: 'شركة الإسكان', clientId: null, contractValueMinor: 50000000, retentionPercent: 10, startDate: '2026-10-01', notes: '' })
ok(/^PRJ-\d{4}$/.test(prj.code) && prj.status === 'active', 'أ: مشروع سريع مرقّم PRJ ونشط')
S().updateProject(prj.id, { nameAr: 'برج سكني — المرحلة أ' })
eq(S().projects.find((p) => p.id === prj.id)?.nameAr, 'برج سكني — المرحلة أ', 'أ: تعديل المشروع السريع يعمل')

const read = (rel) => readFileSync(join(root, rel), 'utf8')
const store = read('src/ui/windows/windowStore.ts')
const host = read('src/ui/windows/WindowHost.tsx')
const pickers = read('src/ui/components/KeyboardPickers.tsx')
const views = read('src/ui/windows/EntityPickerWindows.tsx')
const sales = read('src/ui/pages/AdvancedSalesInvoicePage.tsx')
const purchase = read('src/ui/pages/AdvancedPurchaseInvoicePage.tsx')
const expenseWin = read('src/ui/windows/ProjectExpenseWindowView.tsx')

for (const kind of ['entity-picker', 'project-editor', 'employee-editor']) {
  ok(store.includes(`| '${kind}'`), `ب: نوع النافذة ${kind} مسجل`)
  ok(host.includes(`'${kind}':`), `ب: أيقونة ${kind} في المضيف`)
  ok(host.includes(`case '${kind}':`), `ب: حالة عرض ${kind} في المضيف`)
}
ok(store.includes('export function openEntityPickerWindow'), 'ب: فتّاح المنتقي الحي')
ok(store.includes('export function openProjectEditorWindow') && store.includes('export function openEmployeeEditorWindow'), 'ب: فتّاحا المشروع والموظف السريعان')
ok(store.includes('entity-picker:${input.parentId}:${input.entity}'), 'ب: منع تكرار المنتقي لكل نافذة أم')

for (const panel of ['PartySearchPanel', 'ProjectSearchPanel', 'EmployeeSearchPanel']) {
  ok(pickers.includes(`export function ${panel}`), `ج: اللوحة ${panel} موجودة`)
}
ok(pickers.includes('function LivePanelShell'), 'ج: غلاف موحد بنفس تصميم بحث الأصناف')
for (const hook of ['data-live-picker-panel', 'data-live-picker-search', 'data-live-picker-create', 'data-live-picker-edit', 'data-live-picker-ledger']) {
  ok(pickers.includes(hook), `ج: علامة ${hook}`)
}
ok(pickers.includes('data-live-picker-dblclick') && pickers.includes('openEntityPickerWindow({ entity: entityKind'), 'ج: النقر المزدوج في منتقي الأطراف يفتح البحث الحي عند تحديد النوع')
ok(views.includes('openPartyEditorWindow(entity, 0, hostId, createdThenPick)'), 'ج: إنشاء العميل/المورد كنافذة ابنة تعود بالاختيار')
ok(views.includes('openProjectEditorWindow(0, hostId, createdThenPick)') && views.includes('openEmployeeEditorWindow(0, hostId, createdThenPick)'), 'ج: إنشاء المشروع/الموظف كنافذة ابنة تعود بالاختيار')
ok(views.includes('openPartyLedgerWindow(entity, id, hostId)'), 'ج: كشف الحساب من داخل المنتقي كنافذة ابنة')
ok(views.includes('data-project-editor-name') && views.includes('data-employee-editor-name'), 'ج: نموذجا الإنشاء السريع موسومان')

ok(sales.includes('entityKind={partyKind}'), 'د: نقر مزدوج على عميل فاتورة البيع يفتح منتقي العملاء')
ok(sales.includes('entityKind="employee"'), 'د: منتقي موظف العمولة الحي')
ok(sales.includes('data-invoice-project-live') && sales.includes("openEntityPickerWindow({entity:'project'"), 'د: مشروع الفاتورة بالنقر المزدوج يفتح بحث المشاريع')
ok(purchase.includes('entityKind="supplier"'), 'د: نقر مزدوج على مورد فاتورة الشراء')
ok(expenseWin.includes('entityKind="supplier"'), 'د: مورد نافذة المصروف بالمنتقي الحي')
ok(expenseWin.includes("entity: 'project'"), 'د: مشروع نافذة المصروف بالنقر المزدوج')

console.log(`\nPASS=${pass} FAIL=0`)
