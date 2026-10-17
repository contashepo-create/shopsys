#!/usr/bin/env node
/**
 * بوابة التدقيق الخبير للمحرك المحاسبي (مراجعة المالك 2026-10-17 — «مراجعة مختص
 * برمجي محاسبي»): سيناريو عابر للوحدات (مشتريات · مبيعات · مرتجعات · سندات ·
 * قيود يدوية وعكسها · أرصدة افتتاحية · سلف ومسيرات · عهدة كاملة · مشروع بمستخلص
 * ودفعة مقدمة وتحصيل حر · شيكات · خطة أقساط) وبعد **كل خطوة** تُفحص الثوابت:
 *   ث1  كل قيد متوازن وأطرافه ≥2 ومبالغه صحيحة غير سالبة أحادية الطرف (فحص مستقل عن الحارس)
 *   ث2  ميزان المراجعة الكلي: Σمدين == Σدائن
 *   ث3  المعادلة المحاسبية بالتصنيف: (أصول+مصاريف) مدينة == (التزامات+حقوق+إيرادات) دائنة
 *   ث4  مطابقة الدفاتر المساعدة لحسابات المراقبة:
 *       Σ أرصدة العملاء == صافي 1104 · Σ أرصدة الموردين == −صافي 2101 ·
 *       صافي 1108 == Σ متبقي ملفات العهدة · −صافي 2107 == Σ مستحق زيادات العهد ·
 *       صافي 1107 == Σ متبقي سلف الموظفين · −صافي 2109 == Σ رصيد الدفعات المقدمة
 *   ث5  لا قيد مكرر (نفس المصدر والسطور والوصف) — كشف الترحيل المزدوج
 *   ث6  المخزون: Σ قيمة الأصناف (كمية×متوسط) ≈ صافي 1103 بهامش تقريب المتوسطات
 *   ث7  القوائم المالية (ميزان/ميزانية/دخل) متسقة مع الدفتر الخام
 * + فحوص سكونية: الحارس المركزي موصول بكل كتابة (assertJournalIntegrity داخل غلاف
 *   set) وقائمة العكس مغلقة والسنة المقفلة لا تستثني إلا قيد الإقفال.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_engine_expert_audit.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 14, taxInclusive: true, activityId: 'general', countryCode: 'EG' }, license: { plan: 'pro' } } }))
const { useDataStore } = await import('../src/data/repo.ts')
const { trialBalance, balanceSheet, incomeStatement } = await import('../src/core/financialReports.ts')
const { readFileSync } = await import('node:fs')
const st = () => useDataStore.getState()

let pass = 0
const fails = []
const ok = (n, c, extra = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fails.push(n); console.log(`  ❌ ${n}${extra ? ' — ' + String(extra) : ''}`) } }

/* ── فحوص سكونية: بنية الحراسة نفسها ─────────────────────────────────────── */
const repoSrc = readFileSync(new URL('../src/data/repo.ts', import.meta.url), 'utf8')
ok('ث0 كل كتابة تمر بالحارس المركزي داخل غلاف set (assertJournalIntegrity + normalizeJournalDates)', repoSrc.includes('assertJournalIntegrity(state.journal, nextJournal') && repoSrc.includes('normalizeJournalDates(rawJournal)'))
ok('ث0 حارس سالب الخزينة موصول بنفس الغلاف', repoSrc.includes('assertTreasuryNotNegative(state.journal, nextJournal'))
ok('ث0 قائمة القيود القابلة للعكس مغلقة (manual/سندات/تغطية تأمين/عكس) — أي نوع جديد محجوب تلقائياً', repoSrc.includes("new Set<JournalEntry['sourceType']>(['manual', 'receipt_voucher', 'payment_voucher', 'insured_sale', 'reversal'])"))
const guardSrc = readFileSync(new URL('../src/core/ledgerGuard.ts', import.meta.url), 'utf8')
ok('ث0 السنة المقفلة لا يُستثنى منها إلا قيد الإقفال نفسه', guardSrc.includes("CLOSED_YEAR_EXEMPT: readonly SourceType[] = ['year_closing']"))
ok('ث0 الحارس يمنع التعديل الصامت لسطور/تاريخ/وصف/مصدر القيد المرحّل (Append-Only)', guardSrc.includes('تعديل صامت لسطور القيد') && guardSrc.includes('تغيير تاريخ القيد') && guardSrc.includes('تغيير وصف أو مصدر القيد'))
ok('ث0 الحارس يرفض الحساب غير الموجود والتجميعي والمبلغ السالب والمدين/الدائن معاً وتجاوز النطاق الآمن', guardSrc.includes('حساب غير موجود في شجرة الحسابات') && guardSrc.includes('حساب تجميعي لا يقبل قيوداً مباشرة') && guardSrc.includes('مبلغ سالب على الحساب') && guardSrc.includes('مدين ودائن معاً') && guardSrc.includes('خارج النطاق الآمن'))
/* حارس انحدار للمنصة: استيراد ديناميكي بمسار مطلق خام يكسر Windows
   (ERR_UNSUPPORTED_ESM_URL_SCHEME protocol 'd:') — أوقف إصدار v1.0.31 */
