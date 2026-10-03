/**
 * 🧾 رحلة إجابات جولة المالك (2026-10-01): كل سؤال محاسبي ببرهان حي بالقرش.
 *
 * ① حد ائتمان صفر = بلا حد — لا تحصيل إجباري، والآجل كله يرحل 1104.
 *    (حد موجب يعمل كالسابق: التجاوز يُرفض إلا بموافقة مدير)
 * ② تحصيل موظف لفاتورة عميل: مفرد (1107 كامل)، متعدد الطرق (نقد + 1107)،
 *    ومتبقٍ آجل (1104) — ثم كشف الموظف يُظهر صف التحصيل مديناً وسند السداد يصفرّه.
 * ③ مصاريف الفاتورة الداخلية: مدفوع فوراً (مصروف/خزينة) ومستحق لاحقاً (مصروف/دائن).
 * ④ المشروع وتكاليفه: صرف مخزني للموقع (5110) + تكلفة مقاولة + مستخلص بمحتجز
 *    وضريبة → ربحية المشروع بالقرش.
 * ⑤ ميزان المراجعة متزن تماماً بعد كل شيء.
 *
 * تشغيل: node --experimental-strip-types scripts/user_journey_owner_round_answers.mjs
 */
import assert from 'node:assert/strict'
const mem = new Map()
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k), clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size } }
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'EG', activityId: 'retail', vatPercent: 14, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))
const { useDataStore } = await import('../src/data/repo.ts')
const { projectProfit } = await import('../src/core/contracting.ts')
const { trialBalance } = await import('../src/core/financialReports.ts')
const st = () => useDataStore.getState()
let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n) }

// أدوات: رصيد حساب من اليومية، وبحث قيد
const acctBal = (code) => st().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((s, l) => s + l.debit - l.credit, 0)
const lineOf = (lines, code) => lines.filter((l) => l.accountCode === code).reduce((s, l) => ({ debit: s.debit + l.debit, credit: s.credit + l.credit }), { debit: 0, credit: 0 })
/* أسطر القيود الجديدة بعد نقطة بداية (postSale قد يولّد أكثر من قيد) */
const mark = () => st().journal.length
const newLines = (from) => st().journal.slice(from).flatMap((e) => e.lines)

// بيانات مشتركة: صنف مخزني بكمية، عميلان (بلا حد / بحد)، موظف محصل
st().addItem({ nameAr: 'دواء موصوف', categoryId: null, unit: 'علبة', priceMinor: 100000, barcode: 'RX-1', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 60000, stockQty: 200 })
const item = st().items[0]
st().addCustomer({ nameAr: 'عميل بلا حد ائتمان', phone: '01000000001', creditLimitMinor: 0, notes: '' })
st().addCustomer({ nameAr: 'عميل بحد 5,000', phone: '01000000002', creditLimitMinor: 500000, notes: '' })
const [noLimitCust, limitedCust] = st().customers
st().addEmployee({ nameAr: 'محصل الشركة', phone: '01000000003', jobTitle: 'محصل ميداني', hireDate: '2026-01-01', baseSalaryMinor: 600000, allowancesMinor: 0, active: true, notes: '' })
const collector = st().employees[0]
const cart = (qty) => [{ itemId: item.id, nameAr: item.nameAr, qty, unitPriceMinor: 100000, unitCostMinor: 60000, discountPercent: 0, soldByWeight: false }]

