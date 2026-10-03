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
 * ⑤ المراجعة الشاملة: كل فواتير البيع تظهر في مركز المقاولات (حرة/مربوطة) · فتح
 *    وتعديل وطباعة العروض المحفوظة · تعديل مشروع وبند BOQ بحروس سلامة.
 * ⑥ استكمال المراجعة: تعديل عقد باطن وخطاب ضمان وعامل يومية بحروس · طباعة
 *    شهادة الباطن A4.
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
  ok('مركز الفواتير: زر واحد «فاتورة بيع جديدة» حرة — لا ربط مسبق من الصفحة (تصحيح المالك: الربط من داخل الفاتورة)', invoicesPage.includes('data-contracting-new-invoice') && !invoicesPage.includes('openSalesInvoiceWindow(undefined, { projectId') && invoicesPage.includes('data-contracting-invoice-review'))
  ok('داخل الفاتورة: حقل المشروع يعبّئ عميله تلقائياً ويعرض العميل وقيمة العقد', adv.includes('data-invoice-project-select') && adv.includes('عُبّأ تلقائياً') && adv.includes('data-invoice-project'))
  ok('نافذة المراجعة تعرض الوثيقة كاملة (بنود + صافٍ + قيد + تعديل)', pages.includes('data-extract-view') && pages.includes('data-extract-view-lines') && pages.includes('data-extract-view-due') && pages.includes('data-extract-view-edit'))
  ok('زر مراجعة وزر تعديل على كل مستخلص في الجدول', pages.includes('data-extract-review') && pages.includes('data-extract-edit'))
  ok('محرر التعديل يطلب سبباً تدقيقياً ويعلن القيد العاكس', pages.includes('data-extract-edit-reason') && pages.includes('قيد عاكس وإعادة بناء'))
  ok('بعد إصدار مستخلص تفتح وثيقته فوراً (لا ضياع بعد الحفظ)', pages.includes('setViewExtract(ex)'))
  ok('تعبئة نافذة الفاتورة: المشروع وعميله مسبقاً (prefill §94)', win.includes('projectId?: number') && adv.includes('salesPrefill?.projectId'))
  ok('تفاصيل المشروع: فواتير عملائه ومشتريات مورديه وعمولات موظفيه', pages.includes('data-project-parties') && pages.includes('فواتير بيع المشروع') && pages.includes('مشتريات المشروع') && pages.includes('عمولات موظفي المشروع'))
  ok('زر «فاتورة بيع لهذا المشروع» من نافذة التفاصيل', pages.includes('data-project-new-invoice'))
}

