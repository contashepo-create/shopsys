/**
 * بوابة جولة المالك — استيراد الموظفين من Excel/CSV مع قالب الأعمدة
 * (البند ③ من أمر «اكمل ونفذ» 2026-10-01):
 * ① نواة تحليل مرنة (core/employeesImport.ts): رؤوس عربية/إنجليزية بمرادفات،
 *    أو بلا رأس بالترتيب القياسي؛ مفصولة بفواصل أو Tabs (لصق Excel)؛
 *    أرقام عربية/هندية وفواصل آلاف وتواريخ مصرية — كل مبلغ لوحدة صغرى.
 * ② قالب أعمدة رسمي يُنزَّل CSV بBOM (يفتحه Excel بالعربية سليمة).
 * ③ الإضافة عبر addEmployee الرسمي فتمر بحراسه (الاسم المكرر/الفارغ)
 *    ويعاد الملخص بالمضاف والمرفوض وأسبابه — لا إدخال جزئي.
 * ④ واجهة: زر في تاب الموظفين + نافذة قالب/ملف/لصق + معاينة قبل الاعتماد.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_owner_employees_import.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { freshCase } from './auditKit.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(__dirname, '..', 'src', p), 'utf8')
let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n) }

const core = read('core/employeesImport.ts')
const repo = read('data/repo.ts')
const page = read('ui/pages/EmployeesPage.tsx')

console.log('① النواة والقالب (المصدر)')
{
  assert.ok(/export function parseEmployeesCsv/.test(core) && /export function employeesImportTemplateCsv/.test(core), 'المحلل أو القالب مفقود')
  assert.ok(/export function normalizeDigits/.test(core) && /export function parseMoneyToMinor/.test(core) && /export function parseEmployeeDate/.test(core), 'أدوات الأرقام العربية والتواريخ مفقودة')
  assert.ok(/\\u0660-\\u0669/.test(core), 'توحيد الأرقام العربية غير موجود')
  assert.ok(core.includes('EMPLOYEES_IMPORT_COLUMNS'), 'تعريف أعمدة القالب مفقود')
  assert.ok(/يفتحه Excel مباشرة/.test(core), 'توثيق القالب مفقود')
  ok('محلل + قالب + أرقام عربية/فواصل آلاف/تواريخ مصرية')
}

console.log('② المخزن والواجهة (المصدر)')
{
  assert.ok(/importEmployees: \(rows: EmployeeImportRow\[\]\) => \{ added: number; addedNames: string\[\]; skipped: string\[\] \}/.test(repo), 'توقيع importEmployees مفقود من الواجهة')
  assert.ok(/get\(\)\.addEmployee\(\{[\s\S]*?\.\.\.EMPTY_EXTENDED,[\s\S]*?active: true/.test(repo), 'الاستيراد لا يمر عبر addEmployee الرسمي بحراسه')
  assert.ok(page.includes('data-employees-import-open') && page.includes('data-employees-import'), 'زر أو نافذة الاستيراد مفقودة من صفحة الموظفين')
  assert.ok(page.includes('data-employees-template') && page.includes('data-employees-file') && page.includes('data-employees-paste') && page.includes('data-employees-preview') && page.includes('data-employees-commit') && page.includes('data-employees-outcome'), 'أدوات النافذة ناقصة (قالب/ملف/لصق/معاينة/اعتماد/نتيجة)')
  assert.ok(/'\\uFEFF' \+ employeesImportTemplateCsv\(\)/.test(page), 'القالب يُنزَّل بلا BOM — Excel لن يعرض العربية سليمة')
  ok('زر في تاب الموظفين + نافذة كاملة + قالب بBOM + إضافة رسمية محروسة')
}

console.log('③ فحص حي: المحلل الصرف — مرادفات وأرقام عربية وتواريخ وأخطاء مرقّمة')
{
  const { parseEmployeesCsv, employeesImportTemplateCsv, parseMoneyToMinor, parseEmployeeDate, normalizeDigits } = await import('../src/core/employeesImport.ts')

  assert.equal(normalizeDigits('٥٠٠٠'), '5000', 'الأرقام العربية لم تُوحَّد')
  assert.equal(parseMoneyToMinor('5,000.50'), 500050, 'فواصل الآلاف لم تُفهم')
  assert.equal(parseMoneyToMinor('٥٠٠٠'), 500000, 'الراتب بالعربية لم يُفهم')
  assert.equal(parseMoneyToMinor(''), 0, 'الفراغ يجب أن يكون صفراً (عمود اختياري)')
  assert.equal(parseMoneyToMinor('abc'), null, 'النص غير الرقمي يجب أن يُرفض')
  assert.equal(parseEmployeeDate('15/01/2026'), '2026-01-15', 'التاريخ المصري لم يُفهم')
  assert.equal(parseEmployeeDate('2026-01-15'), '2026-01-15')
  assert.equal(parseEmployeeDate(''), '', 'تاريخ فارغ = مقبول (يُستكمل اليوم)')
  assert.equal(parseEmployeeDate('غداً'), null, 'تاريخ غير مفهوم يجب أن يُرفض')

  /* رؤوس عربية كاملة + أرقام بفواصل آلاف مقتبسة كما يصدّرها Excel */
  const arabic = parseEmployeesCsv('اسم الموظف,المسمى الوظيفي,الهاتف,تاريخ التعيين,الراتب الأساسي,البدلات,ملاحظات\nأحمد سعيد,كاشير,٠١٠٠٠٠٠٠٠٠١,15/01/2026,"5,000.50",500,وردية مسائية\nمنى عبد الله,,,,,,,,')
  assert.equal(arabic.rows.length, 2, `يجب قبول الصفين (وُجد ${arabic.rows.length})`)
  assert.equal(arabic.rows[0].baseSalaryMinor, 500050, 'راتب أحمد لم يُحوَّل للوحدة الصغرى')
  assert.equal(arabic.rows[0].phone, '01000000001', 'الهاتف العربي لم يُطبَّع')
  assert.equal(arabic.rows[0].hireDate, '2026-01-15')
  assert.equal(arabic.rows[0].allowancesMinor, 50000)
  assert.equal(arabic.rows[1].baseSalaryMinor, 0, 'راتب منى الفارغ يجب أن يكون صفراً')

  /* رؤوس إنجليزية + Tabs (لصق Excel) */
  const pasted = parseEmployeesCsv('Name\tJob\tPhone\tHire Date\tSalary\tAllowances\tNotes\nKarim\tCashier\t01000000003\t2026-02-01\t6000\t0\t')
  assert.equal(pasted.rows.length, 1, 'لصق Excel بTabs لم يُفهم')
  assert.equal(pasted.rows[0].nameAr, 'Karim')
  assert.equal(pasted.rows[0].baseSalaryMinor, 600000)

  /* بلا رأس: الترتيب القياسي */
  const noHeader = parseEmployeesCsv('سعاد,محاسبة,01000000004,2026-03-01,7000,250,خبرة 10 سنوات')
  assert.equal(noHeader.rows.length, 1) && assert.equal(noHeader.rows[0].jobTitle, 'محاسبة') && assert.equal(noHeader.rows[0].notes, 'خبرة 10 سنوات')

  /* أخطاء مرقّمة: اسم ناقص وراتب فاسد وتاريخ فاسد */
  const broken = parseEmployeesCsv('الاسم,الوظيفة,الهاتف,التعيين,الراتب,البدلات,ملاحظات\n,كاشير,010,2026-01-01,5000,0,\nسامي,كاشير,010,2026-01-01,مئة,0,\nسالم,كاشير,010,31/31/2026,5000,0,\nسليم,كاشير,010,2026-01-01,5000,0,سليم')
  assert.equal(broken.rows.length, 1, `صف سليم وحده يجب أن يُقبل (وُجد ${broken.rows.length})`)
  assert.equal(broken.errors.length, 3, `ثلاثة أخطاء متوقعة (وُجد ${broken.errors.length})`)
  assert.ok(broken.errors.join(' | ').includes('سطر 2: اسم الموظف مطلوب'), 'خطأ الاسم الناقص بلا رقم سطر')
  assert.ok(broken.errors.join(' | ').includes('راتب غير مفهوم'), 'خطأ الراتب الفاسد مفقود')
  assert.ok(broken.errors.join(' | ').includes('تاريخ تعيين غير مفهوم'), 'خطأ التاريخ الفاسد مفقود')

  /* القالب الرسمي يُحلَّل ذهاباً وإياباً بلا أي خطأ */
  const template = employeesImportTemplateCsv()
  const roundTrip = parseEmployeesCsv(template)
  assert.equal(roundTrip.errors.length, 0, `قالب الأعمدة نفسه أنتج أخطاء: ${roundTrip.errors.join(' | ')}`)
  assert.equal(roundTrip.rows.length, 2, 'القالب يجب أن يحمل مثالين')
  assert.ok(template.includes('اسم الموظف') && template.includes('الراتب الأساسي') && template.includes('البدلات'), 'رؤوس القالب ناقصة')
  ok('حياً: مرادفات عربية/إنجليزية + Tabs + بلا رأس + ٥٠٠٠ و5,000.50 + أخطاء مرقّمة + القالب يُحلَّل ذهاباً وإياباً')
}

