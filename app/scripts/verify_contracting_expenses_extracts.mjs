/**
 * بوابة التحقق الشاملة (§96):
 * 1) قسم مستقل لمصروفات المشروعات (/contracting/expenses) بنافذة احترافية متعددة البنود
 *    الحرة (شامل الضريبة / غير شامل الضريبة / بدون ضريبة) وعزل الصافي على 5110 عن ضريبة 2102
 *    وخصمه من أرباح المشروع.
 * 2) قسم مستقل للمستخلصات كفواتير أعمال على العميل (/contracting/extracts) يظهر بنود BOQ
 *    بنسبة 0% افتراضياً في المستخلص الأول، ويظهر النسبة السابقة وبجانبها النسبة الجديدة في
 *    المستخلص الثاني، مع طباعة فاتورة احترافية للعميل كأنها فاتورة بيع ولكنها مستخلص.
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
const ok = (msg) => {
  pass++
  console.log(`  ✅ ${msg}`)
}

const {
  computeProjectExpenseLine,
  computeProjectExpenseInvoice,
} = await import(pathToFileURL(join(root, 'src/core/contracting.ts')).href)
const { renderExtractClientInvoiceHtml } = await import(pathToFileURL(join(root, 'src/ui/print/printExtract.ts')).href)
const { useDataStore } = await import(pathToFileURL(join(root, 'src/data/repo.ts')).href)

console.log('═══ ① فحص النواة: حساب بنود فاتورة مصروفات المشروع (شامل / غير شامل / بدون ضريبة) ═══')
{
  const lInclusive = computeProjectExpenseLine({
    description: 'توريد أسمنت وحديد شامل الضريبة',
    kind: 'materials',
    qty: 1,
    unitPriceMinor: 1140000, // 11,400.00
    taxMode: 'inclusive',
    vatPercent: 14,
  })
  assert.equal(lInclusive.netMinor, 1000000, 'شامل الضريبة: الصافي 10,000')
  assert.equal(lInclusive.vatMinor, 140000, 'شامل الضريبة: الضريبة 1,400')
  assert.equal(lInclusive.grossMinor, 1140000, 'شامل الضريبة: الإجمالي 11,400')
  ok('بند مصروف شامل الضريبة (14%): يفصل الصافي (10,000) عن الضريبة (1,400) بدقة الفلس')

  const lExclusive = computeProjectExpenseLine({
    description: 'مصنعية نجارة غير شامل الضريبة',
    kind: 'labor',
    qty: 2,
    unitPriceMinor: 250000, // 2 × 2,500 = 5,000
    taxMode: 'exclusive',
    vatPercent: 14,
  })
  assert.equal(lExclusive.netMinor, 500000, 'غير شامل الضريبة: الصافي 5,000')
  assert.equal(lExclusive.vatMinor, 70000, 'غير شامل الضريبة: الضريبة 700')
  assert.equal(lExclusive.grossMinor, 570000, 'غير شامل الضريبة: الإجمالي 5,700')
  ok('بند مصروف غير شامل الضريبة (+14%): الصافي 5,000 والضريبة 700 والإجمالي 5,700')

  const lNone = computeProjectExpenseLine({
    description: 'نقل وتشوين بدون ضريبة',
    kind: 'other',
    qty: 1,
    unitPriceMinor: 200000, // 2,000
    taxMode: 'none',
    vatPercent: 14,
  })
  assert.equal(lNone.netMinor, 200000)
  assert.equal(lNone.vatMinor, 0)
  assert.equal(lNone.grossMinor, 200000)
  ok('بند مصروف بدون ضريبة (0%): الصافي = الإجمالي = 2,000 والضريبة صفر')

  const inv = computeProjectExpenseInvoice([
    { description: 'توريد أسمنت', kind: 'materials', qty: 1, unitPriceMinor: 1140000, taxMode: 'inclusive', vatPercent: 14 },
    { description: 'مصنعية نجارة', kind: 'labor', qty: 2, unitPriceMinor: 250000, taxMode: 'exclusive', vatPercent: 14 },
    { description: 'نقل وتشوين', kind: 'other', qty: 1, unitPriceMinor: 200000, taxMode: 'none', vatPercent: 14 },
  ])
  assert.equal(inv.netMinor, 1700000)
  assert.equal(inv.vatMinor, 210000)
  assert.equal(inv.grossMinor, 1910000)
  ok('إجمالي فاتورة المصروفات متعددة البنود: صافي 17,000 + ضريبة 2,100 = إجمالي شامل 19,100')
}

console.log('\n═══ ② فحص المستودع والقيود: خصم صافي المصروف من أرباح المشروع + تدرج المستخلصات (0% ← سابقة/جديدة) ═══')
{
  const S = () => useDataStore.getState()

  S().addCustomer({
    nameAr: 'شركة التعمير العربية',
    phone: '01000000000',
    notes: '',
    taxNumber: '300-111-222',
    commercialReg: '',
    email: '',
    address: 'المنصورة',
    city: 'المنصورة',
    postalCode: '',
    buildingNo: '',
    nationalId: '',
    creditLimitMinor: 0,
  })
  const client = S().customers.at(-1)
  S().addSupplier({
    nameAr: 'مؤسسة الحديد والصلب',
    phone: '01200000000',
    notes: '',
    taxNumber: '',
    commercialReg: '',
    email: '',
    address: '',
    city: '',
    postalCode: '',
    buildingNo: '',
    nationalId: '',
    creditLimitMinor: 0,
  })
  const supplier = S().suppliers.at(-1)

  const prj = S().addProject({
    nameAr: 'مشروع أبراج النيل',
    clientName: client.nameAr,
    clientId: client.id,
    contractValueMinor: 100000000, // 1,000,000.00
    retentionPercent: 10,
    startDate: '2026-10-01',
    notes: '',
  })

  const boq1 = S().addBoqItem({
    projectId: prj.id,
    code: '1-1',
    descriptionAr: 'أعمال الحفر والأساسات',
    unit: 'م3',
    qty: 100,
    unitPriceMinor: 400000, // 400,000.00 total
    estCostMinor: 250000,
  })
  const boq2 = S().addBoqItem({
    projectId: prj.id,
    code: '1-2',
    descriptionAr: 'أعمال الخرسانة المسلحة',
    unit: 'م3',
    qty: 100,
    unitPriceMinor: 600000, // 600,000.00 total
    estCostMinor: 400000,
  })
  assert.equal(boq1.progressPercent, 0, 'نسبة البند الأول قبل أي مستخلص = 0%')
  assert.equal(boq2.progressPercent, 0, 'نسبة البند الثاني قبل أي مستخلص = 0%')
  ok('بنود المشروع (BOQ) تبدأ بنسبة 0% افتراضياً عند إنشاء المشروع')

  // إصدار المستخلص الأول: تعديل البند الأول فقط إلى 40% وبقاء البند الثاني 0%
  const ex1 = S().addProjectExtract({
    projectId: prj.id,
    extractLines: [{ boqItemId: boq1.id, newProgressPercent: 40 }],
    vatPercent: 14,
    payment: 'credit',
    description: 'المستخلص الأول — حفر وأساسات',
  })
  assert.equal(ex1.lines?.length, 1, 'المستخلص الأول يضم البند المعدل فقط')
  assert.equal(ex1.lines?.[0].prevProgressPercent, 0, 'النسبة السابقة في المستخلص الأول = 0%')
  assert.equal(ex1.lines?.[0].newProgressPercent, 40, 'النسبة الجديدة في المستخلص الأول = 40%')
  assert.equal(ex1.totals.grossMinor, 16000000, 'قيمة أعمال المستخلص الأول = 160,000')
  ok('المستخلص الأول: البنود غير المعدلة تظل 0%، والبند المعدل (0% ← 40%) يُفوتر بقيمته (160,000)')

  // إصدار المستخلص الثاني: البند الأول تظهر نسبته السابقة 40% ويرفعها المستخدم إلى 75%، والبند الثاني من 0% إلى 50%
  const ex2 = S().addProjectExtract({
    projectId: prj.id,
    extractLines: [
      { boqItemId: boq1.id, newProgressPercent: 75 },
      { boqItemId: boq2.id, newProgressPercent: 50 },
    ],
    vatPercent: 14,
    payment: 'credit',
    description: 'المستخلص الثاني — استكمال حفر وخرسانات',
  })
  const ex2Line1 = ex2.lines?.find((l) => l.boqItemId === boq1.id)
  const ex2Line2 = ex2.lines?.find((l) => l.boqItemId === boq2.id)
  assert.equal(ex2Line1?.prevProgressPercent, 40, 'المستخلص الثاني يحفظ النسبة السابقة 40% للبند الأول')
  assert.equal(ex2Line1?.newProgressPercent, 75, 'المستخلص الثاني يحفظ النسبة الجديدة 75% للبند الأول')
  assert.equal(ex2Line1?.lineValueMinor, 14000000, 'شريحة البند الأول = 35% × 400,000 = 140,000')
  assert.equal(ex2Line2?.prevProgressPercent, 0, 'البند الثاني كانت نسبته السابقة 0%')
  assert.equal(ex2Line2?.newProgressPercent, 50, 'البند الثاني نسبته الجديدة 50%')
  assert.equal(ex2Line2?.lineValueMinor, 30000000, 'شريحة البند الثاني = 50% × 600,000 = 300,000')
  assert.equal(ex2.totals.grossMinor, 44000000, 'إجمالي أعمال المستخلص الثاني = 440,000')
  ok('المستخلص الثاني: يرصد النسبة السابقة (40%) وبجانبها النسبة الجديدة (75%) ويحسب شريحة الفاتورة فقط (440,000)')

  // تسجيل فاتورة مصروفات متعددة البنود على المشروع
  const profitBefore = S().getProjectProfit(prj.id)
  assert.equal(profitBefore.extractedMinor, 60000000, 'إجمالي المستخلصات = 600,000')
  assert.equal(profitBefore.costsMinor, 0)
  assert.equal(profitBefore.profitMinor, 60000000)

  const expenseCost = S().addProjectCost({
    projectId: prj.id,
    payment: 'credit',
    supplierId: supplier.id,
    invoiceRef: 'SUP-INV-77',
    lines: [
      { description: 'حديد تسليح شامل الضريبة', kind: 'materials', qty: 1, unitPriceMinor: 11400000, taxMode: 'inclusive', vatPercent: 14 },
      { description: 'يوميات حدادين ونجارين غير شامل الضريبة', kind: 'labor', qty: 1, unitPriceMinor: 5000000, taxMode: 'exclusive', vatPercent: 14 },
      { description: 'تشوين ونقل موقع بدون ضريبة', kind: 'other', qty: 1, unitPriceMinor: 2000000, taxMode: 'none', vatPercent: 14 },
    ],
  })
  assert.equal(expenseCost.amountMinor, 17000000, 'صافي المصروف المحمّل على المشروع = 170,000')
  assert.equal(expenseCost.vatMinor, 2100000, 'ضريبة المدخلات المعزولة = 21,000')
  assert.equal(expenseCost.grossMinor, 19100000, 'إجمالي الفاتورة الشامل = 191,000')

  const profitAfter = S().getProjectProfit(prj.id)
  assert.equal(profitAfter.costsMinor, 17000000, 'تكاليف المشروع زادت بالصافي فقط (170,000)')
  assert.equal(profitAfter.profitMinor, 43000000, 'ربح المشروع انخفض من 600,000 إلى 430,000')
  assert.equal(profitAfter.costsByKind.materials, 10000000, 'توزيع المواد = 100,000')
  assert.equal(profitAfter.costsByKind.labor, 5000000, 'توزيع العمالة = 50,000')
  assert.equal(profitAfter.costsByKind.other, 2000000, 'توزيع أخرى = 20,000')

  S().addEmployee({
    nameAr: 'موظف مصروف مشروع جزئي', phone: '', jobTitle: 'محاسب موقع', roleId: null,
    hireDate: '2026-10-01', baseSalaryMinor: 0, allowancesMinor: 0, active: true, notes: '',
    taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '',
  })
  const custodyEmployee = S().employees.at(-1)
  const custodyFile = S().openCustodyFile({ employeeId: custodyEmployee.id, projectId: prj.id, reason: 'مصروف مشروع جزئي', notes: '' })
  S().fundCustodyFile({ fileId: custodyFile.id, amountMinor: 600000, treasury: '1101', description: 'تعزيز اختبار المصروف الجزئي' })
  const partiallyPaidCost = S().addProjectCost({
    projectId: prj.id, kind: 'materials', amountMinor: 1000000, inputVatMinor: 140000,
    payment: 'mixed', paidMinor: 500000, supplierId: supplier.id, description: 'توريد جزئي من العهدة',
    custodyFileId: custodyFile.id,
  })
  const partialCostEntry = S().journal.find((entry) => entry.sourceType === 'project_cost' && entry.sourceId === partiallyPaidCost.id)
  const entryAmount = (code, side) => partialCostEntry?.lines.filter((line) => line.accountCode === code).reduce((sum, line) => sum + line[side], 0) ?? 0
  assert.equal(partiallyPaidCost.grossMinor, 1140000)
  assert.equal(partiallyPaidCost.paidMinor, 500000)
  assert.equal(partiallyPaidCost.dueMinor, 640000)
  assert.equal(partiallyPaidCost.custodyFileId, custodyFile.id)
  assert.equal(entryAmount('1108', 'credit'), 500000, 'العهدة تُحمّل المدفوع فقط')
  assert.equal(entryAmount('2101', 'credit'), 640000, 'الباقي الدائن على المورد')
  assert.equal(entryAmount('1101', 'credit'), 0, 'لا خصم من الخزينة عند اختيار العهدة')
  assert.equal(S().getCustodySummary(custodyFile.id).spentMinor, 500000)
  assert.equal(S().getCustodySummary(custodyFile.id).remainingMinor, 100000)
  ok('السداد الجزئي من العهدة: يُخصم المدفوع فقط من 1108، والمتبقي الآجل على 2101 للمورد')

  for (const entry of S().journal) {
    const d = entry.lines.reduce((s, l) => s + l.debit, 0)
    const c = entry.lines.reduce((s, l) => s + l.credit, 0)
    assert.equal(d, c, `القيد #${entry.id} متوازن`)
  }
  ok('تسجيل فاتورة المصروفات يخفض ربح المشروع بالصافي (170,000) ويعزل الضريبة (21,000) على 2102 بقيد متوازن')
}

console.log('\n═══ ③ فحص طباعة فاتورة المستخلص للعميل والواجهات المستقلة ═══')
{
  const html = renderExtractClientInvoiceHtml({
    shopName: 'شركة الدلتا للمقاولات',
    shopPhone: '01012345678',
    shopAddress: 'المنصورة — حي الجامعة',
    shopTaxId: '100-200-300',
    extractNumber: 'PRX-0002',
    dateIso: '2026-10-19',
    projectName: 'مشروع أبراج النيل',
    projectCode: 'PRJ-0001',
    contractNumber: 'CNT-99',
    clientName: 'شركة التعمير العربية',
    clientPhone: '01000000000',
    clientTaxId: '300-111-222',
    contractValue: '1,000,000 ج.م',
    description: 'المستخلص الثاني',
    previousGross: '160,000 ج.م',
    currentGross: '440,000 ج.م',
    cumulativeGross: '600,000 ج.م',
    progressPercent: 60,
    vat: '61,600 ج.م',
    retention: '44,000 ج.م',
    retentionPercent: 10,
    due: '457,600 ج.م',
    payment: 'credit',
    currencySymbol: 'ج.م',
    lines: [
      {
        code: '1-1',
        descriptionAr: 'أعمال الحفر والأساسات',
        unit: 'م3',
        boqQty: 100,
        unitPrice: '4,000 ج.م',
        boqTotal: '400,000 ج.م',
        prevPercent: 40,
        newPercent: 75,
        currentSlicePercent: 35,
        value: '140,000 ج.م',
      },
    ],
  })
  assert.ok(html.includes('فاتورة مستخلص أعمال للعميل'), 'عنوان فاتورة المستخلص للعميل موجود')
  assert.ok(html.includes('النسبة السابقة') && html.includes('النسبة الجديدة'), 'أعمدة النسبة السابقة والنسبة الجديدة موجودة في الفاتورة المطبوعة')
  assert.ok(html.includes('40٪') && html.includes('75٪') && html.includes('+35٪'), 'قيم النسب السابقة والجديدة والشريحة مطبوعة بدقة')
  assert.ok(html.includes('صافي الفاتورة المستحق على العميل') && html.includes('457,600 ج.م'), 'صافي الفاتورة المستحق على العميل مطبوع بوضوح')
  ok('قالب «فاتورة مستخلص أعمال للعميل» يطبع فاتورة احترافية كاملة للعميل بالنسب السابقة والجديدة والصافي')

  const navSrc = readFileSync(join(root, 'src/ui/navCatalog.tsx'), 'utf8')
  const appSrc = readFileSync(join(root, 'src/App.tsx'), 'utf8')
  const pagesSrc = readFileSync(join(root, 'src/ui/pages/ContractingPages.tsx'), 'utf8')

  assert.ok(navSrc.includes("path: '/contracting/expenses'") && navSrc.includes("path: '/contracting/extracts'"), 'المساران المستقلان في كتالوج التنقل')
  assert.ok(appSrc.includes('path="/contracting/expenses"') && appSrc.includes('path="/contracting/extracts"'), 'المساران مربوطان في App.tsx')
  assert.ok(!pagesSrc.includes('setCostFor('), 'تم إلغاء زر ونافذة تسجيل التكلفة القديمة غير الاحترافية من بطاقات المشروعات')
  assert.ok(pagesSrc.includes('export function ProjectExpensesPage()') && pagesSrc.includes('export function ProjectExtractsPage()'), 'صفحتا مصروفات المشروعات والمستخلصات مصدرّتان')
  assert.ok(pagesSrc.includes('data-extract-client-invoice-print'), 'زر طباعة فاتورة للعميل موجود بجانب كل مستخلص')
  ok('التنقل والصفحات المستقلة وإلغاء الزر القديم وزر طباعة فاتورة المستخلص للعميل كلها محققة')
}

console.log(`\n🎉 اكتملت بوابة مصروفات المشروعات والمستخلصات بنجاح (${pass}/${pass})`)
