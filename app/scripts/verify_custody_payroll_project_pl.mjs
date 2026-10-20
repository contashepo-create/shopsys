#!/usr/bin/env node
/**
 * بوابة العهدة ← الرواتب ← ربحية المشروع ← ذمة العميل (مراجعة المالك 2026-10-17):
 *   ① ملف العهدة: فتح (بلا قيد) ← تعزيز (1108 ← خزينة) ← مصروف على مشروع (5110 +
 *      بند تكلفة يدخل الربحية) أو مصروف عام (5108) ← زيادة بموافقة (2107 مستحق
 *      للموظف) ← تسوية (مرتجع للخزينة + عجز 1107 يصير سلفة تُخصم من الرواتب) ←
 *      الملف المسوّى مقفول.
 *   ② المسير: يخصم سلفة عجز العهدة ويصفي مستحق 2107 بقيود متوازنة، بحروس
 *      (سقف 50٪ · متبقي السلف · مستحق الزيادة) والصرف من ملف عهدة برصيد كافٍ.
 *   ③ تقرير ربحية المشروع: التكاليف من كل مصادرها (تشمل مصاريف العهدة المرتبطة)
 *      وتطابق صافي 5110 بالدفتر (§95).
 *   ④ ذمة العميل: ربط المشروع بعميل إداري بحت (رصيد 0) — الذمة تنشأ من المستخلص
 *      الآجل بكامل مستحقه بضريبته، والتحصيل الحر FIFO ينزل من المدين، والفائض
 *      يجعل رصيده دائناً، والدفعة المقدمة التزام 2109 يُسترد من المستخلصات.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_custody_payroll_project_pl.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 14, taxInclusive: true, activityId: 'general', countryCode: 'EG' }, license: { plan: 'pro' } } }))
const { useDataStore } = await import('../src/data/repo.ts')
const { summarizeCustodyExcessByFile } = await import('../src/core/custody.ts')
const st = () => useDataStore.getState()

/* بذرة: عميل + موظف (المسير والعهدة يتحققان من وجودهما في السجلات — §83) */
useDataStore.setState((s) => ({
  customers: [...s.customers, { id: 77001, nameAr: 'عميل بوابة العهد', phone: '01000000077', creditLimitMinor: 0, notes: '', openingMinor: 0 }],
  employees: [...s.employees, { id: 6001, nameAr: 'موظف بوابة العهد', phone: '01000000078', jobTitle: 'محاسب موقع', hireDate: '2024-01-01', baseSalaryMinor: 400000, allowancesMinor: 0, active: true, notes: '' }],
}))

