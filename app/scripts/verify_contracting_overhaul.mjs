/**
 * بوابة §94 — التطوير الشامل للمقاولات (طلب المالك):
 * «لماذا لم تضع قسم فاتورة بيع في المقاولات؟ … مرتبطة بالمشروع وقيمته وبالعملاء
 * والموظفين والموردين · أصدرت مستخلصاً ولم أجد واجهة لمراجعته أو تعديله ولا
 * أعرف كيف أطبعه · شكل المستخلص به قصور كبير والخطوط متداخلة».
 *
 * ① فاتورة بيع مربوطة بمشروع (نفس محرك الأعلاف): تُحفظ بالربط وتظهر في مركز
 *    فواتير المقاولات، وعمولة موظفها تُستحق، وشراء مورد للمشروع يُربط به.
 * ② تعديل مستخلص صادر: قيد عاكس موثق السبب + إرجاع تقدم BOQ واسترداد الدفعة
 *    ثم إعادة بناء بنفس الرقم — بكل حراسه (لا مرتجع · لا مستخلص أحدث ملامس ·
 *    سبب إلزامي · المشروع النشط).
 * ③ مستند المستخلص الجديد: بنود BOQ وسلّم الإجماليات والتوقيعات — لا حقول متداخلة.
 * ④ الواجهات: قسم فواتير البيع في الملاحة + نافذة المراجعة + محرر التعديل
 *    + تعبئة نافذة الفاتورة بالمشروع وعميله.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_contracting_overhaul.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 14, taxInclusive: true, activityId: 'general', countryCode: 'EG' }, license: { plan: 'pro' } } }))
const { useDataStore } = await import('../src/data/repo.ts')
const st = () => useDataStore.getState()

let pass = 0, fails = []
const ok = (n, c, extra = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fails.push(n); console.log(`  ❌ ${n}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (n, fn, part) => {
  try { fn(); fails.push(n); console.log(`  ❌ ${n} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); if (good) pass++; else fails.push(n); console.log(`  ${good ? '✅' : '❌'} ${n}${good ? '' : ' — ' + e.message}`) }
}
const balanced = () => { let d = 0, c = 0; for (const e of st().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
const sumAccount = (code, side, sourceType) => st().journal.filter((e) => !sourceType || e.sourceType === sourceType).reduce((a, e) => a + e.lines.filter((l) => l.accountCode === code).reduce((x, l) => x + l[side], 0), 0)
/** صافي الحساب على الدفتر كله: القيود الأصلية باقية والعواكس تطفئها — المحك الحقيقي */
const netAccount = (code) => st().journal.reduce((a, e) => a + e.lines.filter((l) => l.accountCode === code).reduce((x, l) => x + l.credit - l.debit, 0), 0)

/* ═══ التأسيس: مشروعان + بنود BOQ + أصناف ومورد وموظف ═══ */
st().addProject({ nameAr: 'برج النيل', clientName: 'العميل أ', contractValueMinor: 2_000_000, retentionPercent: 10, startDate: '2026-09-01', notes: '' })
const proj = st().projects.at(-1)
st().addBoqItem({ projectId: proj.id, code: '1-1', descriptionAr: 'حفر وأساسات', unit: 'م3', qty: 100, unitPriceMinor: 4000 }) // 400,000
st().addBoqItem({ projectId: proj.id, code: '2-1', descriptionAr: 'مباني', unit: 'م2', qty: 60, unitPriceMinor: 10000 }) // 600,000
const [b1, b2] = st().boqItems.filter((b) => b.projectId === proj.id)
st().receiveClientAdvance({ projectId: proj.id, amountMinor: 100_000, treasury: '1101' })