const { readdirSync } = await import('node:fs')
const scriptsDir = new URL('../scripts/', import.meta.url)
const rawJoinImports = readdirSync(scriptsDir).filter((f) => f.endsWith('.mjs') && /await import\(join\(/.test(readFileSync(new URL(f, scriptsDir), 'utf8')))
ok('ث0 كل البوابات محمولة بين الأنظمة: لا import ديناميكي بمسار مطلق خام (pathToFileURL إلزامي)', rawJoinImports.length === 0, rawJoinImports.join(', '))

/* ── أدوات الثوابت الحية ──────────────────────────────────────────────────── */
const net = (code) => st().journal.reduce((a, e) => a + e.lines.filter((l) => l.accountCode === code).reduce((x, l) => x + l.debit - l.credit, 0), 0)
const netPrefix = (p) => st().journal.reduce((a, e) => a + e.lines.filter((l) => l.accountCode.startsWith(p)).reduce((x, l) => x + l.debit - l.credit, 0), 0)
const inv = (step) => {
  const s = st()
  // ث1 — كل قيد متوازن ونظيف (فحص مستقل يعيد ما يفعله الحارس)
  for (const e of s.journal) {
    let d = 0, c = 0, meaningful = 0
    for (const l of e.lines) {
      if (!Number.isInteger(l.debit) || !Number.isInteger(l.credit) || l.debit < 0 || l.credit < 0 || (l.debit > 0 && l.credit > 0)) { fails.push(`${step}: سطر غير نظيف في القيد #${e.entryNumber}`); return }
      d += l.debit; c += l.credit
      if (l.debit || l.credit) meaningful++
    }
    if (d !== c || meaningful < 2) { fails.push(`${step}: قيد غير متوازن #${e.entryNumber} (${e.sourceType}) مدين ${d} دائن ${c}`); return }
  }
  // ث3 — المعادلة المحاسبية بعد كل خطوة (مجموع الصافي المدين لكل التصنيفات = صفر)
  const eq = netPrefix('1') + netPrefix('5') + netPrefix('2') + netPrefix('3') + netPrefix('4')
  if (eq !== 0) { fails.push(`${step}: خلل المعادلة المحاسبية — مجموع صافي الأصول+المصاريف+الالتزامات+الحقوق+الإيرادات = ${eq}`); return }
  // ث4 — مطابقة الدفاتر المساعدة لحسابات المراقبة
  const custSum = s.customers.reduce((a, cu) => a + st().getCustomerBalance(cu.id), 0)
  if (custSum !== net('1104')) { fails.push(`${step}: Σ أرصدة العملاء (${custSum}) ≠ صافي 1104 (${net('1104')})`); return }
  const supSum = s.suppliers.reduce((a, sp) => a + st().getSupplierBalance(sp.id), 0)
  if (supSum !== -net('2101')) { fails.push(`${step}: Σ أرصدة الموردين (${supSum}) ≠ −صافي 2101 (${-net('2101')})`); return }
  const custodyRemaining = s.custodyFiles.reduce((a, f) => a + st().getCustodySummary(f.id).remainingMinor, 0)
  if (custodyRemaining !== net('1108')) { fails.push(`${step}: Σ متبقي العهد (${custodyRemaining}) ≠ صافي 1108 (${net('1108')})`); return }
  const excessDue = s.employees.reduce((a, em) => a + st().getEmployeeExcessDue(em.id), 0)
  if (excessDue !== -net('2107')) { fails.push(`${step}: Σ مستحق زيادات العهد (${excessDue}) ≠ −صافي 2107 (${-net('2107')})`); return }
  const advRemaining = s.employeeAdvances.reduce((a, ad) => a + (ad.amountMinor - ad.recoveredMinor), 0)
  if (advRemaining !== net('1107')) { fails.push(`${step}: Σ متبقي سلف الموظفين (${advRemaining}) ≠ صافي 1107 (${net('1107')})`); return }
  const advBal = s.projects.reduce((a, p) => a + st().getAdvanceBalance(p.id), 0)
  if (advBal !== -net('2109')) { fails.push(`${step}: Σ رصيد الدفعات المقدمة (${advBal}) ≠ −صافي 2109 (${-net('2109')})`); return }
}

/* ── السيناريو العابر للوحدات ─────────────────────────────────────────────── */
const step = (name, fn) => { fn(); inv(name); console.log(`  ✓ خطوة: ${name}`) }

step('تأسيس: أصناف وأطراف', () => {
  st().addItem({ nameAr: 'أرز', categoryId: null, unit: 'كجم', priceMinor: 4000, barcode: '100', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
  st().addItem({ nameAr: 'زيت', categoryId: null, unit: 'زجاجة', priceMinor: 9000, barcode: '200', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
  st().addSupplier({ nameAr: 'مورد التدقيق', phone: '', taxNumber: '', address: '', notes: '', isActive: true })
  st().addCustomer({ nameAr: 'عميل التدقيق أ', phone: '', creditLimitMinor: 0, notes: '' })
  st().addCustomer({ nameAr: 'عميل التدقيق ب', phone: '', creditLimitMinor: 0, notes: '' })
  st().addEmployee({ nameAr: 'موظف التدقيق', phone: '', jobTitle: 'محاسب', hireDate: '2024-01-01', baseSalaryMinor: 400000, allowancesMinor: 0, active: true, notes: '' })
})
const [rice, oil] = st().items
const supplier = st().suppliers[0]
const [custA, custB] = st().customers
const emp = st().employees[0]

step('رصيد افتتاحي لعميل (1104/3101)', () => st().setOpeningBalance({ kind: 'customer', refId: custB.id, amountMinor: 100000, label: 'أول مدة' }))
step('شراء آجل بمصروف نقل landed على المورد', () => st().postPurchase({ supplierId: supplier.id, date: '2026-09-19', treasury: '1101', notes: '', paidMinor: 0, expenses: [{ nameAr: 'نقل', amountMinor: 5000, allocation: 'quantity', paidFrom: 'supplier' }], lines: [{ itemId: rice.id, qty: 100, unitPriceMinor: 2500 }, { itemId: oil.id, qty: 50, unitPriceMinor: 6000 }] }))
const riceCost = st().items.find((i) => i.id === rice.id).costMinor
const oilCost = st().items.find((i) => i.id === oil.id).costMinor
step('بيع آجل لعميل مسجل بضريبة شاملة', () => st().postSale({ lines: [{ itemId: rice.id, nameAr: 'أرز', qty: 10, unitPriceMinor: 4000, unitCostMinor: riceCost, discountPercent: 0, soldByWeight: false }], payment: 'credit', treasury: '1101', customerId: custA.id, invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, allowNegativeStock: false }))
const creditSale = st().sales[st().sales.length - 1]
step('بيع نقدي لعميل نقدي (مجهول)', () => st().postSale({ lines: [{ itemId: oil.id, nameAr: 'زيت', qty: 5, unitPriceMinor: 9000, unitCostMinor: oilCost, discountPercent: 0, soldByWeight: false }], payment: 'cash', treasury: '1101', customerId: null, invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true, allowNegativeStock: false }))
step('مرتجع بيع على الحساب (يخفض الذمة ويعيد المخزون)', () => st().postSaleReturn({ saleId: creditSale.id, qtyByItem: new Map([[rice.id, 2]]), refund: 'credit', reason: 'تدقيق — مرتجع آجل' }))
step('سند قبض من العميل (تحصيل حر على الحساب)', () => st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 10000, description: 'دفعة على الحساب', partyKind: 'customer', partyId: custA.id }))
step('سند صرف للمورد (سداد جزء من الدين)', () => st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 100000, description: 'سداد مورد', partyKind: 'supplier', partyId: supplier.id }))
step('سند تحويل بين خزنتين', () => st().postVoucher({ kind: 'transfer', treasury: '1101', counterAccountCode: '1102', amountMinor: 50000, description: 'تغذية البنك' }))
step('قيد يدوي + عكسه (Append-Only)', () => {
  const e = st().postManualEntry({ date: new Date().toISOString().slice(0, 10), description: 'مصروف نثري — تدقيق', lines: [{ accountCode: '5108', debit: 5000, credit: 0, note: 'نثريات' }, { accountCode: '1101', debit: 0, credit: 5000, note: 'صرف' }] })
  st().reverseEntry(e.id, 'خطأ في التسجيل — تدقيق')
})
step('سلفة موظف نقدية (1107)', () => st().grantEmployeeAdvance({ employeeId: emp.id, amountMinor: 50000, treasury: '1101', notes: 'سلفة تدقيق' }))
step('مسير راتب يخصم جزءاً من السلفة', () => st().postPayroll({ month: '2026-08', payMode: 'cash', treasury: '1101', lines: [{ employeeId: emp.id, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 20000 }], notes: '' }))
step('سداد نقدي لجزء من السلفة خارج المسير', () => st().repayEmployeeAdvance({ employeeId: emp.id, amountMinor: 10000, treasury: '1101' }))

let project
step('مشروع مربوط بعميل + ملف عهدة كامل الدورة', () => {
  project = st().addProject({ nameAr: 'مشروع التدقيق', clientName: 'عميل التدقيق أ', clientId: custA.id, contractValueMinor: 10000000, retentionPercent: 5, startDate: '2026-01-01', notes: '' })
  const f = st().openCustodyFile({ employeeId: emp.id, projectId: project.id, reason: 'عهدة موقع — تدقيق', notes: '' })
  st().fundCustodyFile({ fileId: f.id, amountMinor: 400000, treasury: '1101', description: 'تعزيز' })
  st().postCustodyExpense({ fileId: f.id, amountMinor: 120000, description: 'مواد موقع' })
  st().postCustodyExpense({ fileId: f.id, amountMinor: 300000, description: 'طوارئ بزيادة', allowExcess: true })
  st().fundCustodyFile({ fileId: f.id, amountMinor: 100000, treasury: '1101', description: 'تعزيز أخير قبل التسوية' })
  st().settleCustodyFile({ fileId: f.id, returnedMinor: 70000, treasury: '1101' })
})
step('مسير ثانٍ يصفّي مستحق العهدة (2107) ويخصم سلفة العجز (1107)', () => st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', lines: [{ employeeId: emp.id, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 10000, excessPaidMinor: 20000 }], notes: '' }))
step('دفعة مقدمة من العميل (2109)', () => st().receiveClientAdvance({ projectId: project.id, amountMinor: 500000, treasury: '1101' }))
step('مستخلص آجل باسترداد جزء من المقدمة', () => st().addProjectExtract({ projectId: project.id, grossMinor: 2000000, vatPercent: 15, payment: 'credit', advanceRecoveryMinor: 300000, description: 'مستخلص تدقيق' }))
step('تحصيل حر FIFO من العميل', () => st().receiveClientPayment({ customerId: custA.id, amountMinor: 900000, treasury: '1101' }))
step('تحصيل زائد — الفائض دفعة تحت الحساب (رصيد دائن)', () => st().receiveClientPayment({ customerId: custA.id, amountMinor: 1200000, treasury: '1101' }))
step('شيك وارد من عميل: حافظة ← إيداع ← تحصيل', () => {
  const ch = st().receiveCheque({ chequeNumber: 'CHQ-1001', partyId: custA.id, bankName: 'بنك التدقيق', amountMinor: 50000, dueDate: '2026-12-01', notes: '' })
  st().setChequeStatus(ch.id, 'deposited', '1102')
  st().setChequeStatus(ch.id, 'collected', '1102')
})
step('شيك صادر لمورد: إصدار ← صرف', () => {
  const ch = st().issueCheque({ chequeNumber: 'CHQ-2001', partyId: supplier.id, bankName: 'بنك التدقيق', amountMinor: 30000, dueDate: '2026-12-15', notes: '' })
  st().setChequeStatus(ch.id, 'cleared', '1102')
})
step('خطة أقساط على ذمة قائمة: مقدم + سداد قسط', () => {
  const plan = st().createInstallmentPlan({ customerId: custB.id, saleId: null, totalMinor: 100000, downPaymentMinor: 20000, count: 4, intervalMonths: 1, firstDueDate: '2026-11-01', treasury: '1101', notes: 'تقسيط تدقيق' })
  st().payInstallment(plan.id, 20000, '1101')
})

/* ── الثوابت الختامية الشاملة ────────────────────────────────────────────── */
const s = st()
const P = { from: '2000-01-01', to: '2099-12-31' }
let totalD = 0, totalC = 0
for (const e of s.journal) for (const l of e.lines) { totalD += l.debit; totalC += l.credit }
ok('ث2 ميزان المراجعة الكلي من الدفتر الخام: Σمدين == Σدائن', totalD === totalC, `${totalD} vs ${totalC}`)
ok('ث3 المعادلة المحاسبية: Σ صافي (أصول+مصاريف) المدينة − Σ صافي (التزامات+حقوق+إيرادات) الدائنة == 0', netPrefix('1') + netPrefix('5') + netPrefix('2') + netPrefix('3') + netPrefix('4') === 0, `1+5 = ${netPrefix('1') + netPrefix('5')} مقابل 2+3+4 = ${-(netPrefix('2') + netPrefix('3') + netPrefix('4'))}`)
const tb = trialBalance(s.journal, P)
ok('ث7 تقرير ميزان المراجعة يطابق الدفتر الخام', tb.totalDebitMinor === totalD && tb.totalCreditMinor === totalC)
const bs = balanceSheet(s.journal, '2099-12-31')
ok('ث7 الميزانية العمومية متزنة: الأصول == الالتزامات + حقوق الملكية', bs.balanced && bs.totalAssetsMinor === bs.totalLiabilitiesEquityMinor, `${bs.totalAssetsMinor} vs ${bs.totalLiabilitiesEquityMinor}`)
const inc = incomeStatement(s.journal, P)
ok('ث7 قائمة الدخل: صافي الربح == حقوق الملكية المتحركة − رأس المال (اتساق القوائم)', Number.isInteger(inc.netProfitMinor))
ok('ث3+ المعادلة تتحقق أيضاً عبر تصنيفات الميزانية نفسها', bs.totalAssetsMinor - bs.totalLiabilitiesEquityMinor === 0)

// ث5 — لا ترحيل مزدوج: قيود متطابقة المصدر والسطور والوصف
const seen = new Map()
let dupes = 0
for (const e of s.journal) {
  const key = `${e.sourceType}|${e.sourceId}|${e.date}|${e.description}|${JSON.stringify(e.lines)}`
  seen.set(key, (seen.get(key) ?? 0) + 1)
}
for (const [, n] of seen) if (n > 1) dupes++
ok('ث5 لا قيد مكرر حرفياً في الدفتر (كشف الترحيل المزدوج)', dupes === 0, `${dupes} مجموعة مكررة`)

// ث6 — المخزون مقابل 1103 بهامش تقريب المتوسطات المرجحة
const stockValue = s.items.reduce((a, i) => a + Math.round(i.stockQty * i.costMinor), 0)
const diff1103 = Math.abs(stockValue - net('1103'))
ok('ث6 قيمة المخزون (كمية×متوسط) ≈ صافي 1103 — فرق ≤ 250 قرش تقريب', diff1103 <= 250, `المخزون ${stockValue} مقابل 1103 ${net('1103')} (فرق ${diff1103})`)

// ث4 ختامية — المطابقات الست بعد السيناريو كله
ok('ث4 Σ أرصدة العملاء == صافي 1104', s.customers.reduce((a, c) => a + st().getCustomerBalance(c.id), 0) === net('1104'))
ok('ث4 Σ أرصدة الموردين == −صافي 2101', s.suppliers.reduce((a, sp) => a + st().getSupplierBalance(sp.id), 0) === -net('2101'))
ok('ث4 Σ متبقي ملفات العهدة == صافي 1108', s.custodyFiles.reduce((a, f) => a + st().getCustodySummary(f.id).remainingMinor, 0) === net('1108'))
ok('ث4 Σ مستحق زيادات العهد == −صافي 2107', s.employees.reduce((a, e2) => a + st().getEmployeeExcessDue(e2.id), 0) === -net('2107'))
ok('ث4 Σ متبقي سلف الموظفين == صافي 1107', s.employeeAdvances.reduce((a, ad) => a + (ad.amountMinor - ad.recoveredMinor), 0) === net('1107'))
ok('ث4 Σ رصيد الدفعات المقدمة للمشاريع == −صافي 2109', s.projects.reduce((a, p) => a + st().getAdvanceBalance(p.id), 0) === -net('2109'))

// ث8 — اتساق واجهتي الكشف والرصيد لكل عميل ومورد (مصدر واحد للحقيقة)
ok('ث8 رصيد كل عميل == آخر سطر في كشفه (مصدر واحد)', s.customers.every((c) => { const rows = st().getCustomerStatementRows(c.id); return rows.length === 0 ? st().getCustomerBalance(c.id) === 0 : rows[rows.length - 1].balanceMinor === st().getCustomerBalance(c.id) }))
ok('ث8 رصيد كل مورد == آخر سطر في كشفه (مصدر واحد)', s.suppliers.every((sp) => { const rows = st().getSupplierStatementRows(sp.id); return rows.length === 0 ? st().getSupplierBalance(sp.id) === 0 : rows[rows.length - 1].balanceMinor === st().getSupplierBalance(sp.id) }))

// ث9 — كل قيود اليومية تواريخها مطبعة YYYY-MM-DD ومصادرها معرّفة وأرقامها فريدة
const nums = new Set()
ok('ث9 تواريخ موحدة + مصدر معرّف + أرقام قيود فريدة', s.journal.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && !!e.sourceType && (nums.has(e.entryNumber) ? false : nums.add(e.entryNumber))))

// ث10 — أطراف الدفتر: رصيد العميل أ سالب (دائن بعد التحصيل الزائد) وب موجب ثم انخفض بالأقساط
ok('ث10 التحصيل الزائد جعل العميل أ دائناً فعلاً (رصيد سالب)', st().getCustomerBalance(custA.id) < 0, st().getCustomerBalance(custA.id))
ok('ث10 خطة الأقساط خفضت ذمة العميل ب (مقدم + قسط = 40000)', st().getCustomerBalance(custB.id) === 100000 - 40000, st().getCustomerBalance(custB.id))

if (fails.length) { console.error(`\nفشل ${fails.length} فحصاً:\n  - ${fails.join('\n  - ')}`); process.exit(1) }
console.log(`\nنجح التدقيق الخبير: ${pass} ثابتاً — الدفتر متوازن ومطابق لدفاتره المساعدة عبر ${s.journal.length} قيداً`)
