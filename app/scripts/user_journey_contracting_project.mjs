/**
 * 🏗️ رحلة مشروع مقاولات كامل من العطاء حتى الإقفال (الفحص الفردي لنشاط المقاولات):
 * عرض سعر → تحويل لمشروع → BOQ → دفعة مقدمة → شراء مواد للمخزن → إذن صرف موقع
 * → مقاول باطن (عقد/شهادة بمحتجز واستقطاع/دفعة/إفراج) → عمالة يومية → خطاب ضمان
 * → مستخلص بندي بخصم المقدمة → أمر تغيير → مستخلص ختامي → إفراج محتجز العميل
 * → WIP وربحية → ميزان متزن. كل مبلغ يُتحقق بالقرش.
 *
 * تشغيل: node --experimental-strip-types scripts/user_journey_contracting_project.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'contracting', vatPercent: 14, taxInclusive: false, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { trialBalance } = await import(join(root, 'src/core/financialReports.ts'))
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const acctBal = (code) => st().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((s, l) => s + l.debit - l.credit, 0)

console.log('\n═══ 1) عرض سعر → مشروع بعقد 500,000 ومحتجز 10% ═══')
{
  const q = st().addQuotation({
    kind: 'quotation', clientName: 'شركة النور', clientId: null, titleAr: 'تشطيب فيلا', validUntil: '2026-12-31', notes: '',
    lines: [
      { nameAr: 'محارة', descriptionAr: 'أعمال محارة', qty: 1000, unitAr: 'م2', unitPriceMinor: 30000, estCostMinor: 20000 },
      { nameAr: 'دهانات', descriptionAr: 'أعمال دهانات', qty: 1000, unitAr: 'م2', unitPriceMinor: 20000, estCostMinor: 14000 },
    ],
  })
  // دورة الحالات الصارمة: draft → submitted → won (القفز مرفوض)
  assert.throws(() => st().setQuotationStatus(q.id, 'won'), /لا يمكن الانتقال/)
  st().setQuotationStatus(q.id, 'submitted')
  st().setQuotationStatus(q.id, 'won')
  const project = st().convertQuotationToProject(q.id, 10)
  assert.equal(project.contractValueMinor, 50000000)
  assert.equal(project.retentionPercent, 10)
  // التحويل مرة ثانية مرفوض
  assert.throws(() => st().convertQuotationToProject(q.id, 10), /بالفعل/)
  ok(`عرض ${q.quoteNumber} (رفض القفز للفوز) تحول للمشروع ${project.code} بقيمة 500,000 — والتحويل المزدوج مرفوض`)
}
const project = st().projects[0]

console.log('\n═══ 2) BOQ بندان بموازنة تكلفة ═══')
{
  // بنود العرض انتقلت BOQ تلقائياً مع التحويل (تحويل بضغطة)
  assert.equal(st().boqItems.length, 2, 'بندا العرض صارا BOQ تلقائياً')
  const boqTotal = st().boqItems.reduce((s, b) => s + Math.round(b.qty * b.unitPriceMinor), 0)
  assert.equal(boqTotal, 50000000, 'BOQ = قيمة العقد')
  const budget = st().boqItems.reduce((s, b) => s + Math.round(b.qty * b.estCostMinor), 0)
  assert.equal(budget, 34000000, 'موازنة التكلفة انتقلت أيضاً')
  ok('BOQ تولد آلياً من العرض: بيعي 500,000 وموازنة 340,000')
}

console.log('\n═══ 3) دفعة مقدمة 100,000 من العميل → 2109 ═══')
{
  st().receiveClientAdvance({ projectId: project.id, amountMinor: 10000000, treasury: '1101' })
  assert.equal(st().getAdvanceBalance(project.id), 10000000)
  assert.equal(acctBal('2109'), -10000000, '2109 دائن بالمقدمة')
  ok('المقدمة قُيدت التزاماً (2109) لا إيراداً — رصيدها 100,000')
}

console.log('\n═══ 4) شراء مواد للمخزن ثم إذن صرف للموقع بصارف ومستلم ═══')
{
  st().addItem({ nameAr: 'أسمنت', categoryId: null, unit: 'شيكارة', priceMinor: 0, barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
  const cement = st().items[0]
  st().addSupplier({ nameAr: 'مورد مواد', phone: '', taxNumber: '', address: '', notes: '', isActive: true })
  st().postPurchase({ supplierId: st().suppliers[0].id, date: '2026-09-05', treasury: '1101', notes: '', expenses: [], paidMinor: 0, lines: [{ itemId: cement.id, qty: 200, unitPriceMinor: 15000 }] })
  assert.equal(st().items[0].stockQty, 200)
  st().addEmployee({ nameAr: 'أمين المخزن', phone: '', jobTitle: 'أمين مخزن', hireDate: '2026-01-01', baseSalaryMinor: 500000, allowancesMinor: 0, active: true, notes: '' })
  st().addEmployee({ nameAr: 'مهندس الموقع', phone: '', jobTitle: 'مهندس', hireDate: '2026-01-01', baseSalaryMinor: 900000, allowancesMinor: 0, active: true, notes: '' })
  const [keeper, engineer] = st().employees
  // صارف = مستلم مرفوض
  assert.throws(() => st().issueMaterials({ projectId: project.id, issuedByEmployeeId: keeper.id, receivedByEmployeeId: keeper.id, lines: [{ itemId: cement.id, qty: 10 }], notes: '' }), /نفس الموظف/)
  const req = st().issueMaterials({ projectId: project.id, issuedByEmployeeId: keeper.id, receivedByEmployeeId: engineer.id, lines: [{ itemId: cement.id, qty: 120 }], notes: 'صبة الأساسات' })
  assert.equal(st().items[0].stockQty, 80, 'المخزن خُصم 120')
  // صرف فوق المتاح مرفوض صراحة (لا سالب في المقاولات إطلاقاً)
  assert.throws(() => st().issueMaterials({ projectId: project.id, issuedByEmployeeId: keeper.id, receivedByEmployeeId: engineer.id, lines: [{ itemId: cement.id, qty: 500 }], notes: '' }))
  const materialCost = 120 * 15000
  assert.equal(st().projectCosts.filter((c) => c.projectId === project.id).reduce((s, c) => s + c.amountMinor, 0), materialCost, 'تكلفة المواد على المشروع')
  ok(`${req.reqNumber}: صرف 120 شيكارة (${materialCost / 100} جنيه) → 5110، والحواس (نفس الموظف/فوق المتاح) تعمل`)
}

console.log('\n═══ 5) مقاول باطن: عقد 80,000 بمحتجز 5% واستقطاع 1% ═══')
{
  const sc = st().addSubContract({ projectId: project.id, contractorName: 'مقاول المحارة', scopeAr: 'محارة', contractValueMinor: 8000000, retentionPercent: 5, taxWithholdPercent: 1, startDate: '2026-09-10' })
  // شهادة أعمال 50,000: صافي = 50000 − 2500 محتجز − 500 استقطاع = 47,000
  const cert = st().addSubCertificate({ contractId: sc.id, amountMinor: 5000000, description: 'شهادة 1' })
  assert.equal(cert.retentionMinor, 250000)
  assert.equal(cert.taxWithholdMinor, 50000)
  assert.equal(cert.netMinor, 4700000)
  // الدفع فوق المستحق مرفوض
  assert.throws(() => st().paySubContractor({ contractId: sc.id, amountMinor: 4700001, treasury: '1101' }))
  st().paySubContractor({ contractId: sc.id, amountMinor: 4700000, treasury: '1101' })
  // محتجز الباطن قائم في 2108
  assert.equal(acctBal('2108'), -250000, 'محتجز الباطن 2,500 في 2108')
  const rel = st().releaseSubRetention(sc.id, '1101')
  assert.equal(rel.amount, 250000)
  assert.equal(acctBal('2108'), 0, 'أُفرج المحتجز وصُفّي 2108')
  ok('الباطن: شهادة 50,000 → صافي 47,000 مدفوع + محتجز 2,500 أُفرج — والدفع الزائد مرفوض')
}

console.log('\n═══ 6) عمالة يومية على المشروع ═══')
{
  const w = st().addDailyWorker({ nameAr: 'عم حسن', phone: '', dailyWageMinor: 35000 })
  st().addDailyWorkRecord({ workerId: w.id, projectId: project.id, date: '2026-09-12', days: 6 })
  const settle = st().settleDailyWorker(w.id, '1101')
  assert.equal(settle.total, 6 * 35000)
  ok('6 أيام × 350 = 2,100 سُويت من الخزينة → 5110')
}

console.log('\n═══ 7) خطاب ضمان بهامش ومصاريف ثم رده ═══')
{
  const bond = st().issueBond({ projectId: project.id, bondNumber: 'LG-77', type: 'performance', beneficiary: 'شركة النور', amountMinor: 5000000, marginMinor: 1000000, feesMinor: 25000, bank: '1102', issueDate: '2026-09-01', expiryDate: '2027-09-01' })
  assert.equal(acctBal('1109'), 1000000, 'هامش الضمان أصل مجمد')
  st().settleBond(bond.id, 'released')
  assert.equal(acctBal('1109'), 0, 'رُد الهامش')
  ok('خطاب ضمان 50,000 بهامش 10,000 صدر ورُد — 1109 صفر')
}

console.log('\n═══ 8) مستخلص بندي بخصم مقدمة + أمر تغيير + ختامي + إفراج محتجز ═══')
{
  // مستخلص 1: محارة 60% + دهانات 40% = 180,000 + 80,000 = 260,000
  const [b1, b2] = st().boqItems
  const ex1 = st().addProjectExtract({
    projectId: project.id, vatPercent: 0, payment: 'credit', description: 'مستخلص 1',
    extractLines: [
      { boqItemId: b1.id, newProgressPercent: 60 },
      { boqItemId: b2.id, newProgressPercent: 40 },
    ],
    advanceRecoveryMinor: 5000000,
  })
  assert.equal(ex1.totals.grossMinor, 26000000, 'إجمالي بندي 260,000')
  assert.equal(ex1.totals.retentionMinor, 2600000, 'محتجز 10% = 26,000')
  assert.equal(st().getAdvanceBalance(project.id), 5000000, 'استُرد 50,000 من المقدمة')
  // استرداد أكبر من رصيد المقدمة مرفوض
  assert.throws(() => st().addProjectExtract({ projectId: project.id, vatPercent: 0, payment: 'credit', description: 'خطأ', grossMinor: 1000000, advanceRecoveryMinor: 9000000 }))
  // أمر تغيير معتمد +30,000 يرفع العقد الفعال
  st().addChangeOrder({ projectId: project.id, titleAr: 'أعمال إضافية بالحديقة', amountMinor: 3000000 })
  st().setChangeOrderStatus(st().changeOrders[0].id, 'approved')
  const wip1 = st().getProjectWip(project.id)
  assert.equal(wip1.contractMinor, 53000000, 'العقد الفعال 530,000 بعد أمر التغيير')
  // المستخلص الختامي (الباقي 270,000) بخصم باقي المقدمة 50,000
  const ex2 = st().addProjectExtract({ projectId: project.id, vatPercent: 0, payment: 'credit', description: 'المستخلص الختامي', grossMinor: 27000000, advanceRecoveryMinor: 5000000, isFinal: true })
  assert.equal(st().getAdvanceBalance(project.id), 0, 'المقدمة أُطفئت كاملة')
  // لا مستخلص بعد الختامي
  assert.throws(() => st().addProjectExtract({ projectId: project.id, vatPercent: 0, payment: 'credit', description: 'بعد الختامي', grossMinor: 100 }), /الختامي/)
  // إفراج محتجز العميل: 10% × (260,000 + 270,000) = 53,000
  const rel = st().releaseRetention(project.id, '1101')
  assert.equal(rel.amount, 2600000 + 2700000, 'إفراج المحتجز 53,000')
  ok(`مستخلصان (بندي + ختامي) بإجمالي 530,000، مقدمة مستهلكة، محتجز ${rel.amount / 100} أُفرج، والحُراس يعملون`)
}

console.log('\n═══ 9) الربحية وWIP والميزان ═══')
{
  const profit = st().getProjectProfit(project.id)
  assert.equal(profit.extractedMinor, 53000000, 'إيراد المستخلصات 530,000')
  const materialCost = 120 * 15000
  const expectedCosts = materialCost + 5000000 + 6 * 35000 // مواد + شهادة باطن + يوميات
  assert.equal(profit.costsMinor, expectedCosts, `تكاليف المشروع ${expectedCosts / 100}`)
  assert.equal(profit.profitMinor, 53000000 - expectedCosts)
  const tb = trialBalance(st().journal, { from: '2020-01-01', to: '2030-12-31' })
  assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, 'الميزان متزن')
  // كل قيد متزن فردياً
  for (const e of st().journal) {
    const d = e.lines.reduce((s, l) => s + l.debit, 0)
    const c = e.lines.reduce((s, l) => s + l.credit, 0)
    assert.equal(d, c, `قيد ${e.id} غير متزن`)
  }
  ok(`ربح المشروع ${profit.profitMinor / 100} جنيه، ${st().journal.length} قيداً كلها متزنة، الميزان ${tb.totalDebitMinor}`)
}

console.log(`\n✅ رحلة المقاولات الكاملة: ${pass} محطات — كلها خضراء\n`)
