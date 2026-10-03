/* بوابة دفعة المالك (جولة المعاينة الحية والكشف الموحد):
   1) كشف حساب الموظف الموحّد: مسيرات وقسائم وسلف وخصومات وسندات وعمولات وعهدات — بلا ازدواج
   2) الخدمة (isService) لا يظهر لها عجز مخزون في فاتورة البيع
   3) اختيار موظف التحصيل يكتب المبلغ المتبقي تلقائياً
   4) أخطاء المصروفات والعمولات تؤثر على زر المراجعة
   5) نافذة المصروفات الداخلية: أكبر بتابات وبطاقات بتفاصيل قابلة للفتح
   6) حالة التحصيل الحقيقية بجانب كل فاتورة (محصلة/جزئية/على موظف) بيعاً وشراءً
   7) التحكم بنظام الاعتماد من قسم الصلاحيات + إشعار المعتمِد الفوري
   الفحص الحي: سلفة + قسيمة راتب (خصم وسلفة مستقطعة) + سداد ⇒ رصيد الكشف صفر
   (لا ازدواج) — نفس معادلة 2104/1107. */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { reporter } from './auditKit.mjs'

const R = reporter('دفعة المعاينة الحية · كشف الموظف الموحد · حالات التحصيل')
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')

const repo = read('data/repo.ts')
const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')
const statements = read('ui/pages/StatementsPage.tsx')
const employees = read('ui/pages/EmployeesPage.tsx')
const salesList = read('ui/pages/SalesInvoicesPage.tsx')
const purchasesList = read('ui/pages/PurchasesPage.tsx')
const permsPage = read('ui/pages/PermissionsPage.tsx')
const menu = read('ui/layout/MenuBar.tsx')

/* ═══ 1) كشف حساب الموظف الموحّد ═══ */
{
  const i = repo.indexOf('getEmployeeStatementRows: (employeeId) => {')
  const block = repo.slice(i, repo.indexOf('getEmployeeBalance:', i))
  for (const marker of ['payrollSlips', 'payrollRuns', 'employeeAdvances', 'advanceRepayments', "partyKind === 'employee'", 'staffCommissions', 'custodyTxs', 'employeeDeductions'])
    assert.ok(block.includes(marker), `كشف الموظف لا يشمل ${marker}`)
  /* قاعدة عدم الازدواج: استحقاق القسيمة دائن بالصافي (لا الإجمالي)،
     واستقطاع السلفة دائن (سداد دينها) لا مدين، والخصم بند توثيقي في البيان */
  assert.ok(/creditMinor: slip\.netMinor/.test(block), 'استحقاق القسيمة ليس دائناً بالصافي (ازدواج محاسبي)')
  assert.ok(/creditMinor: slip\.advanceMinor/.test(block), 'استقطاع السلفة ليس دائناً — الازدواج عاد')
  assert.ok(!/debitMinor: slip\.deductionsMinor/.test(block), 'الخصومات لا تكون مدينة في الكشف')
  assert.ok(/المسيرات القديمة \(postPayroll المباشر\)/.test(block), 'المسيرات القديمة غائبة عن الكشف')
  assert.ok(/payMode === 'accrue'/.test(block), 'المسير الآجل (2104) لا يظهر دائناً بالصافي')
  assert.ok(statements.includes('getEmployeeStatementRows(partyId)'), 'صفحة كشوف الحساب لا تستخدم المصدر الموحد للموظف')
  assert.ok(employees.includes('getEmployeeStatementRows(statementFor)'), 'كشف الموظفين داخل شاشة الموظف لا يستخدم المصدر الموحد')
  R.ok('كشف حساب الموظف الموحّد: قسائم + مسيرات + سلف + سداد + سندات + عمولات + عهدات + جزاءات — بلا ازدواج')
}

/* ═══ 2) الخدمة لا عجز مخزون عليها ═══ */
{
  assert.ok(/isService\?undefined:/.test(sales), 'صنف الخدمة ما زال يدخل فحص عجز المخزون')
  R.ok('صنف الخدمة (isService) بلا فحص مخزون في فاتورة البيع')
}