console.log('\n═══ ① حد ائتمان صفر ⇒ لا حد إطلاقاً — والآجل كله يرحل 1104 ═══')
{
  // فاتورة 2,000 لعميل بلا حد: نقد 500 فقط — تُقبل بلا أي اعتراض
  const m1 = mark()
  const s1 = st().postSale({ lines: cart(2), customerId: noLimitCust.id, payment: 'cash', treasury: '1101', paidMinor: 50000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
  assert.equal(s1.paidMinor, 50000)
  const l1 = newLines(m1)
  assert.equal(lineOf(l1, '1101').debit, 50000, 'النقد 500 على الخزينة')
  assert.equal(lineOf(l1, '1104').debit, 150000, 'المتبقي 1,500 آجل كامل على 1104')
  ok('عميل بلا حد: فاتورة 2,000 بنقد 500 فقط — قبلها المحرك بلا تحصيل كامل (1,500 على 1104)')
  // نفس المشهد لكن للعميل بحد 5,000 ورصيد مدين 1,500: رصيد+جديد 3,500 > حد؟ لا — 3,500 ≤ 5,000 فتُقبل
  const m2 = mark()
  st().postSale({ lines: cart(2), customerId: limitedCust.id, payment: 'cash', treasury: '1101', paidMinor: 50000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
  assert.equal(lineOf(newLines(m2), '1104').debit, 150000)
  ok('عميل بحد 5,000: رصيد 1,500 + آجل جديد 1,500 = 3,000 ≤ 5,000 → قبلها وابتعد عن الحد')
  // والتجاوز الصريح يُرفض: رصيد 1,500 + آجل 4,000 = 5,500 > حد 5,000
  assert.throws(() => st().postSale({ lines: cart(4), customerId: limitedCust.id, payment: 'cash', treasury: '1101', paidMinor: 0, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true }), /ائتمان/)
  // وبموافقة مدير يُقبل ويُسجل اسم المعتمد
  const s3 = st().postSale({ lines: cart(4), customerId: limitedCust.id, payment: 'cash', treasury: '1101', paidMinor: 0, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, creditLimitOverrideBy: 'المالك' })
  assert.equal(s3.creditLimitOverrideBy, 'المالك')
  ok('تجاوز الحد: 1,500 + 4,000 = 5,500 > 5,000 رُفض — وبموافقة «المالك» قُبل وسُجّل المعتمد على الفاتورة')
}

console.log('\n═══ ② تحصيل الموظف: مفرد + متعدد الطرق + متبقٍ آجل + كشفه وسداده ═══')
{
  // (أ) تحصيل كامل على حساب الموظف: فاتورة 2,000 كلها 1107
  const mA = mark()
  const sA = st().postSale({ lines: cart(2), customerId: noLimitCust.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true,
    paymentAllocations: [{ accountCode: '1107', amountMinor: 200000, employeeId: collector.id, note: 'محصل الشركة' }] })
  assert.equal(sA.paidMinor, 200000, 'الفاتورة مسددة كاملة من منظور العميل')
  assert.equal(sA.payment, 'cash')
  const lA = newLines(mA)
  assert.equal(lineOf(lA, '1107').debit, 200000, '1107 مدين بكامل 2,000 (دين على الموظف)')
  assert.equal(lineOf(lA, '1101').debit, 0, 'لا نقد في الخزينة')
  assert.equal(st().getEmployeeBalance(collector.id), -200000, 'رصيد الموظف عليه 2,000')
  ok('(أ) تحصيل مفرد: فاتورة 2,000 كلها على حساب الموظف — 1107 مدين 2,000 بلا نقطة نقد')
  // (ب) طرق متعددة: نقد 600 + موظف 1,000 + متبقٍ آجل 400
  const mB = mark()
  st().postSale({ lines: cart(2), customerId: noLimitCust.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true,
    paymentAllocations: [{ accountCode: '1101', amountMinor: 60000 }, { accountCode: '1107', amountMinor: 100000, employeeId: collector.id }] })
  const lB = newLines(mB)
  assert.equal(lineOf(lB, '1101').debit, 60000, 'نقد 600')
  assert.equal(lineOf(lB, '1107').debit, 100000, 'موظف 1,000')
  assert.equal(lineOf(lB, '1104').debit, 40000, 'المتبقي 400 آجل على العميل')
  assert.equal(st().getEmployeeBalance(collector.id), -300000, 'الرصيد التراكمي على الموظف 3,000')
  ok('(ب) متعدد: 2,000 = نقد 600 + على الموظف 1,000 + آجل 400 — قيد واحد بالقرش')
  // (ج) الكشف يُظهر كل تحصيل صفّاً مديناً بالوصف المتفق عليه
  const rows = st().getEmployeeStatementRows(collector.id)
  const collectRows = rows.filter((r) => r.description.includes('تحصيل فاتورة'))
  assert.equal(collectRows.length, 2, 'صفان للتحصيل في كشف الموظف')
  assert.equal(collectRows.reduce((s, r) => s + r.debitMinor, 0), 300000)
  for (const r of collectRows) assert.ok(r.description.includes('يسددها نقداً أو تُخصم من راتبه'), `الوصص: ${r.description}`)
  assert.ok(collectRows.every((r) => r.ref.includes('INV') || r.ref.length > 0))
  ok('(ج) كشف الموظف: صفان مدينان «تحصيل فاتورة … على حساب الموظف» بإجمالي 3,000 بالفاتورتين')
  // (د) سداد الموظف بسند قبض 1107 يصفر رصيده
  st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1107', amountMinor: 300000, description: 'تسوية تحصيلات المحصل نقداً', partyKind: 'employee', partyId: collector.id })
  assert.equal(st().getEmployeeBalance(collector.id), 0, 'رصيد الموظف صُفّر')
  assert.equal(acctBal('1107'), 0, 'حساب 1107 صفر بعد السداد')
  ok('(د) سند قبض 3,000 من الموظف (1107/1101): رصيده صُفّر وحساب السلف أُطفئ')
  // (هـ) حارس المحرك: 1107 بلا موظف نشط مرفوض
  assert.throws(() => st().postSale({ lines: cart(1), customerId: noLimitCust.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, paymentAllocations: [{ accountCode: '1107', amountMinor: 100000 }] }), /موظفاً نشطاً/)
  ok('(هـ) التحصيل على 1107 بلا تحديد موظف نشط يُرفض صراحة')
}

console.log('\n═══ ③ مصاريف الفاتورة الداخلية: فوري الخزينة + مستحق لاحقاً ═══')
{
  const beforeTreasury = acctBal('1101')
  const mE = mark()
  const s = st().postSale({ lines: cart(2), customerId: noLimitCust.id, payment: 'cash', treasury: '1101', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true,
    internalExpenses: [
      { id: 'ie1', label: 'نقل للعميل', amountMinor: 20000, accountCode: '5108', settlement: 'paid_now', treasury: '1101', taxTreatment: 'exempt', taxPercent: 0, affectsProfit: true, landedCostAllocation: 'none' },
      { id: 'ie2', label: 'عمولة وسيط مستحقة', amountMinor: 10000, accountCode: '5113', settlement: 'payable_later', payableAccountCode: '2105', beneficiaryName: 'وسيط الأعمال', taxTreatment: 'exempt', taxPercent: 0, affectsProfit: true, landedCostAllocation: 'none' },
    ] })
  const lE = newLines(mE)
  assert.equal(lineOf(lE, '5108').debit, 20000, 'مصروف النقل 200 مدين على 5108')
  assert.equal(lineOf(lE, '5113').debit, 10000, 'عمولة الوسيط 100 مدين على 5113')
  assert.equal(lineOf(lE, '2105').credit, 10000, 'الوسيط دائن 100 على 2105 عمولات مستحقة')
  assert.equal(acctBal('1101') - beforeTreasury, 200000 - 20000, 'الخزينة زادت بالإيراد 2,000 ونقصت بمصروف النقل 200')
  assert.equal(s.internalExpenses?.length, 2, 'المصروفان محفوظان على الفاتورة')
  // المصاريف الداخلية على حساب صاحب المحل ولا ترفع إجمالي مطالبة العميل
  assert.equal(s.totals.totalMinor, 200000, 'إجمالي الفاتورة للعميل 2,000 فقط — المصاريف الداخلية على صاحب المحل لا على العميل')
  ok('مصاريف الفاتورة: نقل 200 (5108/1101) وعمولة وسيط 100 (5113/2105 عمولات مستحقة) — والمطلوب من العميل 2,000 فقط')
}

console.log('\n═══ ④ المشروع: صرف مخزني للموقع + تكاليف + مستخلص بمحتجز وضريبة ═══')
{
  st().addProject({ nameAr: 'تشطيب عيادة الدكتور أحمد', clientName: 'د. أحمد', contractValueMinor: 5000000, retentionPercent: 10, startDate: '2026-09-15', notes: '', clientId: noLimitCust.id })
  const project = st().projects[0]
  st().addEmployee({ nameAr: 'أمين مخزن الموقع', phone: '', jobTitle: 'أمين مخزن', hireDate: '2026-01-01', baseSalaryMinor: 400000, allowancesMinor: 0, active: true, notes: '' })
  st().addEmployee({ nameAr: 'مهندس التنفيذ', phone: '', jobTitle: 'مهندس', hireDate: '2026-01-01', baseSalaryMinor: 900000, allowancesMinor: 0, active: true, notes: '' })
  const [keeper, engineer] = st().employees.slice(-2)
  // (أ) الصرف المخزني للمشروع: 50 علبة × تكلفة 600 = 30,000 → 5110 تكلفة مواد المشروع (والمخزن 1103 دائن)
  const stockBefore = st().items.find((i) => i.id === item.id).stockQty
  const mIssue = mark()
  const req = st().issueMaterials({ projectId: project.id, issuedByEmployeeId: keeper.id, receivedByEmployeeId: engineer.id, lines: [{ itemId: item.id, qty: 50 }], notes: 'صرف تشطيبات العيادة' })
  assert.equal(stockBefore - st().items.find((i) => i.id === item.id).stockQty, 50, 'المخزن خُصم 50')
  const lIssue = newLines(mIssue)
  assert.equal(lineOf(lIssue, '5110').debit, 50 * 60000, 'تكلفة المواد المصروفة 30,000 مدينة على 5110')
  assert.equal(lineOf(lIssue, '1103').credit, 50 * 60000, 'المخزون 1103 دائن بالإخراج بالمتوسط المرجح')
  ok(`(أ) الصرف المخزني ${req.reqNumber}: 50 علبة × تكلفة 600 = 30,000 → 5110 / 1103 والمخزن خُصم فوراً`)
  // (ب) تكلفة مقاولة باطن آجلة 1,500
  st().addProjectCost({ projectId: project.id, kind: 'subcontract', amountMinor: 150000, payment: 'credit', description: 'مقاول كهرباء' })
  assert.equal(st().projectCosts.filter((c) => c.projectId === project.id).reduce((s, c) => s + c.amountMinor, 0), 3150000)
  ok('(ب) تكلفة مقاولة باطن آجلة 1,500 → مجموع تكاليف المشروع 31,500 (مواد 30,000 + باطن 1,500)')
  // (ج) مستخلص 40,000 بضريبة 14% ومحتجز 10%: صافي = 40,000+5,600−4,000 = 41,600 نقداً
  const beforeCash = acctBal('1101')
  const ex = st().addProjectExtract({ projectId: project.id, grossMinor: 4000000, vatPercent: 14, payment: 'cash', description: 'مستخلص 80%', treasury: '1101' })
  assert.equal(ex.totals.retentionMinor, 400000, 'محتجز 10% من الأعمال = 4,000')
  assert.equal(acctBal('1101') - beforeCash, 4160000, 'نقد المستخلص 41,600')
  assert.equal(acctBal('1105'), 400000, 'محتجز ضمان أعمال العميل أصل على 1105')
  // (د) ربحية المشروع من دالة المقاولات مباشرة
  const fresh = st().projects.find((p) => p.id === project.id)
  const pf = projectProfit(fresh, st().projectExtracts.filter((x) => x.projectId === project.id).map((x) => ({ grossMinor: x.totals.grossMinor, retentionMinor: x.totals.retentionMinor })), st().projectCosts.filter((c) => c.projectId === project.id), 0)
  assert.equal(pf.extractedMinor, 4000000)
  assert.equal(pf.costsMinor, 3150000)
  assert.equal(pf.profitMinor, 850000, 'ربح المشروع 8,500')
  assert.equal(pf.costsByKind.subcontract, 150000)
  assert.equal(pf.retentionHeldMinor, 400000)
  assert.equal(pf.progressPercent, 80, 'الإنجاز 80% من العقد')
  ok(`(ج+د) مستخلص 40,000 + ضريبة 5,600 − محتجز 4,000 → نقد 41,600؛ الربحية: مستخلصات 40,000 − تكاليف 31,500 = ربح 8,500 (هامش ${pf.marginPercent}% وإنجاز ${pf.progressPercent}%)`)
}

console.log('\n═══ ⑤ ميزان المراجعة متزن بعد كل الأحداث ═══')
{
  for (const e of st().journal) {
    const d = e.lines.reduce((s, l) => s + l.debit, 0), c = e.lines.reduce((s, l) => s + l.credit, 0)
    assert.equal(d, c, `قيد ${e.id} غير متوازن`)
  }
  const tb = trialBalance(st().journal, { from: '2000-01-01', to: '2100-12-31' })
  assert.equal(tb.balanced, true, 'الميزان غير متوازن')
  ok(`${st().journal.length} قيداً كل واحد متوازن — ميزان المراجعة متزن: ${tb.totalDebitMinor / 100} = ${tb.totalCreditMinor / 100} جنيه (${tb.rows.length} حساباً)`)
}

console.log(`\n✅ جولة المالك — الإجابات المحاسبية بالبرهان الحي: ${pass} فحوص ناجحة`)