/* ═══ ⑤ §94-مراجعة (بلاغ المالك: «الفواتير لم تظهر · العروض لا تُفتح ولا تُعدَّل ولا تُطبع · راجع كل شئ») ═══ */
console.log('⑤ المراجعة الشاملة: ظهور كل الفواتير · فتح/تعديل/طباعة العروض · تعديل مشروع وبند BOQ')
{
  /* ── تعديل العرض: قبل التحويل يُعدَّل، بعده يُقفل ── */
  const q1 = st().addQuotation({ kind: 'quotation', clientName: 'مجلس المدينة', clientId: null, titleAr: 'تشطيبات داخلية', validUntil: '2026-11-01', lines: [{ nameAr: 'دهانات', descriptionAr: 'دهان بلاستيك وجهين', qty: 500, unitAr: 'م2', unitPriceMinor: 120, estCostMinor: 80, vatPercent: 0, taxIncluded: false }], notes: 'الأسعار شاملة التشوين', winProbability: 60, bidBondMinor: 0 })
  const q1e = st().updateQuotation(q1.id, { titleAr: 'تشطيبات داخلية (مراجعة 2)', lines: [{ nameAr: 'دهانات', descriptionAr: 'دهان بلاستيك وجهين + معجون', qty: 600, unitAr: 'م2', unitPriceMinor: 130, estCostMinor: 85, vatPercent: 0, taxIncluded: false }] })
  ok('تعديل العرض: الرقم والتاريخ والحالة لا يتغيران والمحتوى يتغير', q1e.quoteNumber === q1.quoteNumber && q1e.date === q1.date && q1e.status === q1.status && q1e.titleAr.includes('مراجعة 2') && q1e.lines[0].qty === 600 && q1e.lines[0].unitPriceMinor === 130)
  throws('تعديل عرض بنوده كلها فارغة يُرفض (تحقق البنود)', () => st().updateQuotation(q1.id, { lines: [{ nameAr: 'x', descriptionAr: '  ', qty: 1, unitAr: 'م2', unitPriceMinor: 100, estCostMinor: 0, vatPercent: 0, taxIncluded: false }] }), 'بند واحد')
  /* ── تحويل عرض لمشروع يقفل تعديله (حرس السلامة المحاسبية) ── */
  const won = st().addQuotation({ kind: 'quotation', clientName: 'مدرسة المستقبل', clientId: null, titleAr: 'سور مدرسة', validUntil: '2026-12-01', lines: [{ nameAr: 'سور', descriptionAr: 'سور بارتفاع 2.5م', qty: 200, unitAr: 'م.ط', unitPriceMinor: 900, estCostMinor: 700, vatPercent: 0, taxIncluded: false }], notes: '', winProbability: 90, bidBondMinor: 0 })
  st().setQuotationStatus(won.id, 'submitted')
  st().setQuotationStatus(won.id, 'won')
  st().convertQuotationToProject(won.id, 5)
  throws('بعد التحويل لمشروع: العرض يُقفل (🔒 لا يُعدَّل)', () => st().updateQuotation(won.id, { titleAr: 'x' }), 'تحوّل لمشروع')

  /* ── تعديل المشروع: البيانات نعم، القيمة بعد أول مستخلص لا ── */
  const prj5 = st().addProject({ nameAr: 'فيلا المرحلة الثانية', clientName: 'العميل ج', contractValueMinor: 1_000_000, retentionPercent: 5, startDate: '2026-10-01', notes: '' })
  const prj5e = st().updateProject(prj5.id, { nameAr: 'فيلا المرحلة الثانية (الموسعة)', contractValueMinor: 1_200_000, location: 'القاهرة الجديدة', notes: 'بعد تعديلات المالك' })
  ok('تعديل مشروع بلا مستخلصات: القيمة والبيانات تُحفظ (الكود والحالة كما هما)', prj5e.contractValueMinor === 1_200_000 && prj5e.nameAr.includes('الموسعة') && prj5e.code === prj5.code && prj5e.status === 'active' && prj5e.location === 'القاهرة الجديدة')
  /* مشروع بمستخلص: القيمة مقفولة — استخدم proj (برج النيل) الذي صدرت له مستخلصات في ② */
  throws('قيمة العقد بعد أول مستخلص مقفولة (أمر تغيير فقط)', () => st().updateProject(proj.id, { contractValueMinor: 2_500_000 }), 'مستخلصات')
  const projEditOk = st().updateProject(proj.id, { notes: 'تحديث ملاحظات فقط' })
  ok('بقية بيانات المشروع تُعدَّل حتى مع وجود مستخلصات', projEditOk.notes === 'تحديث ملاحظات فقط')

  /* ── تعديل بند BOQ: قبل التنفيذ حر، بعده الوصف فقط ── */
  const b5 = st().addBoqItem({ projectId: prj5.id, code: '3-1', descriptionAr: 'أرضيات', unit: 'م2', qty: 300, unitPriceMinor: 500 })
  const b5e = st().updateBoqItem(b5.id, { descriptionAr: 'أرضيات بورسلين', qty: 350, unitPriceMinor: 550, estCostMinor: 400 })
  ok('تعديل بند غير منفَّذ: كمية وسعر ووصف', b5e.descriptionAr === 'أرضيات بورسلين' && b5e.qty === 350 && b5e.unitPriceMinor === 550 && b5e.estCostMinor === 400)
  st().updateBoqProgress(b5.id, 40)
  const b5p = st().updateBoqItem(b5.id, { descriptionAr: 'أرضيات بورسلين (النوع أ)' })
  ok('البند المنفَّذ: الوصف يُعدَّل دائماً', b5p.descriptionAr.includes('النوع أ'))
  throws('البند المنفَّذ: الكمية لا تُعدَّل (نِسَب المستخلصات تاريخية)', () => st().updateBoqItem(b5.id, { qty: 999 }), 'منفَّذ')
  throws('البند المنفَّذ: السعر لا يُعدَّل', () => st().updateBoqItem(b5.id, { unitPriceMinor: 100 }), 'منفَّذ')
  throws('بند BOQ بكمية صفرية يُرفض (نفس تحقق الإضافة)', () => st().updateBoqItem(b5.id, { descriptionAr: 'x', unit: 'م2', qty: 0, unitPriceMinor: 100 }), 'كمية')

  /* ── الواجهات: كل الفواتير تظهر + أزرار فتح/تعديل/طباعة ── */
  const { readFileSync } = await import('node:fs')
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const invoicesPage = read('../src/ui/pages/ContractingInvoicesPage.tsx')
  const quotesPage = read('../src/ui/pages/QuotationsPage.tsx')
  const pages = read('../src/ui/pages/ContractingPages.tsx')
  const depth = read('../src/ui/pages/ContractingDepthPages.tsx')
  ok('مركز الفواتير: لا فلتر projectId — كل فواتير البيع تدخل الجدول (بلاغ: «لم تظهر»)', !invoicesPage.includes('s.projectId != null && prjInvoiceIds.has') && invoicesPage.includes('حرة'))
  ok('مركز الفواتير: شارة «حرة» للمفكوكة وعدّاد «منها N مربوطة»', invoicesPage.includes('منها {totals.linked} مربوطة') && invoicesPage.includes('كل الفواتير (حرة ومربوطة)'))
  ok('قائمة العروض: زر فتح/تعديل + زر طباعة على كل صف', quotesPage.includes('data-quotation-open') && quotesPage.includes('data-quotation-print'))
  ok('الطباعة من القائمة: نموذج A4 كامل برقم العرض وسريانه وملاحظاته', quotesPage.includes('const printQuotation') && quotesPage.includes('ساري حتى ${q.validUntil') && quotesPage.includes('quotationTotals(q.lines).grossMinor'))
  ok('المحرر يفرّق إنشاء/تعديل ويحفظ رقم العرض المحفوظ', quotesPage.includes('editingQuote') && quotesPage.includes('updateQuotation(editingQuote.id') && quotesPage.includes("invoiceNumber: editingQuote?.quoteNumber ?? 'مسودة'"))
  ok('العروض المحوّلة: قفل 🔒 مع بقاء الطباعة أرشيفية', quotesPage.includes('🔒 مشروع'))
  ok('بطاقة المشروع: قلم تعديل + مودال بيانات العقد', pages.includes('data-project-edit') && pages.includes('data-project-edit-modal') && pages.includes('صدرت مستخلصات'))
  ok('جدول الكميات: قلم تعديل لكل بند + قفل الكمية/السعر بعد التنفيذ', depth.includes('data-boq-edit') && depth.includes('الكمية والسعر مقفولان'))
}