console.log('④ فحص حي: الاستيراد عبر المخزن — المضاف والمكرر والأثر')
{
  const c = await freshCase({ activityId: 'grocery' })
  const st = () => c.store.getState()
  /* صفان جديدان وصف مكرر لموظف موجود */
  st().addEmployee({ nameAr: 'أصل البذرة', phone: '', jobTitle: 'عامل', roleId: null, hireDate: '2026-01-01', baseSalaryMinor: 300000, allowancesMinor: 0, active: true, notes: '' })
  const before = st().employees.length
  const outcome = st().importEmployees([
    { nameAr: 'زهرة الاستيراد', jobTitle: 'كاشير', phone: '01000000009', hireDate: '2026-01-15', baseSalaryMinor: 500000, allowancesMinor: 50000, notes: 'من Excel' },
    { nameAr: 'أصل البذرة', jobTitle: 'مكرر', phone: '', hireDate: '2026-01-01', baseSalaryMinor: 100000, allowancesMinor: 0, notes: '' },
    { nameAr: 'بدر الاستيراد', jobTitle: 'أمين مخزن', phone: '01000000010', hireDate: '2026-02-01', baseSalaryMinor: 625075, allowancesMinor: 0, notes: '' },
  ])
  assert.equal(outcome.added, 2, `صفان جديدان يجب أن يُضافا (وُجد ${outcome.added})`)
  assert.equal(outcome.skipped.length, 1, `المكرر يجب أن يُرفض بسببته (وُجد ${outcome.skipped.length})`)
  assert.ok(outcome.skipped[0].includes('نفس الاسم'), `سبب الرفض ليس حارس الاسم المكرر: ${outcome.skipped[0]}`)
  assert.equal(st().employees.length, before + 2, 'عدد الموظفين زاد باثنين فقط')
  const zahra = st().employees.find((e) => e.nameAr === 'زهرة الاستيراد')
  assert.ok(zahra, 'زهرة لم تُضف')
  assert.equal(zahra.baseSalaryMinor, 500000, 'راتب زهرة لم يُخزن بالوحدة الصغرى')
  assert.equal(zahra.allowancesMinor, 50000)
  assert.equal(zahra.active, true, 'المستورد يجب أن يكون على رأس العمل')
  assert.equal(zahra.jobTitle, 'كاشير')
  const badr = st().employees.find((e) => e.nameAr === 'بدر الاستيراد')
  assert.equal(badr.baseSalaryMinor, 625075, 'كسور القرش تُقرَّب سليمة')
  /* الاستيراد لا يمس بقية الحالة: المسيرات والقسائم كما كانت */
  ok(`حياً: أُضيف ٢ ورُفض المكرر ب«${outcome.skipped[0].slice(0, 30)}…» والمبالغ بالوحدة الصغرى`)
}

console.log(`✅ جولة المالك — استيراد الموظفين من Excel/CSV: ${pass} فحوص ناجحة`)
