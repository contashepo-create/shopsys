/**
 * فحص أوامر التعديل — دفعة المقاولات والتشغيل:
 * 1) يوميات بلا مشروع → مصروف تشغيل عام 5108 (والمشروعية → 5110)
 * 2) بنود كاملة للعروض (اسم/وصف/كمية/وحدة/سعر/تكلفة تقديرية) + ربط عميل إداري بلا أثر مالي
 * 3) تحويل عرض → مشروع بضغطة: البنود تنتقل BOQ كاملة
 * 4) رصيد العميل من الفاتورة فقط + تحصيل FIFO + مطابقة محددة اختيارية
 * 5) أذون صرف مواد: متوسط مرجح، صارف/مستلم إلزاميان، تحويل وحدات، منع السالب، تدقيق حركة
 * 6) مستخلصات باطن باستقطاعات آلية (محتجز + ضريبة استقطاع + استرداد دفعة مقدمة)
 * 7) EVM: موازنة/فعلي/قيمة مكتسبة + تنبيه تجاوز
 * 8) محرك موافقات تسلسلية على الإجراءات الحرجة
 * تشغيل: node --experimental-strip-types scripts/verify_project_ops.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis

const { useDataStore } = await import('../src/data/repo.ts')
const { allocateClientPayment, computeProjectEvm } = await import('../src/core/projectOps.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
const item = (over) => ({
  nameAr: 'x', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})
const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })

console.log('🏗️ التأسيس: عميل + موظفان + أصناف مواد')
S().addCustomer({ ...party('شركة النيل العقارية'), creditLimitMinor: 0 })
const client = S().customers.at(-1)
S().addEmployee({ ...party('حسن أمين المخزن'), jobTitle: 'أمين مخزن', hireDate: '2025-01-01', baseSalaryMinor: 500000, allowancesMinor: 0, active: true })
const storekeeper = S().employees.at(-1)
S().addEmployee({ ...party('م. كريم مهندس الموقع'), jobTitle: 'مهندس موقع', hireDate: '2025-01-01', baseSalaryMinor: 900000, allowancesMinor: 0, active: true })
const engineer = S().employees.at(-1)
S().addEmployee({ ...party('أ. سمير المحاسب الأول'), jobTitle: 'محاسب أول', hireDate: '2025-01-01', baseSalaryMinor: 800000, allowancesMinor: 0, active: true })
const accountant = S().employees.at(-1)
// أسمنت: شراء بالطن وصرف بالشيكارة (وحدات متعددة)
S().addItem(item({ nameAr: 'أسمنت مقاوم', baseUnit: 'شيكارة', costMinor: 20000, stockQty: 100, priceMinor: 26000, extraUnits: [{ nameAr: 'طن', factor: 20, barcode: '', priceMinor: 0 }] }))
const cement = S().items.at(-1).id
S().addItem(item({ nameAr: 'حديد تسليح', baseUnit: 'طن', costMinor: 4000000, stockQty: 10, priceMinor: 4500000 }))
const steel = S().items.at(-1).id

console.log('\n📋 (2)+(3) عرض سعر ببنود كاملة وربط عميل إداري → تحويل بضغطة')
const balBefore1104 = bal('1104')
S().addQuotation({
  kind: 'tender', clientName: client.nameAr, clientId: client.id, titleAr: 'إنشاء مخازن الحي الصناعي', validUntil: '2026-12-31',
  lines: [
    { nameAr: 'الحفر', descriptionAr: 'حفر حتى منسوب التأسيس', qty: 500, unitAr: 'م3', unitPriceMinor: 12000, estCostMinor: 8000 },
    { nameAr: 'الخرسانات', descriptionAr: 'خرسانة مسلحة للقواعد والأعمدة', qty: 200, unitAr: 'م3', unitPriceMinor: 250000, estCostMinor: 190000 },
    { nameAr: 'المباني', descriptionAr: 'مباني طوب أسمنتي مصمت', qty: 1000, unitAr: 'م2', unitPriceMinor: 15000, estCostMinor: 11000 },
  ], notes: '',
})
const quote = S().quotations.at(-1)
ok('العرض ببنود كاملة (اسم+وصف+تكلفة تقديرية)', quote.lines.length === 3 && quote.lines[0].nameAr === 'الحفر' && quote.lines[1].estCostMinor === 190000)
ok('الربط الإداري بالعميل محفوظ', quote.clientId === client.id)
ok('لا أثر على رصيد العميل من العرض المربوط', bal('1104') === balBefore1104)
throws('ربط بعميل غير موجود يُرفض', () => S().addQuotation({ kind: 'quotation', clientName: 'س', clientId: 999, titleAr: 'ع', validUntil: '2026-12-31', lines: [{ nameAr: 'ب', descriptionAr: 'ب', qty: 1, unitAr: 'عدد', unitPriceMinor: 100, estCostMinor: 0 }], notes: '' }), 'العميل المربوط غير موجود')
S().setQuotationStatus(quote.id, 'submitted')
S().setQuotationStatus(quote.id, 'won')
const project = S().convertQuotationToProject(quote.id, 5)
ok('تحويل بضغطة: مشروع متولد بقيمة العقد الكاملة', project.contractValueMinor === 500 * 12000 + 200 * 250000 + 1000 * 15000)
ok('الربط الإداري انتقل للمشروع', project.clientId === client.id)
const projBoq = S().boqItems.filter((b) => b.projectId === project.id)
ok('بنود العرض الثلاثة انتقلت BOQ كاملة', projBoq.length === 3 && projBoq[1].estCostMinor === 190000 && projBoq[2].qty === 1000)
ok('إنشاء المشروع المربوط لم يمس رصيد العميل', bal('1104') === balBefore1104)

console.log('\n👷 (1) يوميات مرنة: مشروع → 5110، بلا مشروع → 5108 تشغيل عام')
S().addDailyWorker({ nameAr: 'عم صابر', phone: '', dailyWageMinor: 30000 })
const worker = S().dailyWorkers.at(-1)
S().addDailyWorkRecord({ workerId: worker.id, projectId: project.id, date: '2026-09-10', days: 4 })
S().addDailyWorkRecord({ workerId: worker.id, projectId: null, date: '2026-09-12', days: 2 }) // نظافة المخازن — تشغيل عام
const g5108Before = bal('5108'), g5110Before = bal('5110')
const settle = S().settleDailyWorker(worker.id, '1101')
ok('التسوية جمعت السجلين', settle.total === 6 * 30000 && settle.recordCount === 2)
ok('أجور المشروع → 5110 (120)', bal('5110') - g5110Before === 120000)
ok('أجور التشغيل العام → 5108 (60)', bal('5108') - g5108Before === 60000)
ok('تكلفة المشروع سُجلت للمشروعي فقط', S().projectCosts.filter((c) => c.projectId === project.id && c.kind === 'labor').reduce((s, c) => s + c.amountMinor, 0) === 120000)

console.log('\n📦 (5) أذون صرف المواد: وحدات متعددة + متوسط مرجح + صارف/مستلم إلزاميان')
throws('إذن بلا صارف يُرفض', () => S().issueMaterials({ projectId: project.id, issuedByEmployeeId: 999, receivedByEmployeeId: engineer.id, lines: [{ itemId: cement, qty: 1, unitAr: '' }], notes: '' }), 'أمين المخزن')
throws('الصارف = المستلم يُرفض', () => S().issueMaterials({ projectId: project.id, issuedByEmployeeId: storekeeper.id, receivedByEmployeeId: storekeeper.id, lines: [{ itemId: cement, qty: 1, unitAr: '' }], notes: '' }), 'نفس الموظف')
throws('وحدة غير معرفة تُرفض', () => S().issueMaterials({ projectId: project.id, issuedByEmployeeId: storekeeper.id, receivedByEmployeeId: engineer.id, lines: [{ itemId: cement, qty: 1, unitAr: 'كرتونة' }], notes: '' }), 'غير معرفة')
throws('صرف يفوق الرصيد يُرفض بصرامة (6 طن = 120 شيكارة > 100)', () => S().issueMaterials({ projectId: project.id, issuedByEmployeeId: storekeeper.id, receivedByEmployeeId: engineer.id, lines: [{ itemId: cement, qty: 6, unitAr: 'طن' }], notes: '' }), 'لا يكفي')
const inv1103Before = bal('1103'), cost5110Before = bal('5110')
const req = S().issueMaterials({
  projectId: project.id, issuedByEmployeeId: storekeeper.id, receivedByEmployeeId: engineer.id,
  lines: [
    { itemId: cement, qty: 2, unitAr: 'طن' }, // = 40 شيكارة × 200 = 8000 قرش... (20000 قرش/شيكارة → 40×20000)
    { itemId: steel, qty: 1.5, unitAr: '' }, // طن مباشرة
  ], notes: 'صبّة القواعد',
})
ok('رقم المستند MRQ والصارف والمستلم بالاسم', req.reqNumber === 'MRQ-0001' && req.issuedByName.includes('حسن') && req.receivedByName.includes('كريم'))
ok('تحويل الوحدة: 2 طن = 40 شيكارة', req.lines[0].baseQty === 40 && req.lines[0].unitFactor === 20)
const expectedCost = 40 * 20000 + Math.round(1.5 * 4000000)
ok('التكلفة بالمتوسط المرجح', req.totalCostMinor === expectedCost)
ok('قيد 5110/1103 بالتكلفة', bal('5110') - cost5110Before === expectedCost && inv1103Before - bal('1103') === expectedCost)
ok('المخزون انخفض (أسمنت 60، حديد 8.5)', S().items.find((i) => i.id === cement).stockQty === 60 && S().items.find((i) => i.id === steel).stockQty === 8.5)
ok('التكلفة دخلت تكاليف المشروع بند مواد', S().projectCosts.some((c) => c.projectId === project.id && c.kind === 'materials' && c.amountMinor === expectedCost))
const moves = S().stockMoves.filter((m) => m.docType === 'material_issue' && m.docId === req.id)
ok('سجل تدقيق الحركة كامل (سطران بسالب ورصيد بعدي)', moves.length === 2 && moves[0].qtyDelta === -40 && moves[0].balanceAfter === 60 && moves[0].byUser.includes('حسن'))

console.log('\n💰 (4) رصيد العميل من الفاتورة فقط + تحصيل FIFO + مطابقة محددة')
// مستخلصان آجلان على المشروع المربوط إدارياً
S().addProjectExtract({ projectId: project.id, grossMinor: 1000000, vatPercent: 14, payment: 'credit', description: 'مستخلص أعمال الحفر' })
const ex1 = S().projectExtracts.at(-1)
S().addProjectExtract({ projectId: project.id, grossMinor: 2000000, vatPercent: 14, payment: 'credit', description: 'مستخلص الخرسانات' })
const ex2 = S().projectExtracts.at(-1)
// وفاتورة بيع آجلة للعميل نفسه (مواد فائضة مثلاً)
const sale = S().postSale({
  lines: [{ itemId: cement, nameAr: 'أسمنت مقاوم', qty: 10, unitPriceMinor: 26000, unitCostMinor: 20000, discountPercent: 0, soldByWeight: false }],
  payment: 'credit', treasury: '1101', customerId: client.id, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, allowNegativeStock: false,
})
const openInv = S().getOpenClientInvoices(client.id)
ok('3 مستندات مفتوحة (مستخلصان + فاتورة) بالأقدم أولاً', openInv.length === 3 && openInv[0].docKey === `extract:${ex1.id}`)
ok('مستحق المستخلص بعد المحتجز والضريبة', openInv[0].dueMinor === ex1.totals.dueMinor && ex1.totals.dueMinor === 1000000 + 140000 - 50000)
const ar1104 = bal('1104')
// تحصيل FIFO: يغطي الأول كاملاً وجزءاً من الثاني
const pay1 = S().receiveClientPayment({ customerId: client.id, amountMinor: 1500000, treasury: '1101' })
ok('FIFO: الأقدم أُطفئ كاملاً والباقي للثاني', pay1.allocations.length === 2 && pay1.allocations[0].docKey === `extract:${ex1.id}` && pay1.allocations[0].appliedMinor === 1090000 && pay1.allocations[1].appliedMinor === 410000)
ok('قيد التحصيل خفض 1104 بكامل المبلغ', ar1104 - bal('1104') === 1500000)
ok('لا فائض غير مخصص', pay1.unallocatedMinor === 0)
// مطابقة محددة: تخصيص لفاتورة البيع تحديداً رغم أن المستخلص الثاني أقدم
const pay2 = S().receiveClientPayment({ customerId: client.id, amountMinor: 260000, treasury: '1101', specificDocKey: `sale:${sale.id}` })
ok('المطابقة المحددة أطفأت فاتورة البيع أولاً', pay2.allocations[0].docKey === `sale:${sale.id}` && pay2.allocations[0].appliedMinor === 260000)
const openAfter = S().getOpenClientInvoices(client.id)
ok('بقي المستخلص الثاني وحده مفتوحاً', openAfter.length === 1 && openAfter[0].docKey === `extract:${ex2.id}`)
// دفعة تحت الحساب (تفوق المفتوح)
const remaining = openAfter[0].dueMinor - openAfter[0].settledMinor
const pay3 = S().receiveClientPayment({ customerId: client.id, amountMinor: remaining + 100000, treasury: '1101' })
ok('الفائض يبقى دفعة تحت الحساب غير مخصصة', pay3.unallocatedMinor === 100000)
ok('كل الفواتير مقفلة', S().getOpenClientInvoices(client.id).length === 0)
throws('تحصيل بمطابقة على فاتورة مقفلة يُرفض', () => S().receiveClientPayment({ customerId: client.id, amountMinor: 1000, treasury: '1101', specificDocKey: `sale:${sale.id}` }), 'غير مفتوحة')

console.log('\n🔧 (6) مقاول باطن: مورد مربوط + دفعة مقدمة + استقطاعات آلية')
S().addSupplier({ ...party('مؤسسة الصفا للحدادة'), creditLimitMinor: 0 })
const sub = S().suppliers.at(-1)
S().addSubContract({
  projectId: project.id, contractorName: sub.nameAr, supplierId: sub.id, scopeAr: 'حدادة مسلحة كاملة',
  contractValueMinor: 3000000, retentionPercent: 10, taxWithholdPercent: 3, boqItemIds: [projBoq[1].id], startDate: '2026-09-01',
})
const contract = S().subContracts.at(-1)
ok('عقد باطن مربوط بمورد وببند BOQ وباستقطاع 3٪', contract.supplierId === sub.id && contract.boqItemIds.length === 1 && contract.taxWithholdPercent === 3)
throws('إسناد بند من مشروع آخر يُرفض', () => S().addSubContract({ projectId: project.id, contractorName: 'س', scopeAr: 'س', contractValueMinor: 100, retentionPercent: 0, boqItemIds: [9999], startDate: '2026-09-01' }), 'ليس من بنود')
S().addSubAdvance({ contractId: contract.id, amountMinor: 300000, treasury: '1101' })
ok('الدفعة المقدمة أصل 1111', bal('1111') === 300000 && S().getSubAdvanceBalance(contract.id) === 300000)
const ap2101Before = bal('2101')
const cert = S().addSubCertificate({ contractId: contract.id, amountMinor: 1000000, description: 'حدادة القواعد', advanceRecoveryMinor: 200000 })
ok('الاستقطاعات آلية: محتجز 100 + استقطاع 30 + استرداد 200', cert.retentionMinor === 100000 && cert.taxWithholdMinor === 30000 && cert.advanceRecoveryMinor === 200000)
ok('الصافي المستحق = 670 (زيادة دائنة على الموردين)', cert.netMinor === 670000 && ap2101Before - bal('2101') === 670000)
ok('ضريبة الاستقطاع التزام 2112', bal('2112') === -30000)
ok('استرداد الدفعة أطفأ 1111 جزئياً', bal('1111') === 100000 && S().getSubAdvanceBalance(contract.id) === 100000)
ok('الشهادة تكلفة مشروع مباشرة بالإجمالي', S().projectCosts.some((c) => c.projectId === project.id && c.kind === 'subcontract' && c.amountMinor === 1000000))
throws('استرداد يفوق رصيد الدفعات يُرفض', () => S().addSubCertificate({ contractId: contract.id, amountMinor: 500000, description: 'س', advanceRecoveryMinor: 150000 }), 'أكبر من رصيد')
const remit = S().remitWithholdingTax('1102')
ok('توريد ضريبة الاستقطاع أقفل 2112', remit.amount === 30000 && bal('2112') === 0)

console.log('\n📊 (7) القيمة المكتسبة EVM: موازنة/فعلي/إنجاز وتنبيه تجاوز')
S().updateBoqProgress(projBoq[0].id, 100) // الحفر انتهى
S().updateBoqProgress(projBoq[1].id, 40) // الخرسانات 40٪
const evm = S().getProjectEvm(project.id)
const expectedBac = 500 * 8000 + 200 * 190000 + 1000 * 11000
ok('BAC = مجموع موازنات البنود', evm.budgetAtCompletionMinor === expectedBac)
const expectedEv = Math.round(500 * 12000 * 1) + Math.round(200 * 250000 * 0.4) + 0
ok('EV = قيمة الإنجاز بسعر البيع', evm.earnedValueMinor === expectedEv)
ok('AC = التكاليف الفعلية المسجلة', evm.actualCostMinor === S().projectCosts.filter((c) => c.projectId === project.id).reduce((s, c) => s + c.amountMinor, 0))
ok('تنبيه التجاوز يشتغل عند فعلي > موازنة مكتسبة', evm.costOverrun === (evm.actualCostMinor > evm.earnedBudgetMinor) && evm.overrunMinor === (evm.costOverrun ? evm.actualCostMinor - evm.earnedBudgetMinor : 0))
ok('CPI محسوب', evm.cpi !== null && Math.abs(evm.cpi - Math.round((evm.earnedBudgetMinor / evm.actualCostMinor) * 100) / 100) < 0.001)
// وحدة نقية: تجاوز مؤكد
const pure = computeProjectEvm([{ boqItemId: 1, code: '1', descriptionAr: 'بند', qty: 10, unitPriceMinor: 1000, estCostMinor: 700, progressPercent: 50 }], 5000)
ok('نواة EVM: موازنة مكتسبة 3500 وفعلي 5000 ⇒ تجاوز 1500', pure.costOverrun && pure.overrunMinor === 1500 && pure.cpi === 0.7)

console.log('\n🔐 (8) محرك الموافقات التسلسلية على الإجراءات الحرجة')
S().setApprovalFlow('material_requisition', [
  { roleAr: 'مهندس الموقع', employeeId: engineer.id },
  { roleAr: 'المحاسب الأول', employeeId: accountant.id },
], true)
throws('إذن صرف بلا اعتماد يُرفض بعد تفعيل المسار', () => S().issueMaterials({ projectId: project.id, issuedByEmployeeId: storekeeper.id, receivedByEmployeeId: engineer.id, lines: [{ itemId: cement, qty: 1, unitAr: '' }], notes: '' }), 'يتطلب اعتماداً')
const reqApproval = S().requestApproval('material_requisition', 'صرف أسمنت للمباني', project.id)
S().decideApproval(reqApproval.id, 'approved', 'م. كريم', 'مطلوب للموقع')
ok('بعد المستوى الأول ما زال معلقاً (تسلسلي)', S().approvalRequests.find((r) => r.id === reqApproval.id).status === 'pending')
throws('التنفيذ قبل اكتمال المستويات يُرفض', () => S().issueMaterials({ projectId: project.id, issuedByEmployeeId: storekeeper.id, receivedByEmployeeId: engineer.id, lines: [{ itemId: cement, qty: 1, unitAr: '' }], notes: '' }), 'يتطلب اعتماداً')
S().decideApproval(reqApproval.id, 'approved', 'أ. سمير', '')
ok('اكتمل الاعتماد بعد المستويين', S().approvalRequests.find((r) => r.id === reqApproval.id).status === 'approved')
const gatedReq = S().issueMaterials({ projectId: project.id, issuedByEmployeeId: storekeeper.id, receivedByEmployeeId: engineer.id, lines: [{ itemId: cement, qty: 5, unitAr: '' }], notes: 'معتمد' })
ok('التنفيذ نجح بعد الاعتماد', gatedReq.reqNumber === 'MRQ-0002')
throws('الاعتماد يُستهلك — تنفيذ ثانٍ يحتاج اعتماداً جديداً', () => S().issueMaterials({ projectId: project.id, issuedByEmployeeId: storekeeper.id, receivedByEmployeeId: engineer.id, lines: [{ itemId: cement, qty: 1, unitAr: '' }], notes: '' }), 'يتطلب اعتماداً')
// رفض في أي مستوى يقفل الطلب
const rej = S().requestApproval('material_requisition', 'صرف إضافي', project.id)
S().decideApproval(rej.id, 'rejected', 'م. كريم', 'لا حاجة')
ok('الرفض في المستوى الأول يقفل الطلب نهائياً', S().approvalRequests.find((r) => r.id === rej.id).status === 'rejected')
S().setApprovalFlow('material_requisition', [{ roleAr: 'مدير', employeeId: null }], false)
const freeReq = S().issueMaterials({ projectId: project.id, issuedByEmployeeId: storekeeper.id, receivedByEmployeeId: engineer.id, lines: [{ itemId: cement, qty: 1, unitAr: '' }], notes: '' })
ok('تعطيل المسار يعيد الإجراء حراً', freeReq.reqNumber === 'MRQ-0003')

console.log('\n🧮 نواة FIFO النقية (وحدات)')
const allocs = allocateClientPayment(700, [
  { docKey: 'a', docLabel: 'أ', date: '2026-01-02', dueMinor: 500, settledMinor: 0 },
  { docKey: 'b', docLabel: 'ب', date: '2026-01-01', dueMinor: 400, settledMinor: 100 },
], null)
ok('الأقدم (ب) أولاً ثم (أ)', allocs.allocations[0].docKey === 'b' && allocs.allocations[0].appliedMinor === 300 && allocs.allocations[1].appliedMinor === 400 && allocs.unallocatedMinor === 0)
const spec = allocateClientPayment(200, [
  { docKey: 'a', docLabel: 'أ', date: '2026-01-01', dueMinor: 500, settledMinor: 0 },
  { docKey: 'b', docLabel: 'ب', date: '2026-01-02', dueMinor: 400, settledMinor: 0 },
], 'b')
ok('المطابقة المحددة تقدّم (ب) رغم حداثته', spec.allocations[0].docKey === 'b' && spec.allocations[0].appliedMinor === 200)

console.log('\n⚖️ الميزان')
ok('الدفتر متوازن بعد كل العمليات', balanced())

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 أوامر التعديل الخلفية كلها تعمل: يوميات مرنة، بنود كاملة، تحويل بضغطة، تحصيل FIFO، أذون صرف، باطن باستقطاعات، EVM، موافقات')