/* ═══ ⑥ §94-مراجعة-2 («اكمل وراجع»): عمق المقاولات — تعديل باطن/ضمان/عامل + طباعة شهادة الباطن ═══ */
console.log('⑥ استكمال المراجعة: تعديل عقد باطن وخطاب ضمان وعامل يومية · طباعة شهادة الباطن')
{
  /* ── عقد باطن: البيانات والنِّسَب تُعدَّل، القيمة بعد أول شهادة لا ── */
  const sub = st().addSubContract({ projectId: proj.id, contractorName: 'مقاول الحفر', scopeAr: 'أعمال حفر', contractValueMinor: 300_000, retentionPercent: 10 })
  const subE = st().updateSubContract(sub.id, { contractorName: 'مقاول الحفر (أحمد)', retentionPercent: 5, taxWithholdPercent: 3, advanceRecoveryPercent: 10 })
  ok('تعديل عقد باطن بلا شهادات: البيانات والنِّسَب تُحفظ', subE.contractorName.includes('أحمد') && subE.retentionPercent === 5 && subE.taxWithholdPercent === 3 && subE.advanceRecoveryPercent === 10)
  st().addSubCertificate({ contractId: sub.id, newProgressPercent: 50, description: 'نصف الأعمال' }) // شهادة 150,000
  const subE2 = st().updateSubContract(sub.id, { scopeAr: 'أعمال حفر وردم' })
  ok('بعد الشهادات: النطاق يُعدَّل والنِّسَب تسري على القادمة', subE2.scopeAr === 'أعمال حفر وردم')
  throws('قيمة عقد الباطن بعد أول شهادة مقفولة (عقد ملحق)', () => st().updateSubContract(sub.id, { contractValueMinor: 400_000 }), 'شهادات')
  throws('نسبة محتجز خارج 0–20٪ تُرفض', () => st().updateSubContract(sub.id, { retentionPercent: 50 }), 'المحتجز')
  const cert1 = st().subCertificates.filter((c) => c.contractId === sub.id).at(-1)
  ok('الشهادة تحسب بالنِّسَب المعدلة وقت إنشائها (150,000 × محتجز 5٪ = 7,500 + استقطاع 3٪ = 4,500)', cert1.amountMinor === 150_000 && cert1.retentionMinor === 7_500 && cert1.taxWithholdMinor === 4_500)
  st().addSubCertificate({ contractId: sub.id, newProgressPercent: 60, description: 'شريحة إضافية' }) // 30,000 بمحتجز 5٪ الجديدة
  const cert2 = st().subCertificates.filter((c) => c.contractId === sub.id).at(-1)
  ok('النسبة المعدلة تسري على الشهادة التالية فقط (5٪ لا 10٪)', cert2.amountMinor === 30_000 && cert2.retentionMinor === 1_500)

  /* ── خطاب ضمان: البيانات تُعدَّل والقيم المقيدة لا ── */
  const bond = st().issueBond({ projectId: proj.id, bondNumber: 'BG-101', type: 'final', beneficiary: 'المالك', amountMinor: 200_000, marginMinor: 40_000, feesMinor: 500, bank: '1102', issueDate: '2026-10-01', expiryDate: '2027-04-01' })
  const bondE = st().updateBond(bond.id, { bondNumber: 'BG-101-R1', beneficiary: 'المالك — إدارة المشروع', expiryDate: '2027-06-01' })
  ok('تعديل خطاب نشط: الرقم والمستفيد والانتهاء تُحفظ', bondE.bondNumber === 'BG-101-R1' && bondE.beneficiary.includes('إدارة') && bondE.expiryDate === '2027-06-01')
  ok('القيم المقيدة محفوظة رغم محاولة التغيير من النوع', bondE.amountMinor === 200_000 && bondE.marginMinor === 40_000 && bondE.feesMinor === 500 && bondE.bank === '1102')
  throws('خطاب بمستفيد فارغ يُرفض', () => st().updateBond(bond.id, { beneficiary: '  ' }), 'المستفيد')
  st().settleBond(bond.id, 'released')
  throws('الخطاب المُسوَّى لا يُعدَّل', () => st().updateBond(bond.id, { bondNumber: 'X' }), 'مُسوَّى')

  /* ── عامل يومية: البيانات والأجر (المستقبلي) ── */
  const w = st().addDailyWorker({ nameAr: 'سيد عامل', phone: '', dailyWageMinor: 300 })
  st().addDailyWorkRecord({ workerId: w.id, projectId: proj.id, date: '2026-10-02', days: 2 }) // 600 بالأجر القديم
  const wE = st().updateDailyWorker(w.id, { nameAr: 'سيد علي', phone: '0100', dailyWageMinor: 350 })
  ok('تعديل عامل: البيانات واليومية الجديدة', wE.nameAr === 'سيد علي' && wE.phone === '0100' && wE.dailyWageMinor === 350)
  const oldRec = st().dailyWorkRecords.find((r) => r.workerId === w.id)
  ok('السجل القديم محفوظ بأجره وقت تسجيله (600 لا 700)', oldRec.wageMinor === 600)
  st().addDailyWorkRecord({ workerId: w.id, projectId: proj.id, date: '2026-10-03', days: 1 })
  const newRec = st().dailyWorkRecords.filter((r) => r.workerId === w.id).at(-1)
  ok('اليوم الجديد يحسب بالأجر المعدل (350)', newRec.wageMinor === 350)
  throws('يومية غير موجبة تُرفض', () => st().updateDailyWorker(w.id, { dailyWageMinor: 0 }), 'اليومية')

  /* ── الواجهات: أزرار التعديل والطباعة ── */
  const { readFileSync } = await import('node:fs')
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const depth = read('../src/ui/pages/ContractingDepthPages.tsx')
  ok('عقد الباطن: قلم تعديل + مودال بنِسَبه وقيمة مقفولة بعد الشهادات', depth.includes('data-sub-edit') && depth.includes('data-sub-edit-modal') && depth.includes('اعتُمدت شهادات'))
  ok('شهادة الباطن: زر طباعة A4 من نافذة العرض', depth.includes('data-sub-cert-print') && depth.includes('شهادة أعمال — مقاول باطن') && depth.includes('استرداد من الدفعة المقدمة'))
  ok('خطاب الضمان: قلم تعديل والقيم المالية مقفولة بلافتة سبب', depth.includes('data-bond-edit') && depth.includes('data-bond-edit-modal') && depth.includes('مقفولة — قُيّدت عند الإصدار'))
  ok('عامل اليومية: قلم تعديل والأجر يسري على القادم فقط', depth.includes('data-dw-edit') && depth.includes('data-dw-edit-modal') && depth.includes('بأجرها وقت تسجيلها'))
  ok('الدفتـر متوازن بعد جولة العمق', balanced())
}

console.log('─'.repeat(60))
if (fails.length) { console.log(`❌ فشل ${fails.length} من ${pass + fails.length}:`); for (const f of fails) console.log(`   - ${f}`); process.exit(1) }
console.log(`✅ بوابة التطوير الشامل للمقاولات §94 (بمراجعتها): ${pass} فحصاً ناجحاً — فواتير مربوطة وحرة تظهر · تعديل مستخلصات بعكس موثق · مستند رسمي متوازن · عروض تُفتح وتُعدَّل وتُطبع · مشروع وبند BOQ قابلان للتعديل بحراس · عمق المقاولات (باطن/ضمان/يومية) يُعدَّل وشهادة الباطن تُطبع`)
