/**
 * 💸 فحص دائم — نافذة مصروف المشروع الحرة وتصنيفاته الحرة
 * (اعتماد المالك لنموذج N-04 الحي «بكل تفاصيلها» 2026-10-22):
 *  أ) القائمة مزروعة بالافتراضية المعتمدة وكل تصنيف مربوط بحوضه المحاسبي.
 *  ب) «أخرى…»: تصنيف جديد يُحفظ دائماً، والتكرار (بمسافات مختلفة) يعيد الموجود.
 *  ج) بند بتصنيف حر: المستودع يفرض kind واسم التصنيف من القائمة (لا يثق بالواجهة)،
 *     واللقطة تبقى على البند، والقيد متوازن والصافي على 5110.
 *  د) تصنيف غير موجود يُرفض؛ والمسار القديم (kind مباشر بلا تصنيف) سليم.
 *  هـ) التاريخ الاختياري يصل للمستند والقيد (مصروف بأثر رجعي).
 *  و) الواجهة: النافذة الحرة مسجلة وتُفتح من صفحة المصروفات، والمودال القديم ميت.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_project_expense_categories.mjs
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

const { useDataStore } = await import(`${pathToFileURL(join(root, 'src/data/repo.ts')).href}?pexcat=1`)
const S = () => useDataStore.getState()
S().seed([])

const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }
S().addCustomer({ nameAr: 'شركة العميل', phone: '0100', notes: '', creditLimitMinor: 0, ...EXT })
const client = S().customers.at(-1)
S().addSupplier({ nameAr: 'مورد الوقود', phone: '0120', notes: '', ...EXT })
const supplier = S().suppliers.at(-1)
const prj = S().addProject({ nameAr: 'برج النيل — المرحلة الأولى', clientName: client.nameAr, clientId: client.id, contractValueMinor: 100000000, retentionPercent: 10, startDate: '2026-10-01', notes: '' })

console.log('\n═══ أ) القائمة المزروعة وربط الأحواض ═══')
const cats0 = S().projectExpenseCategories
ok(cats0.length >= 9, `تصنيفات افتراضية مزروعة (${cats0.length})`)
const fuel = cats0.find((c) => c.nameAr === 'وقود ومحروقات')
eq(fuel?.kind, 'equipment', '«وقود ومحروقات» يؤول لحوض المعدات')
eq(cats0.find((c) => c.nameAr === 'مواد خام')?.kind, 'materials', '«مواد خام» يؤول لحوض المواد')
eq(cats0.find((c) => c.nameAr === 'عمالة يومية')?.kind, 'labor', '«عمالة يومية» يؤول لحوض العمالة')
ok(new Set(cats0.map((c) => c.kind)).size === 5, 'الأحواض الخمسة كلها ممثلة في الافتراضية')

console.log('\n═══ ب) «أخرى…» تنمو ولا تتكرر ═══')
const eng = S().addProjectExpenseCategory('أتعاب مكتب هندسي')
eq(eng.kind, 'other', 'تصنيف حر جديد بلا حوض صريح = أخرى')
eq(S().projectExpenseCategories.length, cats0.length + 1, 'حُفظ في قائمة المنشأة دائماً')
const again = S().addProjectExpenseCategory('  أتعاب   مكتب  هندسي ')
eq(again.id, eng.id, 'نفس الاسم بمسافات مختلفة يعيد الموجود (لا تكرار)')
eq(S().projectExpenseCategories.length, cats0.length + 1, 'القائمة لم تتضخم بالتكرار')
const wages = S().addProjectExpenseCategory('أجور مشرفين', 'labor')
eq(wages.kind, 'labor', 'تصنيف حر بحوض صريح من «تُحتسب ضمن»')
assert.throws(() => S().addProjectExpenseCategory('   '), /مطلوب/)
pass++; console.log('  ✓ اسم فارغ يُرفض')

console.log('\n═══ ج) بند بتصنيف حر: المستودع يفرض الحوض واللقطة ═══')
const journalBefore = S().journal.length
// الواجهة ترسل kind خاطئاً عمداً (labor) — يجب أن يفرض المستودع حوض التصنيف (equipment)
const cost = S().addProjectCost({
  projectId: prj.id,
  payment: 'mixed',
  paidMinor: 300000,
  supplierId: supplier.id,
  date: '2026-09-15',
  lines: [
    { description: 'سولار مولد الموقع — دفعة أسبوعية', kind: 'labor', categoryId: fuel.id, qty: 400, unitPriceMinor: 1750, taxMode: 'exclusive', vatPercent: 14 },
    { description: 'إشراف هندسي على صبة الأسقف', kind: 'materials', categoryId: eng.id, qty: 1, unitPriceMinor: 2500000, taxMode: 'none' },
  ],
})
eq(cost.lines[0].kind, 'equipment', 'بند الوقود: kind فُرض من التصنيف لا من الواجهة')
eq(cost.lines[0].categoryNameAr, 'وقود ومحروقات', 'لقطة اسم التصنيف محفوظة على البند')
eq(cost.lines[1].kind, 'other', 'بند الأتعاب الهندسية: حوض أخرى')
eq(cost.lines[1].categoryNameAr, 'أتعاب مكتب هندسي', 'لقطة التصنيف الحر الجديد محفوظة')
// صافي: 400×1750=700,000 (ضريبة 98,000 فوقه) + 2,500,000 = 3,200,000
eq(cost.amountMinor, 3200000, 'الصافي على المشروع = 32,000.00')
eq(cost.vatMinor, 98000, 'ضريبة المدخلات المعزولة = 980.00')
eq(cost.dueMinor, 3298000 - 300000, 'الآجل = الإجمالي الشامل − المدفوع')
const entry = S().journal.at(-1)
eq(S().journal.length, journalBefore + 1, 'قيد واحد جديد')
const debitSum = entry.lines.reduce((a, l) => a + l.debit, 0)
const creditSum = entry.lines.reduce((a, l) => a + l.credit, 0)
eq(debitSum, creditSum, 'القيد متوازن مدينةً ودائنةً')
eq(entry.lines.find((l) => l.accountCode === '5110')?.debit, 3200000, '5110 مديناً بالصافي فقط')

console.log('\n═══ د) الرفض والتوافق الرجعي ═══')
assert.throws(
  () => S().addProjectCost({ projectId: prj.id, payment: 'cash', lines: [{ description: 'بند وهمي', kind: 'other', categoryId: 99999, qty: 1, unitPriceMinor: 100, taxMode: 'none' }] }),
  /تصنيف المصروف غير موجود/,
)
pass++; console.log('  ✓ categoryId غير معروف يُرفض برسالة واضحة')
const legacy = S().addProjectCost({ projectId: prj.id, payment: 'cash', kind: 'materials', amountMinor: 50000, description: 'مصروف قديم الطراز بلا بنود' })
eq(legacy.kind, 'materials', 'المسار القديم (مبلغ مباشر + kind) لم يتأثر')
eq(legacy.lines, undefined, 'بلا بنود وبلا تصنيفات كما كان')

console.log('\n═══ هـ) التاريخ الاختياري ═══')
ok(cost.date.startsWith('2026-09-15'), 'تاريخ المستند = التاريخ المختار لا اليوم')
eq(entry.date, '2026-09-15', 'تاريخ القيد المحاسبي = نفس التاريخ')
ok(!legacy.date.startsWith('2026-09-15'), 'بلا تاريخ اختياري يبقى تاريخ اليوم')

console.log('\n═══ و) الواجهة: نافذة حرة مسجلة والمودال القديم ميت ═══')
const read = (p) => readFileSync(join(root, p), 'utf-8')
const view = read('src/ui/windows/ProjectExpenseWindowView.tsx')
const store = read('src/ui/windows/windowStore.ts')
const pages = read('src/ui/pages/ContractingPages.tsx')
const host = read('src/ui/windows/WindowHost.tsx')
ok(store.includes("kind: 'project-expense'") && store.includes('تصنيفات تنمو معك'), 'نوع النافذة مسجل بعنوان النموذج المعتمد')
ok(host.includes("case 'project-expense': return <ProjectExpenseWindowView />"), 'المضيف يرسم النافذة الجديدة')
ok(view.includes('أخرى… (تصنيف جديد)') && view.includes('addProjectExpenseCategory'), 'النافذة فيها «أخرى…» تنشئ تصنيفاً دائماً')
ok(view.includes('data-project-expense-paid') && view.includes('dueNowMinor') && !view.includes('paymentMode'), 'قاعدة «مدفوع واحد والباقي آجل آلياً» محفوظة في النافذة')
ok(view.includes('<PaySourcePicker linked'), 'مصدر المدفوع قائمتان مترابطتان كما كان')
ok(view.includes("openPartyEditorWindow('supplier', 0,"), 'زر «+ مورد» يفتح نافذة ابنة مملوكة لنافذة المصروف')
ok(pages.includes('openProjectExpenseWindow(') && !pages.includes('data-expense-simple-entry') && !pages.includes('ExpenseLineDraft'), 'الصفحة تفتح النافذة الحرة والمودال ذو المسارين اندثر')

console.log(`\nPASS=${pass} — تصنيفات حرة تنمو وتُحفظ، والحوض المحاسبي لا ينكسر أبداً`)