/* ═══ 3) المبلغ المتبقي تلقائياً عند اختيار موظف التحصيل ═══ */
{
  assert.ok(/const pickCollectionEmployee=/.test(sales) && /كُتب المتبقي/.test(sales), 'اختيار موظف التحصيل لا يكتب المبلغ تلقائياً')
  assert.ok(/onChange=\{pickCollectionEmployee\}/.test(sales), 'حقل الموظف لا يمرّ بدالة الملء التلقائي')
  assert.ok(/payRows\.some\(row=>row\.method==='staff'\)/.test(sales), 'سطر الموظف لا يُضاف تلقائياً في التحصيل المتعدد')
  R.ok('اختيار موظف التحصيل: المبلغ المتبقي تلقائي + سطر الموظف يُضاف في التحصيل المتعدد')
}

/* ═══ 4) أخطاء المصروفات والعمولات في زر المراجعة ═══ */
{
  for (const marker of ['exp-label-', 'exp-amount-', 'exp-account5-', 'exp-2101-', 'exp-alloc-', 'commission-value', 'comm-emp-', 'comm-val-'])
    assert.ok(sales.includes(`id:\`${marker}`) || sales.includes(`id:'${marker}`), `فحص ${marker} غائب عن زر المراجعة`)
  R.ok('زر المراجعة يفحص المصروفات الداخلية (بيان/قيمة/حساب 5xxx/2101/توزيع) والعمولات')
}

/* ═══ 5) نافذة المصروفات الداخلية المنظمة ═══ */
{
  assert.ok(sales.includes('data-internal-expenses-modal'), 'نافذة المصروفات الجديدة غير معلَّمة')
  assert.ok(/Modal open={internalExpensesOpen}[\s\S]{0,300}?extraWide/.test(sales), 'النافذة ليست أكبر (extraWide)')
  assert.ok(sales.includes('data-expense-tab="expenses"') && sales.includes('data-expense-tab="commissions"'), 'لا تابات فاصلة للمصروفات والعمولات')
  assert.ok(sales.includes('data-expense-details='), 'لا زر تفاصيل لكل مصروف')
  assert.ok(sales.includes('data-expense-advanced='), 'الحقول المتقدمة ليست في قسم قابل للفتح')
  R.ok('نافذة المصروفات: أكبر (extraWide) بتابات (مصروفات/عمولات) وبطاقة مختصرة بتفاصيل قابلة للفتح')
}

/* ═══ 6) حالة التحصيل الحقيقية بجانب كل فاتورة ═══ */
{
  for (const marker of ['data-collection-status', 'على موظف', 'جزئية'])
    assert.ok(salesList.includes(marker), `قائمة فواتير البيع تنقصها حالة «${marker}»`)
  assert.ok(salesList.includes("a.accountCode === '1107'") && salesList.includes('a.employeeId != null'), 'حالة البيع لا تكتشف التحصيل على حساب موظف')
  for (const marker of ['data-payment-status', 'من عهدة', 'جزئية'])
    assert.ok(purchasesList.includes(marker), `قائمة فواتير الشراء تنقصها حالة «${marker}»`)
  assert.ok(purchasesList.includes('p.custodyFileId != null'), 'حالة الشراء لا تكتشف السداد من عهدة موظف')
  R.ok('حالة التحصيل/السداد الحقيقية: محصلة · جزئية · على موظف/عهدة · آجلة — بيعاً وشراءً')
}