let pass = 0, fails = []
const ok = (n, c, extra = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fails.push(n); console.log(`  ❌ ${n}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (n, fn, part) => {
  try { fn(); fails.push(n); console.log(`  ❌ ${n} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); if (good) pass++; else fails.push(n); console.log(`  ${good ? '✅' : '❌'} ${n}${good ? '' : ' — ' + e.message}`) }
}
const balanced = () => { let d = 0, c = 0; for (const e of st().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
const entryOf = (sourceType, sourceId) => st().journal.find((e) => e.sourceType === sourceType && e.sourceId === sourceId)
const lineSum = (entry, code, side) => entry ? entry.lines.filter((l) => l.accountCode === code).reduce((a, l) => a + l[side], 0) : -1
const netAccount = (code) => st().journal.reduce((a, e) => a + e.lines.filter((l) => l.accountCode === code).reduce((x, l) => x + l.debit - l.credit, 0), 0)

/* ── ① المحرك ثابت حسابياً (نواة custody.ts) ─────────────────────────────── */
const { readFileSync } = await import('node:fs')
const custodySrc = readFileSync(new URL('../src/core/custody.ts', import.meta.url), 'utf8')
ok('① حسابات العهدة مثبتة: 1108 العهدة · 2107 مستحق الزيادة · 1107 عجز/سلف', custodySrc.includes("CUSTODY_ACCOUNT = '1108'") && custodySrc.includes("CUSTODY_EXCESS_ACCOUNT = '2107'") && custodySrc.includes("CUSTODY_SHORTAGE_ACCOUNT = '1107'"))
ok('① الزيادة عن الرصيد مرفوضة بلا موافقة صريحة (allowExcess)', custodySrc.includes('فعِّل «سماح بالزيادة» لتسجيل الفرق مستحقاً للموظف'))

/* ── ② دورة العهدة الحية: فتح ← تعزيز ← مصروف مشروع/عام ← زيادة ← تسوية ── */
const project = st().addProject({ nameAr: 'مشروع بوابة العهد', clientName: 'عميل بوابة العهد', clientId: 77001, contractValueMinor: 10000000, retentionPercent: 5, startDate: '2026-01-01', notes: '' })
ok('④ ربط المشروع بعميل إداري بحت — رصيد العميل 0 (لا ذمة بلا مستند)', st().getCustomerBalance(77001) === 0)

/* السداد الجزئي من العهدة: المدفوع وحده ينقص الملف، والآجل يُحمّل على المورد */
st().addSupplier({ nameAr: 'مورد بوابة السداد الجزئي', phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const partialSupplier = st().suppliers.at(-1)
const paymentProject = st().addProject({ nameAr: 'مشروع اختبار السداد الجزئي', clientName: '', contractValueMinor: 1000000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
const partialFile = st().openCustodyFile({ employeeId: 6001, projectId: paymentProject.id, reason: 'اختبار دفع جزئي', notes: '' })
st().fundCustodyFile({ fileId: partialFile.id, amountMinor: 50000, treasury: '1101', description: 'تمويل اختبار الدفع الجزئي' })
const noSupplierJournal = st().journal.length
const noSupplierCosts = st().projectCosts.length
throws('مصروف مشروع آجل بلا جهة يتحملها مرفوض', () => st().addProjectCost({ projectId: paymentProject.id, amountMinor: 10000, payment: 'credit', paidMinor: 0, description: 'آجل بلا جهة' }), 'يتطلب اختيار المورد')
ok('رفض الآجل بلا جهة ذري — لا قيد ولا تكلفة نصف مسجلة', st().journal.length === noSupplierJournal && st().projectCosts.length === noSupplierCosts)
const partialCost = st().addProjectCost({ projectId: paymentProject.id, kind: 'materials', amountMinor: 150000, payment: 'mixed', paidMinor: 40000, supplierId: partialSupplier.id, custodyFileId: partialFile.id, description: 'حديد مدفوع جزئياً من العهدة', treasury: '1101' })
const partialEntry = entryOf('project_cost', partialCost.id)
const partialTx = st().custodyTxs.find((tx) => tx.fileId === partialFile.id && tx.type === 'expense')
ok('الدفع الجزئي من العهدة: 40,000 فقط خُصمت من الملف رغم أن الفاتورة 150,000', partialCost.custodyFileId === partialFile.id && partialCost.paidMinor === 40000 && st().getCustodySummary(partialFile.id).remainingMinor === 10000 && partialTx?.amountMinor === 40000)
ok('قيد الفاتورة: 5110 مدين 150,000 ← 1108 دائن بالمدفوع 40,000 + 2101 دائن بالآجل 110,000', lineSum(partialEntry, '5110', 'debit') === 150000 && lineSum(partialEntry, '1108', 'credit') === 40000 && lineSum(partialEntry, '2101', 'credit') === 110000)
ok('الآجل ظاهر على المورد في كشفه ورصيده 110,000', partialCost.dueMinor === 110000 && st().getSupplierBalance(partialSupplier.id) === 110000 && st().getSupplierStatementRows(partialSupplier.id).some((row) => row.docLabel.includes('تكلفة مشروع')))
const allCreditCost = st().addProjectCost({ projectId: paymentProject.id, kind: 'other', amountMinor: 20000, payment: 'credit', paidMinor: 0, supplierId: partialSupplier.id, custodyFileId: partialFile.id, description: 'فاتورة كاملة آجلة' })
ok('مدفوع صفر = كامل الإجمالي آجل ولا حركة على العهدة', allCreditCost.payment === 'credit' && allCreditCost.paidMinor === 0 && allCreditCost.dueMinor === 20000 && allCreditCost.custodyFileId == null && st().getCustodySummary(partialFile.id).remainingMinor === 10000)
const failedPartialJournal = st().journal.length
throws('مدفوع من العهدة أكبر من رصيدها يُرفض ولو بقي جزء آجل', () => st().addProjectCost({ projectId: paymentProject.id, amountMinor: 30000, payment: 'mixed', paidMinor: 15000, supplierId: partialSupplier.id, custodyFileId: partialFile.id, description: 'مدفوع أكبر من العهدة' }), 'المتبقي في ملفها')
ok('رفض تجاوز رصيد العهدة ذري — لا قيد إضافي', st().journal.length === failedPartialJournal && st().getCustodySummary(partialFile.id).remainingMinor === 10000)

const journalBefore = st().journal.length
const fileA = st().openCustodyFile({ employeeId: 6001, projectId: project.id, reason: 'عهدة موقع', notes: '' })
ok('① فتح ملف العهدة لا ينشئ قيداً (استلام إداري حتى التمويل)', st().journal.length === journalBefore && fileA.status === 'open')
throws('① فتح ملف بلا سبب مرفوض', () => st().openCustodyFile({ employeeId: 6001, reason: '  ' }), 'سبب فتح الملف')

const fundA = st().fundCustodyFile({ fileId: fileA.id, amountMinor: 500000, treasury: '1101', description: 'تعزيز أول' })
const fundEntry = entryOf('payment_voucher', fundA.id)
ok('① التعزيز: 1108 مدين 500000 ← 1101 دائن', lineSum(fundEntry, '1108', 'debit') === 500000 && lineSum(fundEntry, '1101', 'credit') === 500000)
ok('① ملخص العهدة من الحركات: مموَّل 500000 ومتبقٍ 500000', (() => { const s = st().getCustodySummary(fileA.id); return s.fundedMinor === 500000 && s.remainingMinor === 500000 })())

st().postCustodyExpense({ fileId: fileA.id, amountMinor: 200000, description: 'مواد نثرية للموقع' })
const projExpEntry = st().journal[st().journal.length - 1]
const projCost = st().projectCosts.find((c) => c.projectId === project.id && c.description.includes('مواد نثرية'))
ok('① مصروف العهدة على مشروع: 5110 مدين ← 1108 دائن (يحمل ملف العهدة مشروعاً)', lineSum(projExpEntry, '5110', 'debit') === 200000 && lineSum(projExpEntry, '1108', 'credit') === 200000)
ok('① المصروف على المشروع يولّد بند تكلفة projectCosts بنفس قيد اليومية (يدخل الربحية)', !!projCost && projCost.amountMinor === 200000 && projCost.kind === 'other' && projCost.journalEntryId === projExpEntry.id)
ok('① المتبقي بعد المصروف 300000', st().getCustodySummary(fileA.id).remainingMinor === 300000)

st().postCustodyExpense({ fileId: fileA.id, amountMinor: 50000, projectId: null, description: 'ضيافة عامة' })
const genExpEntry = st().journal[st().journal.length - 1]
ok('① مصروف بلا مشروع (override صريح) عام: 5108 مدين ← 1108', lineSum(genExpEntry, '5108', 'debit') === 50000 && lineSum(genExpEntry, '1108', 'credit') === 50000)
ok('① المصروف العام لا يمس تكاليف المشروع', !st().projectCosts.some((c) => c.description.includes('ضيافة عامة')))

throws('① مصروف أكبر من المتبقي مرفوض بلا سماح بالزيادة', () => st().postCustodyExpense({ fileId: fileA.id, amountMinor: 300000, description: 'طوارئ' }), 'أكبر من رصيد العهدة المتبقي')
const excessTx = st().postCustodyExpense({ fileId: fileA.id, amountMinor: 300000, description: 'طوارئ بزيادة', allowExcess: true })
const excessEntry = entryOf('payment_voucher', excessTx.id)
ok('① الزيادة بموافقة: 5110 بكامل 300000 ← 1108 (250000) + 2107 مستحق للموظف (50000)', lineSum(excessEntry, '5110', 'debit') === 300000 && lineSum(excessEntry, '1108', 'credit') === 250000 && lineSum(excessEntry, '2107', 'credit') === 50000)
ok('① الزيادة لا تُنقص رصيد العهدة تحت الصفر (المتبقي 0) وتُسجل excessMinor على الحركة', st().getCustodySummary(fileA.id).remainingMinor === 0 && excessTx.excessMinor === 50000)
ok('② مستحق الموظف من زيادات العهد (2107) = 50000', st().getEmployeeExcessDue(6001) === 50000)
const overageClosed = st().settleCustodyFile({ fileId: fileA.id, returnedMinor: 0, treasury: '1101' })
let overageBalance = summarizeCustodyExcessByFile(st().custodyFiles, st().custodyTxs, st().payrollRuns).get(fileA.id)
ok('① إغلاق ملف زادت مصروفاته بلا عجز نقدي لا يمحو زيادة 2107 ولا ينشئ قيد تسوية وهمياً', overageClosed.status === 'settled' && overageClosed.shortageMinor === 0 && st().getEmployeeExcessDue(6001) === 50000 && overageBalance?.accruedMinor === 50000 && overageBalance.remainingMinor === 50000 && !st().journal.some((e) => e.description.includes(`تسوية عهدة ${fileA.fileNumber}`)))
ok('③ مصروف العهدة المرتبط بالمشروع دخل بطاقة تكاليفه (يدوي/other = 500000)', st().getProjectCostBreakdown(project.id).manual.filter((c) => c.kind === 'other').reduce((a, c) => a + c.amountMinor, 0) === 500000)

/* ملف عام: تسوية بمرتجع + عجز ← سلفة على الموظف */
const fileB = st().openCustodyFile({ employeeId: 6001, reason: 'مشتريات نثرية', notes: '' })
st().fundCustodyFile({ fileId: fileB.id, amountMinor: 100000, treasury: '1101', description: '' })
const settledB = st().settleCustodyFile({ fileId: fileB.id, returnedMinor: 70000, treasury: '1101' })
const settleEntry = st().journal.find((e) => e.description.includes(`تسوية عهدة`) && e.lines.some((l) => l.accountCode === '1107' && l.debit === 30000))
ok('① التسوية: مرتجع 70000 للخزينة + عجز 30000 على 1107 ← 1108 بكامل 100000', !!settleEntry && lineSum(settleEntry, '1101', 'debit') === 70000 && lineSum(settleEntry, '1107', 'debit') === 30000 && lineSum(settleEntry, '1108', 'credit') === 100000)
const shortageAdv = st().employeeAdvances.find((a) => a.source === 'custody_shortage' && a.custodyFileId === fileB.id)
ok('② عجز العهدة يصير سلفة موظف (custody_shortage) متبقٍ 30000 تُخصم من الرواتب بحرية المالك', !!shortageAdv && shortageAdv.amountMinor === 30000 && st().getEmployeeAdvanceBalance(6001).remainingMinor === 30000)
ok('① الملف المسوّى: status settled بحركة مرتجع وحركة عجز', settledB.status === 'settled' && settledB.shortageMinor === 30000 && st().custodyTxs.some((t) => t.fileId === fileB.id && t.type === 'return') && st().custodyTxs.some((t) => t.fileId === fileB.id && t.type === 'shortage'))
throws('① الملف المسوّى مقفول — لا تمويل بعده', () => st().fundCustodyFile({ fileId: fileB.id, amountMinor: 1000, treasury: '1101', description: '' }), 'مغلق')
throws('① لا مصروف على ملف مسوّى', () => st().postCustodyExpense({ fileId: fileB.id, amountMinor: 1000, description: 'x' }), '')

/* ── ② المسير: خصم السلفة + تصفية 2107 بحروس ─────────────────────────────── */
throws('② حرس: خصم سلفة أكبر من المتبقي مرفوض', () => st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', lines: [{ employeeId: 6001, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 40000 }], notes: '' }), 'أكبر من متبقي سلفه')
throws('② حرس: صرف مستحق زيادة أكبر من رصيد 2107 مرفوض', () => st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', lines: [{ employeeId: 6001, baseMinor: 400000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0, excessPaidMinor: 60000 }], notes: '' }), 'أكبر من رصيده')
throws('② حرس: سقف الخصومات 50٪ من راتب الشهر بلا اعتماد', () => st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', lines: [{ employeeId: 6001, baseMinor: 50000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 30000 }], notes: '' }), '50%')
throws('② حرس: لا مسير لموظف غير موجود بالسجلات (§83)', () => st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', lines: [{ employeeId: 9999, baseMinor: 100000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }], notes: '' }), 'موظف غير موجود')

const run = st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', lines: [{ employeeId: 6001, baseMinor: 400000, allowancesMinor: 50000, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 30000, excessPaidMinor: 50000 }], notes: '' })
const runEntry = entryOf('payroll', run.id)
ok('② قيد المسير: 5102 بالإجمالي 450000 + 2107 مدين 50000 ← 1101 صافي+زيادة 470000 + 1107 سلفة 30000', lineSum(runEntry, '5102', 'debit') === 450000 && lineSum(runEntry, '2107', 'debit') === 50000 && lineSum(runEntry, '1101', 'credit') === 470000 && lineSum(runEntry, '1107', 'credit') === 30000)
ok('② زيادة العهدة المصروفة لا تدخل مصروف الرواتب (5102 = الإجمالي فقط)', lineSum(runEntry, '5102', 'debit') === 450000)
ok('② بعد المسير: مستحق 2107 صُفّر ومتبقي السلف صُفر والسلفة FIFO مستردة', st().getEmployeeExcessDue(6001) === 0 && st().getEmployeeAdvanceBalance(6001).remainingMinor === 0 && st().employeeAdvances.find((a) => a.id === shortageAdv.id).recoveredMinor === 30000)
const paidClosedFileExcess = summarizeCustodyExcessByFile(st().custodyFiles, st().custodyTxs, st().payrollRuns).get(fileA.id)
ok('② زيادة الملف المغلق صُرفت من 2107 بالمسير وبقي تتبعها على الملف: مستحق 50000، مصروف 50000، باقٍ صفر', paidClosedFileExcess?.accruedMinor === 50000 && paidClosedFileExcess.paidMinor === 50000 && paidClosedFileExcess.remainingMinor === 0)
throws('② لا يتكرر راتب الموظف نفسه في الشهر نفسه', () => st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', lines: [{ employeeId: 6001, baseMinor: 100000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }], notes: '' }), 'مرحّل بالفعل')

/* صرف مسير من ملف عهدة مفتوح برصيد كافٍ */
const fileC = st().openCustodyFile({ employeeId: 6001, reason: 'عهدة صرف مسير', notes: '' })
st().fundCustodyFile({ fileId: fileC.id, amountMinor: 200000, treasury: '1101', description: '' })
throws('② مسير من ملف عهدة أكبر من متبقيه مرفوض', () => st().postPayroll({ month: '2026-10', payMode: 'cash', treasury: '1101', custodyFileId: fileC.id, lines: [{ employeeId: 6001, baseMinor: 300000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }], notes: '' }), 'أكبر من المتبقي في ملف العهدة')
const run2 = st().postPayroll({ month: '2026-10', payMode: 'cash', treasury: '1101', custodyFileId: fileC.id, lines: [{ employeeId: 6001, baseMinor: 150000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }], notes: '' })
const run2Entry = entryOf('payroll', run2.id)
ok('② الصرف من العهدة: القيد يدين 5108؟ لا — 5102 ← 1108 (لا خزينة) + حركة expense بالملف', lineSum(run2Entry, '5102', 'debit') === 150000 && lineSum(run2Entry, '1108', 'credit') === 150000 && lineSum(run2Entry, '1101', 'credit') === 0)
ok('② حركة المصروف نزلت بملف العهدة (المتبقي 50000)', st().getCustodySummary(fileC.id).remainingMinor === 50000 && st().custodyTxs.some((t) => t.fileId === fileC.id && t.type === 'expense' && t.amountMinor === 150000))

/* ── ③ ربحية المشروع ─────────────────────────────────────────────────────── */
const allProjectCosts = st().projects.reduce((sum, row) => sum + st().getProjectCostBreakdown(row.id).totals.allMinor, 0)
ok('③ مجموع بطاقات تكاليف كل المشروعات يطابق صافي 5110 بالدفتر (§95 — بلا جمع مزدوج)', allProjectCosts === netAccount('5110'), `البطاقات ${allProjectCosts} مقابل 5110 ${netAccount('5110')}`)

/* ── ④ ذمة العميل: دفعة مقدمة ← مستخلص آجل ← تحصيل حر ← فائض دائن ───────── */
st().receiveClientAdvance({ projectId: project.id, amountMinor: 1000000, treasury: '1101' })
const advEntry = st().journal[st().journal.length - 1]
ok('④ الدفعة المقدمة التزام: 1101 مدين ← 2109 دائن (ليست ذمة على العميل ولا إيراداً)', lineSum(advEntry, '1101', 'debit') === 1000000 && lineSum(advEntry, '2109', 'credit') === 1000000)
ok('④ رصيد العميل بعد المقدمة ما زال 0 (المقدمة لا تخلق مديونية ولا تظهر ديناً)', st().getCustomerBalance(77001) === 0)
ok('⑤ رصيد الدفعات المقدمة غير المستردة = 1000000', st().getAdvanceBalance(project.id) === 1000000)

const extract = st().addProjectExtract({ projectId: project.id, grossMinor: 2000000, vatPercent: 15, payment: 'credit', advanceRecoveryMinor: 400000, description: 'مستخلص أول' })
const exEntry = entryOf('project_extract', extract.id)
ok('④ المستخلص الآجل: 1104 بالمستحق بعد الاسترداد 1800000 + 1105 محتجز 100000 + 2109 إطفاء 400000 ← 4107 صافي 2000000 + 2102 ضريبة 300000', lineSum(exEntry, '1104', 'debit') === 1800000 && lineSum(exEntry, '1105', 'debit') === 100000 && lineSum(exEntry, '2109', 'debit') === 400000 && lineSum(exEntry, '4107', 'credit') === 2000000 && lineSum(exEntry, '2102', 'credit') === 300000)
ok('⑤ الاسترداد FIFO أطفأ من المقدمة: المتبقي 600000', st().getAdvanceBalance(project.id) === 600000)
throws('⑤ استرداد أكبر من رصيد المقدمات مرفوض', () => st().addProjectExtract({ projectId: project.id, grossMinor: 1000000, vatPercent: 15, payment: 'credit', advanceRecoveryMinor: 700000, description: 'x' }), 'أكبر من رصيد الدفعات المقدمة')
ok('④ ذمة العميل = مستحق المستخلص بضريبته (2200000) − الاسترداد (400000) = 1800000 — تنشأ بالمستخلص لا بإنشاء المشروع', st().getCustomerBalance(77001) === 1800000, st().getCustomerBalance(77001))

const pay1 = st().receiveClientPayment({ customerId: 77001, amountMinor: 800000, treasury: '1101' })
ok('④ التحصيل الحر ينزل من الرصيد المدين FIFO (1800000 − 800000 = 1000000)', pay1.allocations.length > 0 && st().getCustomerBalance(77001) === 1000000, st().getCustomerBalance(77001))
const pay2 = st().receiveClientPayment({ customerId: 77001, amountMinor: 1500000, treasury: '1101' })
ok('④ تحصيل أكبر من المدين: الفائض 500000 «دفعة تحت الحساب» والرصيد يصير دائناً (−500000)', pay2.unallocatedMinor === 500000 && st().getCustomerBalance(77001) === -500000, st().getCustomerBalance(77001))
const pay2Entry = st().journal.find((e) => e.sourceType === 'client_payment' && e.description.includes('دفعة تحت الحساب'))
ok('④ قيد التحصيل الحر: خزينة مدين ← 1104 دائن بكامل المبلغ (الفائض يبقى دائناً بكشف العميل)', !!pay2Entry && lineSum(pay2Entry, '1101', 'debit') === 1500000 && lineSum(pay2Entry, '1104', 'credit') === 1500000)
ok('④ كشف العميل يعرض المستخلص مديناً بالمستحق الكامل والاسترداد دائناً (§74 — لا خصم مزدوج)', (() => { const rows = st().getCustomerStatementRows(77001); const exRow = rows.find((r) => r.docLabel.includes(extract.extractNumber)); return !!exRow && exRow.debitMinor === 2200000 && exRow.creditMinor >= 400000 })())

/* ── ③ ربحية المشروع بعد المستخلص والتكاليف ─────────────────────────────── */
const profit = st().getProjectProfit(project.id)
ok('③ الربحية: مستخلصات 2000000 (صافي بلا ضريبة) − تكاليف 500000 (تشمل مصاريف العهدة) = ربح 1500000 وهامش 75٪', profit.extractedMinor === 2000000 && profit.costsMinor === 500000 && profit.profitMinor === 1500000 && profit.marginPercent === 75, JSON.stringify(profit))
ok('③ المحتجزات الممسوكة 100000 تظهر بتقرير الربحية (لم تُفرج بعد)', profit.retentionHeldMinor === 100000)

/* مراجعة واجهات البلاغ: سجل المشروع، المصروف، ملف الإغلاق، ومسير الرواتب */
const contractingUi = readFileSync(new URL('../src/ui/pages/ContractingPages.tsx', import.meta.url), 'utf8')
const expenseStart = contractingUi.indexOf('export function ProjectExpensesPage()')
const extractsStart = contractingUi.indexOf('export function ProjectExtractsPage()')
const projectsUi = contractingUi.slice(0, contractingUi.indexOf('/* ═══════════════════════════════════════════════════════════════════════════════\n   §96-أ'))
const expensesUi = contractingUi.slice(expenseStart, extractsStart)
const paySourceUi = readFileSync(new URL('../src/ui/components/PaySourcePicker.tsx', import.meta.url), 'utf8')
const projectCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const custodyUi = readFileSync(new URL('../src/ui/pages/CustodyPage.tsx', import.meta.url), 'utf8')
const payrollUi = readFileSync(new URL('../src/ui/pages/EmployeesPage.tsx', import.meta.url), 'utf8')
ok('واجهة قائمة المشروعات لا تعرض زرّي المستخلص وتسجيل المصروف بجوار اسم المشروع', !projectsUi.includes('navigate(`/contracting/extracts?projectId=${p.id}`)') && !projectsUi.includes('navigate(`/contracting/expenses?projectId=${p.id}`)'))
ok('واجهة المصروف مبسطة: مدفوع واحد والباقي آجل آلياً بلا أزرار نقدي/جزئي/آجل', expensesUi.includes('data-project-expense-paid') && expensesUi.includes('dueNowMinor') && !expensesUi.includes('paymentMode') && !expensesUi.includes('مدفوع جزئياً + آجل'))
ok('مصدر الدفع قائمتان مترابطتان للخزينة/البنك أو العهدة ثم الحساب/الملف المحدد', expensesUi.includes('<PaySourcePicker linked') && paySourceUi.includes('data-pay-source-linked') && paySourceUi.includes('نوع مصدر السداد'))
ok('ترويسة نموذج المشروع تعرض التسميات والحقول دون ضغط صفوف متداخلة', projectCss.includes('[data-project-doc-editor] .invoice-doc .invoice-doc-fields') && projectCss.includes('white-space: normal;') && projectCss.includes('height: 2.35rem !important'))
ok('ملف العهدة يعرض مرتجع التسوية والعجز والزيادة المسجلة والمدفوعة والمتبقية', custodyUi.includes('data-custody-settlement-status') && custodyUi.includes('viewing.returnedMinor') && custodyUi.includes('viewing.shortageMinor') && custodyUi.includes('viewingExcess?.accruedMinor') && custodyUi.includes('viewingExcess?.remainingMinor'))
ok('مسير الرواتب يعرض مستحق الزيادة (2107) وخصم سلفة عجز العهدة', payrollUi.includes('data-custody-excess-pay') && payrollUi.includes('data-custody-shortage-deduction') && payrollUi.includes('عجز عهدة'))

ok('⑥ الدفتر كله متوازن بعد الدورة الكاملة', balanced())
if (fails.length) { console.error(`\nفشل ${fails.length} فحصاً:\n  - ${fails.join('\n  - ')}`); process.exit(1) }
console.log(`\nنجحت كل الفحوص: ${pass} — العهدة ← الرواتب ← ربحية المشروع ← ذمة العميل`)