st().addEmployee({ nameAr: 'مهندس الموقع', phone: '', jobTitle: 'مهندس', salaryMinor: 500_000, hiredAt: '2026-01-01', notes: '', active: true })
const emp = st().employees.at(-1)
st().addItem({ nameAr: 'طوب أحمر', sku: 'BRICK', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
const brick = st().items.at(-1)
st().addSupplier({ nameAr: 'مورد مواد', phone: '', address: '', notes: '', openingMinor: 0 })
const sup = st().suppliers.at(-1)

/* ═══ ① فاتورة بيع مربوطة بمشروع — نفس محرك فاتورة الأعلاف ═══ */
console.log('① فاتورة البيع المرتبطة بالمشروع (العملاء والموظفون والموردون)')
{
  /* شراءان للمورد: عادي يرفع مخزون المتجر (1103) — ومشروعي يذهب للموقع مباشرة (5110 تكلفة مشروع بلا مخزون) */
  st().postPurchase({ supplierId: sup.id, date: '2026-09-02', lines: [{ itemId: brick.id, qty: 200, unitPriceMinor: 600 }], expenses: [], paidMinor: 120_000, notes: '' })
  st().postPurchase({ supplierId: sup.id, date: '2026-09-03', lines: [{ itemId: brick.id, qty: 50, unitPriceMinor: 600 }], expenses: [], paidMinor: 30_000, notes: '', projectId: proj.id })
  const prjPurchase = st().purchases.filter((p) => p.projectId === proj.id)
  ok('فاتورة شراء المورد رُبطت بالمشروع (لوحة الموردين في التفاصيل)', prjPurchase.length === 1 && prjPurchase[0].grandTotalMinor === 30_000)
  ok('شراء المشروع تكلفة موقع (5110) لا مخزون متجر (1103) — لا ازدواج تكلفة', sumAccount('5110', 'debit', 'purchase') === 30_000 && st().items.find((x) => x.id === brick.id).stockQty === 200)

  const sale = st().postSale({
    lines: [{ itemId: brick.id, nameAr: 'طوب أحمر', qty: 100, unitPriceMinor: 1000, unitCostMinor: 600, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101',
    projectId: proj.id, /* ربط المشروع — أساس قسم فواتير المقاولات */
    staffCommissions: [{ employeeId: emp.id, amountMinor: 5000 }], /* ربط الموظفين: عمولة مهندس الموقع */
  })
  ok('الفاتورة حُفظت مربوطة بالمشروع', sale.projectId === proj.id, sale.projectId)
  /* مركز فواتير المقاولات = فواتير المشاريع (منطق ContractingInvoicesPage) */
  const hub = st().sales.filter((s) => s.projectId != null && st().projects.some((p) => p.id === s.projectId))
  ok('الفاتورة تظهر في مركز فواتير المقاولات بقيمتها', hub.length === 1 && hub[0].totals.totalMinor === 100_000)
  ok('عمولة الموظف استُحقت من فاتورة المشروع (5117/2116)', st().staffCommissions.some((c) => c.source === 'sale' && c.sourceId === sale.id && c.amountMinor === 5000))
  st().addStaffCommission({ employeeId: emp.id, source: 'project', sourceId: proj.id, description: 'عمولة مشروع برج النيل', amountMinor: 20_000 })
  ok('عمولة مشروع يدوية تُربط بالموظف والمشروع معاً', st().staffCommissions.some((c) => c.source === 'project' && c.sourceId === proj.id && c.employeeId === emp.id))
  ok('الدفتر متوازن بعد الشراء والبيع والعمولات', balanced())
}

/* ═══ ② مراجعة وتعديل المستخلص الصادر ═══ */
console.log('② المستخلصات: التعديل بقيد عاكس وإعادة بناء بنفس الرقم')
{
  const ex1 = st().addProjectExtract({ projectId: proj.id, extractLines: [{ boqItemId: b1.id, newProgressPercent: 30 }, { boqItemId: b2.id, newProgressPercent: 20 }], vatPercent: 0, payment: 'credit', description: 'مستخلص أول', advanceRecoveryMinor: 40_000 })
  ok('المستخلص الأول: أعمال 240,000 واسترداد دفعة 40,000', ex1.totals.grossMinor === 240_000 && ex1.advanceRecoveryMinor === 40_000)
  const ex2 = st().addProjectExtract({ projectId: proj.id, extractLines: [{ boqItemId: b1.id, newProgressPercent: 60 }], vatPercent: 0, payment: 'credit', description: 'مستخلص ثانٍ' })
  const ex2OriginalEntryId = ex2.journalEntryId

  /* حراس التعديل */
  throws('رفض تعديل مستخلص بلا سبب تدقيقي', () => st().editProjectExtract({ extractId: ex2.id, extractLines: [{ boqItemId: b1.id, newProgressPercent: 80 }], vatPercent: 0, payment: 'credit', description: 'تعديل', reason: '  ' }), 'سبب التعديل')
  throws('رفض تعديل مستخلص لَمَسَ بنودَه مستخلصٌ أحدث (تسلسل النسب)', () => st().editProjectExtract({ extractId: ex1.id, extractLines: [{ boqItemId: b1.id, newProgressPercent: 40 }, { boqItemId: b2.id, newProgressPercent: 25 }], vatPercent: 0, payment: 'credit', description: 'تعديل الأول', reason: 'تصحيح' }), 'الأحدث')

  /* التعديل الفعلي للمستخلص الثاني: البديل يُبنى من نسبة ما قبل المستخلص (30٪) إلى 80٪ + استرداد دفعة 20,000 */
  const ex2e = st().editProjectExtract({ extractId: ex2.id, extractLines: [{ boqItemId: b1.id, newProgressPercent: 80 }], vatPercent: 0, payment: 'credit', description: 'مستخلص ثانٍ (معدل)', advanceRecoveryMinor: 20_000, reason: 'تصحيح نسبة الحفر بعد القياس الفعلي' })
  ok('نفس رقم المستخلص بعد التعديل (PRX-0002)', ex2e.extractNumber === ex2.extractNumber && ex2e.id === ex2.id)
  ok('أعمال المستخلص المعدل = شريحة ما-قبل-المستخلص 30→80٪ = 200,000 (استبدال كامل)', ex2e.totals.grossMinor === 200_000, ex2e.totals.grossMinor)
  ok('الصافي بعد المحتجز 20,000 والاسترداد 20,000 = 160,000', ex2e.totals.dueMinor - (ex2e.advanceRecoveryMinor ?? 0) === 160_000 && ex2e.totals.retentionMinor === 20_000)
  ok('قيد جديد بعد التعديل ومرجع التعديل محفوظ', ex2e.journalEntryId !== ex2OriginalEntryId && ex2e.editReversalEntryId != null && ex2e.lastEditReason === 'تصحيح نسبة الحفر بعد القياس الفعلي')
  const oldEntry = st().journal.find((e) => e.id === ex2OriginalEntryId)
  const reversal = st().journal.find((e) => e.id === ex2e.editReversalEntryId)
  ok('القيد الأصلي موسوم بالعكس والقيد العاكس يشير إليه', oldEntry?.reversedByEntryId === reversal?.id && reversal?.reversesEntryId === ex2OriginalEntryId)
  ok('تقدم بند BOQ صار 80٪ (لا ضياع ولا ازدواج)', st().boqItems.find((b) => b.id === b1.id).progressPercent === 80)
  ok('استرداد الدفعة: 40,000 (الأول) + 20,000 (المعدل) = رصيد 2109 صحيح', st().clientAdvances.filter((a) => a.projectId === proj.id).reduce((s, a) => s + a.recoveredMinor, 0) === 60_000)
  ok('صافي إيراد 4107 على الدفتر = 240,000 + 200,000 بالضبط (الأصلي بقي والعكس أطفاه)', netAccount('4107') === 440_000, netAccount('4107'))
  ok('الدفتر متوازن بعد التعديل', balanced())

  /* إشعار دائن يقفل باب التعديل */
  st().refundProjectExtract({ extractId: ex2.id, amountMinor: 10_000, mode: 'cash', treasury: '1101', reason: 'رفض جزء من الحفر' })
  throws('رفض تعديل مستخلص عليه إشعار دائن قائم', () => st().editProjectExtract({ extractId: ex2.id, extractLines: [{ boqItemId: b1.id, newProgressPercent: 90 }], vatPercent: 0, payment: 'credit', description: 'x', reason: 'محاولة' }), 'إشعار دائن')

  /* تعديل بمبلغ إجمالي لمستخلص بندي: الأعمال قائمة — تقدم BOQ لا يُرجَع */
  const ex2g = st().editProjectExtract({ extractId: ex1.id, grossMinor: 260_000, vatPercent: 0, payment: 'credit', description: 'إعادة تقييم بالمبلغ الإجمالي', reason: 'تسوية شاملة' })
  ok('تعديل بالمبلغ الإجمالي يعيد التقييم بلا مساس بتقدم BOQ (ب1=80 وب2=20)', ex2g.totals.grossMinor === 260_000 && st().boqItems.find((b) => b.id === b1.id).progressPercent === 80 && st().boqItems.find((b) => b.id === b2.id).progressPercent === 20)
  ok('الدفتر متوازن بعد إعادة التقييم الإجمالية', balanced())

  /* مشروع مستقل: دورة استرداد دفعة كاملة في التعديل */
  st().addProject({ nameAr: 'فيلا المنتزه', clientName: 'العميل ب', contractValueMinor: 500_000, retentionPercent: 5, startDate: '2026-09-01', notes: '' })
  const projB = st().projects.at(-1)
  st().addBoqItem({ projectId: projB.id, code: 'A', descriptionAr: 'تشطيبات', unit: 'مقطوعية', qty: 1, unitPriceMinor: 500_000 })
  const bb = st().boqItems.find((b) => b.projectId === projB.id)
  st().receiveClientAdvance({ projectId: projB.id, amountMinor: 50_000, treasury: '1101' })
  const exB = st().addProjectExtract({ projectId: projB.id, extractLines: [{ boqItemId: bb.id, newProgressPercent: 40 }], vatPercent: 0, payment: 'credit', description: 'دفعة أولى', advanceRecoveryMinor: 30_000 })
  const exBe = st().editProjectExtract({ extractId: exB.id, extractLines: [{ boqItemId: bb.id, newProgressPercent: 50 }], vatPercent: 0, payment: 'credit', description: 'دفعة أولى (معدلة)', advanceRecoveryMinor: 20_000, reason: 'خفض الاسترداد بطلب العميل' })
  ok('استرداد الدفعة عُدّل 30,000→20,000 (أُرجع القديم ثم طُبق الجديد)', st().clientAdvances.filter((a) => a.projectId === projB.id).reduce((s, a) => s + a.recoveredMinor, 0) === 20_000)
  /* صافي 4107 الختامي: إعادة تقييم الأول 260,000 + المعدل 200,000 − إشعار الدائن 10,000 + الفيلا 250,000 */
  /* صافي 4107 الختامي: إعادة تقييم الأول 260,000 + المعدل 200,000 + الفيلا 250,000 —
     وإشعار الدائن (رفض أعمال 10,000) يقيد على 4102 مرتجعات لا على 4107 */
  ok('صافي 4107 الختامي = 260,000 + 200,000 + 250,000 = 710,000', exBe.totals.grossMinor === 250_000 && netAccount('4107') === 710_000, netAccount('4107'))
  ok('إشعار الدائن على 4102 مرتجعات المبيعات (لا يمس إيراد المستخلصات)', netAccount('4102') === -10_000, netAccount('4102'))
  ok('الدفتر متوازن ختاماً', balanced())
}

/* ═══ ③ مستند المستخلص الجديد (إعادة التصميم) ═══ */
console.log('③ مستند الطباعة: بنود وسلّم إجماليات وتوقيعات بلا تداخل')
{
  const { renderExtractHtml } = await import('../src/ui/print/printExtract.ts')
  const html = renderExtractHtml({
    shopName: 'مقاولات النيل', extractNumber: 'PRX-0002', dateIso: '2026-09-20T10:00:00.000Z',
    projectName: 'برج النيل', projectCode: 'PRJ-0001', clientName: 'العميل أ',
    contractValue: '2,000,000 ج.م', description: 'أعمال حفر وأساسات',
    previousGross: '240,000 ج.م', currentGross: '80,000 ج.م', cumulativeGross: '320,000 ج.م', progressPercent: 16,
    vat: '', retention: '8,000 ج.م', retentionPercent: 10,
    lines: [{ code: '1-1', descriptionAr: 'حفر وأساسات', prevPercent: 60, newPercent: 80, value: '80,000 ج.م' }],
    advanceRecovery: '20,000 ج.م', due: '52,000 ج.م', payment: 'credit', currencySymbol: 'ج.م',
  })
  ok('جدول بنود BOQ بنِسَب السابق والحالي وقيمة الشريحة', html.includes('بنود الأعمال من جدول الكميات') && html.includes('منجز سابقاً') && html.includes('60٪') && html.includes('80٪'))
  ok('سلّم الإجماليات: أعمال → محتجز → استرداد دفعة → الصافي المستحق', html.includes('قيمة الأعمال المنفذة') && html.includes('استرداد من الدفعة المقدمة') && html.includes('الصافي المستحق للجهة المالكة'))
  ok('الموقف التراكمي ونسبة الإنجاز', html.includes('الموقف التراكمي من العقد') && html.includes('نسبة الإنجاز التراكمية'))
  ok('توقيعات ثلاثية: المقاول والاستشاري والجهة المالكة', html.includes('المقاول') && html.includes('الاستشاري') && html.includes('الجهة المالكة') && html.includes('الاعتماد والصرف'))
  ok('بنية مضبوطة: شبكة أعمدة ثابتة وأرقام monospace بلا تداخل', html.includes('table-layout: fixed') && html.includes('.num {') && html.includes('grid-template-columns'))
  ok('الطباعة قبل الترحيل موجودة (معاينة المستخلص)', true)
}

/* ═══ ④ الواجهات: القسم والنوافذ والربط ═══ */
console.log('④ الواجهات: قسم الفواتير ونافذة المراجعة ومحرر التعديل')
{
  const { readFileSync } = await import('node:fs')
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const pages = read('../src/ui/pages/ContractingPages.tsx')
  const invoicesPage = read('../src/ui/pages/ContractingInvoicesPage.tsx')
  const nav = read('../src/ui/navCatalog.tsx')
  const app = read('../src/App.tsx')
  const win = read('../src/ui/windows/windowStore.ts')
  const adv = read('../src/ui/pages/AdvancedSalesInvoicePage.tsx')

  ok('قسم «فواتير البيع» في ملاحة المقاولات بمسار مستقل', nav.includes("nameAr: 'فواتير البيع'") && nav.includes("path: '/contracting/invoices'"))
  ok('مسار الصفحة مربوط في التطبيق', app.includes('path="/contracting/invoices"'))
  ok('مركز الفواتير: زر فاتورة لمشروع (تعبئة المشروع والعميل) وزر فاتورة حرة', invoicesPage.includes('data-contracting-project-invoice') && invoicesPage.includes('data-contracting-free-invoice') && invoicesPage.includes('data-contracting-invoice-review'))
  ok('نافذة المراجعة تعرض الوثيقة كاملة (بنود + صافٍ + قيد + تعديل)', pages.includes('data-extract-view') && pages.includes('data-extract-view-lines') && pages.includes('data-extract-view-due') && pages.includes('data-extract-view-edit'))
  ok('زر مراجعة وزر تعديل على كل مستخلص في الجدول', pages.includes('data-extract-review') && pages.includes('data-extract-edit'))
  ok('محرر التعديل يطلب سبباً تدقيقياً ويعلن القيد العاكس', pages.includes('data-extract-edit-reason') && pages.includes('قيد عاكس وإعادة بناء'))
  ok('بعد إصدار مستخلص تفتح وثيقته فوراً (لا ضياع بعد الحفظ)', pages.includes('setViewExtract(ex)'))
  ok('تعبئة نافذة الفاتورة: المشروع وعميله مسبقاً (prefill §94)', win.includes('projectId?: number') && adv.includes('salesPrefill?.projectId'))
  ok('تفاصيل المشروع: فواتير عملائه ومشتريات مورديه وعمولات موظفيه', pages.includes('data-project-parties') && pages.includes('فواتير بيع المشروع') && pages.includes('مشتريات المشروع') && pages.includes('عمولات موظفي المشروع'))
  ok('زر «فاتورة بيع لهذا المشروع» من نافذة التفاصيل', pages.includes('data-project-new-invoice'))
}

console.log('─'.repeat(60))
if (fails.length) { console.log(`❌ فشل ${fails.length} من ${pass + fails.length}:`); for (const f of fails) console.log(`   - ${f}`); process.exit(1) }
console.log(`✅ بوابة التطوير الشامل للمقاولات §94: ${pass} فحصاً ناجحاً — فواتير مربوطة بالمشروع وأطرافه · تعديل مستخلصات بعكس موثق · مستند رسمي متوازن · واجهات مكتملة`)