/* ═══ 7) الاعتماد من قسم الصلاحيات + إشعار المعتمِد ═══ */
{
  assert.ok(permsPage.includes('ApprovalSettingsCard'), 'قسم الصلاحيات لا يعرض إعدادات نظام الاعتماد')
  assert.ok(/مستند بانتظار اعتمادك/.test(menu) && /approvalsToastReady/.test(menu) && /toast\.show\(/.test(menu), 'لا إشعار فوري للمعتمِد عند وصول مستندات جديدة')
  R.ok('التحكم بنظام الاعتماد من قسم الصلاحيات + إشعار فوري للمعتمِد')
}

/* ═══ الفحص الحي: رصيد كشف الموظف صفر بعد سلفة استُقطعت من راتبه ═══ */
{
  const mem = new Map()
  globalThis.localStorage = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
    key: (i) => [...mem.keys()][i] ?? null,
    get length() { return mem.size },
  }
  globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
  mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'general', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))
  const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
  const st = () => useDataStore.getState()
  const okLive = (name) => console.log('  ✓ [حي]', name)

  /* موظف راتبه 5,000: سلفة 1,000 ثم قسيمة راتب بخصم 500 وسلفة 1,000 مستقطعة
     ⇒ يستلم نقداً: 1,000 + 3,500 = 4,500 = استحقاقه بعد الخصم ⇒ الرصيد صفر */
  st().addEmployee({ nameAr: 'موظف الكشف الموحد', phone: '', jobTitle: 'محاسب', baseSalaryMinor: 500000, allowancesMinor: 0, hireDate: '2026-01-01', active: true, notes: '' })
  const employee = st().employees.at(-1)
  st().grantEmployeeAdvance({ employeeId: employee.id, amountMinor: 100000, notes: 'سلفة قبل الراتب', treasury: '1101' })
  const slips = st().accruePayrollSlips({
    month: '2026-09',
    rows: [{ employeeId: employee.id, grossMinor: 500000, allowancesMinor: 0, deductionsMinor: 50000, advanceMinor: 100000, notes: 'خصم جزاء واستقطاع السلفة' }],
  })
  assert.equal(slips.length, 1, 'قسيمة واحدة')
  assert.equal(slips[0].netMinor, 350000, 'الصافي 3,500')
  st().payPayrollSlip(slips[0].id, { treasury: '1101' })

  const rows = st().getEmployeeStatementRows(employee.id)
  const advanceRow = rows.find((row) => row.ref.startsWith('ADV-'))
  assert.ok(advanceRow && advanceRow.debitMinor === 100000, 'سطر السلفة النقدية مدين')
  const accrualRow = rows.find((row) => row.description.includes('استحقاق راتب'))
  assert.ok(accrualRow && accrualRow.creditMinor === 350000, 'الاستحقاق دائن بالصافي فقط (لا ازدواج)')
  const recoveredRow = rows.find((row) => row.description.includes('سلفة استُردت'))
  assert.ok(recoveredRow && recoveredRow.creditMinor === 100000, 'استرداد السلفة دائن يصفّي دينها')
  const paidRow = rows.find((row) => row.description.includes('صرف راتب'))
  assert.ok(paidRow && paidRow.debitMinor === 350000, 'الصرف مدين بالصافي')
  const balance = st().getEmployeeBalance(employee.id)
  assert.equal(balance, 0, `الرصيد يجب أن يكون صفراً — كان ${balance} (ازدواج أو نقص)`)

  /* سند صرف سلفة جديدة باسم الموظف يظهر في الكشف ويحدّث رصيده كالعميل */
  st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '1107', amountMinor: 50000, description: 'سلفة إضافية', partyKind: 'employee', partyId: employee.id })
  const voucherRow = st().getEmployeeStatementRows(employee.id).find((row) => row.description.includes('سلفة إضافية'))
  assert.ok(voucherRow && voucherRow.debitMinor === 50000, 'سند السلفة باسم الموظف لا يظهر في كشفه')
  assert.equal(st().getEmployeeBalance(employee.id), -50000, 'رصيد الموظف لا يتحدث بالسلفة (عليه 500)')
  okLive('كشف الموظف الموحد: سلفة + قسيمة (خصم وسلفة مستقطعة) + صرف + سند ⇒ رصيد صفر ثم -500 بالسلفة الجديدة')
}

R.done()
