/**
 * جولة المالك — عمق مستودع البيانات المتبقي (§79): postSaleReturn + postWastage
 * (صف «مستودع البيانات — ترحيل الفواتير» في جدول P0: «يتبقى postSaleReturn/
 * postWastage بعمق» — البيع/الشراء/الحروس روجعت في جولات سابقة).
 *
 * تغطي هذه البوابة ما لم تغطه verify_returns_all_cases (41 فحصاً):
 *   ① نواة المرتجعات الصرفة: سقوف الرد الهجين والتوزيع الحر (ملكية عشوائية)
 *   ② السطر-بسطر: remainingByLine/buildReturnLinesPerLine وسجلات ما قبل الترقية
 *   ③ postSaleReturn حياً: هجين الدفع المجزأ · توزيع حر · تالف/سليم · وحدة كبرى ·
 *      تسوية عمولة · رد ماكينة
 *   ④ postWastage حياً: FEFO بالإعدام · مكرر مرفوض · رصيد لا يصبح سالباً ·
 *      صرف داخلي بنفس النمط
 * تشغيل: node --experimental-strip-types scripts/verify_owner_returns_wastage_depth.mjs
 */
const relDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 14, taxInclusive: false } } }))

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}

let seed = 20261004
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))

/* ─── ① نواة المرتجعات الصرفة: سقوف الرد الهجين والتوزيع الحر ─── */
console.log('① سقوف الرد الهجين والتوزيع الرباعي — ملكية عشوائية')
{
  const { allocationOf, splitRefund, validateRefundAllocation, buildReturnEntryAlloc, returnCashRefundMinor } = await import('../src/core/returns.ts')
  /* الحالة المتاحة دائماً من دفتر حقيقي: قيمة المرتجع المتبقية ≤ المفتوح + المحصل
     (برهان: كل مرتجع سابق أنقص «المتبقي القابل للإرجاع» بما أنفقه من نقدي/ذمم/رصيد/تنازل،
     والمفتوح+المحصل ينقصان فقط بالنقدي/الذمم — فبقي المتبقي ≤ المفتوح+المحصل دائماً) */
  for (let t = 0; t < 4000; t++) {
    const value = ri(1, 10 ** 6)
    const received = ri(0, 10 ** 6)
    const openCredit = Math.max(0, value - received) + ri(0, 10 ** 5) /* ≥ value − received */
    for (const mode of ['cash', 'credit']) {
      const alloc = allocationOf(value, mode, openCredit, received)
      if (alloc.cashMinor + alloc.creditMinor + alloc.storeCreditMinor + alloc.waivedMinor !== value) throw new Error(`مجموع التوزيع انكسر (${mode})`)
      if (alloc.cashMinor > received) throw new Error('نقدي فوق المحصل')
      if (alloc.creditMinor > openCredit) throw new Error('ذمم فوق المفتوح')
      if (Object.values(alloc).some((v) => v < 0)) throw new Error('قيمة سالبة')
    }
  }
  /* دفاعياً: أي مدخلات (حتى غير متاحة) لا تنتج قيماً سالبة ولا كسراً للمجموع */
  for (let t = 0; t < 2000; t++) {
    const value = ri(1, 10 ** 6)
    const alloc = allocationOf(value, t % 2 ? 'cash' : 'credit', ri(-(10 ** 4), 10 ** 6), ri(-(10 ** 4), 10 ** 6))
    if (alloc.cashMinor + alloc.creditMinor + alloc.storeCreditMinor + alloc.waivedMinor !== value) throw new Error('مجموع انكسر دفاعياً')
    if (Object.values(alloc).some((v) => v < 0)) throw new Error('سالب دفاعياً')
    if (alloc.cashMinor > Math.max(0, alloc.cashMinor)) throw new Error('مستحيل')
  }
  /* store_credit: كلها رصيد بلا سقف وبلا نقدية */
  const sc = allocationOf(5000, 'store_credit', 0, 10 ** 6)
  ok('store_credit: كامل القيمة رصيد ولا نقدية', sc.storeCreditMinor === 5000 && sc.cashMinor === 0 && sc.creditMinor === 0)
  /* الحالتان القطبيتان تحافظان على السلوك القديم */
  ok('فاتورة نقدية كاملة: رد نقدي كامل', splitRefund(700, 'cash', 0, 700).cashMinor === 700)
  ok('فاتورة آجلة كاملة: كلها ذمم', splitRefund(700, 'credit', 700, 0).creditMinor === 700)
  /* تحقق التوزيع الحر: كل مسارات الرفض */
  const base = { cashMinor: 0, creditMinor: 0, storeCreditMinor: 0, waivedMinor: 0 }
  ok('مجموع ناقص يُرفض', validateRefundAllocation(100, { ...base, cashMinor: 90 }, 0, 100).some((e) => e.includes('لا يساوي')))
  ok('نقدي فوق المحصل يُرفض', validateRefundAllocation(100, { ...base, cashMinor: 100 }, 0, 50).some((e) => e.includes('يتجاوز المُحصَّل')))
  ok('ذمم فوق المفتوح تُرفض', validateRefundAllocation(100, { ...base, creditMinor: 100 }, 40, 100).some((e) => e.includes('المفتوح')))
  ok('عميل نقدي لا ذمم ولا رصيد', validateRefundAllocation(100, { ...base, storeCreditMinor: 100 }, 0, 0, false).some((e) => e.includes('نقدي')))
  ok('كسر يُرفض', validateRefundAllocation(100, { ...base, cashMinor: 50.5 }, 0, 100).some((e) => e.includes('صحيحاً')))
  ok('توزيع سليم كامل يمر', validateRefundAllocation(100, { cashMinor: 40, creditMinor: 30, storeCreditMinor: 20, waivedMinor: 10 }, 30, 40, true).length === 0)
  /* التوافق الخلفي: سجل قديم بلا تقسيم */
  ok('سجل قديم cash يُحسب رده كاملاً', returnCashRefundMinor({ refund: 'cash', totals: { totalMinor: 900 } }) === 900)
  ok('سجل قديم credit رده صفر', returnCashRefundMinor({ refund: 'credit', totals: { totalMinor: 900 } }) === 0)
  /* القيد بالتوزيع الحر متوازن دائماً ويفصل التالف — 3,000 حالة */
  for (let t = 0; t < 3000; t++) {
    const total = ri(1, 10 ** 6)
    const taxBase = ri(0, total)
    const tax = total - taxBase
    const cogs = ri(0, 10 ** 6)
    const damaged = ri(0, cogs)
    let cash = ri(0, total), credit = ri(0, total - cash)
    let storeCreditMinor = ri(0, total - cash - credit)
    const waived = total - cash - credit - storeCreditMinor
    const totals = { taxBaseMinor: taxBase, taxMinor: tax, totalMinor: total, cogsMinor: cogs }
    const lines = buildReturnEntryAlloc(totals, { cashMinor: cash, creditMinor: credit, storeCreditMinor, waivedMinor: waived }, '1101', damaged)
    const dr = lines.reduce((s, l) => s + l.debit, 0), cr = lines.reduce((s, l) => s + l.credit, 0)
    if (dr !== cr) throw new Error('قيد مرتجع غير متوازن')
    const stock = lines.find((l) => l.accountCode === '1103')?.debit ?? 0
    const dmg = lines.find((l) => l.accountCode === '5111')?.debit ?? 0
    if (stock !== cogs - damaged || dmg !== damaged) throw new Error('انفصال تالف/سليم')
    if ((lines.find((l) => l.accountCode === '5101')?.credit ?? 0) !== cogs) throw new Error('COGS غير معكوس كاملاً')
  }
  throws('تالف فوق التكلفة يُرفض', () => buildReturnEntryAlloc({ taxBaseMinor: 0, taxMinor: 0, totalMinor: 100, cogsMinor: 50 }, { cashMinor: 100, creditMinor: 0, storeCreditMinor: 0, waivedMinor: 0 }, '1101', 51), 'تتجاوز')
  console.log(`  ✓ 4,000 توزيع تلقائي + 3,000 قيد رباعي متوازن + كل مسارات الرفض`)
}

/* ─── ② السطر-بسطر: الترقية العالمية وسجلات ما قبلها ─── */
console.log('② بناء سطور المرتجع سطراً بسطر')
{
  const { buildReturnLinesPerLine, remainingByLine, buildReturnLines } = await import('../src/core/returns.ts')
  const saleLines = [
    { itemId: 1, nameAr: 'قميص أ', qty: 3, unitPriceMinor: 1000, unitCostMinor: 400, discountPercent: 0 },
    { itemId: 1, nameAr: 'قميص أ', qty: 2, unitPriceMinor: 1200, unitCostMinor: 400, discountPercent: 0 },
    { itemId: 2, nameAr: 'بنطلون', qty: 4, unitPriceMinor: 2000, unitCostMinor: 800, discountPercent: 0 },
  ]
  /* لا مرتجعات سابقة: المتبقي = كميات الأصل بالسطر */
  ok('المتبقي بالسطر قبل أي مرتجع', JSON.stringify(remainingByLine(saleLines, [])) === JSON.stringify([3, 2, 4]))
  /* مرتجع سطر-بسطر: كل سطر بسعره الأصلي */
  const perLine = buildReturnLinesPerLine(saleLines, [], [
    { lineIndex: 1, qty: 2, condition: 'damaged' },
    { lineIndex: 2, qty: 1, condition: 'resellable' },
  ])
  ok('السطر الثاني بسعره الأصلي (1200) لا سعر السطر الأول', perLine[0].unitPriceMinor === 1200 && perLine[0].qty === 2 && perLine[0].condition === 'damaged')
  ok('مرجع السطر الأصلي محفوظ', perLine[0].saleLineIndex === 1 && perLine[1].saleLineIndex === 2)
  /* منع تجاوز المتبقي بالسطر تحديداً */
  throws('إرجاع أكثر من سطر بعينه يُرفض', () => buildReturnLinesPerLine(saleLines, [], [{ lineIndex: 0, qty: 4, condition: 'resellable' }]), 'المتبقي القابل للإرجاع 3')
  throws('سطر مكرر في الطلب يُرفض', () => buildReturnLinesPerLine(saleLines, [], [{ lineIndex: 0, qty: 1, condition: 'resellable' }, { lineIndex: 0, qty: 1, condition: 'damaged' }]), 'مكرر')
  throws('فهرس سطر غير موجود', () => buildReturnLinesPerLine(saleLines, [], [{ lineIndex: 9, qty: 1, condition: 'resellable' }]), 'غير موجود')
  /* سجلات ما قبل الترقية (بلا saleLineIndex) تُستهلك من سطور نفس الصنف بالترتيب */
  const legacy = [{ itemId: 1, nameAr: 'قميص أ', qty: 4, unitPriceMinor: 1000, unitCostMinor: 400, discountPercent: 0 }]
  const remAfterLegacy = remainingByLine(saleLines, legacy)
  ok('سجل قديم يستهلك السطر الأول ثم الثاني', JSON.stringify(remAfterLegacy) === JSON.stringify([0, 1, 4]), `فعلي ${remAfterLegacy}`)
  /* الوضع القديم بالصنف: يستهلك بالترتيب ويحافظ على سعر كل سطر */
  const byItem = buildReturnLines(saleLines, [], new Map([[1, 4]]))
  ok('كمية بالصنف تُوزع على سطوره بالترتيب وبأسعارها', byItem.length === 2 && byItem[0].qty === 3 && byItem[0].unitPriceMinor === 1000 && byItem[1].qty === 1 && byItem[1].unitPriceMinor === 1200)
  throws('كمية بالصنف فوق المتبقي تُرفض', () => buildReturnLines(saleLines, [], new Map([[1, 6]])), 'المتبقي')
  console.log('  ✓ سطر-بسطر + سجلات قديمة + وضع الصنف — ثلاثة أنماط متسقة')
}

/* ─── ③ postSaleReturn حياً: الهجين والتالف والوحدة الكبرى والعمولة والماكينة ─── */
console.log('③ postSaleReturn حياً بالمخزن الفعلي')
{
  const { useDataStore } = await import('../src/data/repo.ts')
  const S = () => useDataStore.getState()
  const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
  const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
  const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
  const item = (over) => ({ nameAr: 'ص', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over })

  S().addCustomer(party('عميل الهجين'))
  const cust = S().customers[0]
  S().addItem(item({ nameAr: 'هجين', costMinor: 20000, stockQty: 100, priceMinor: 50000 }))
  const hyItem = S().items[0]
  const hyLine = { itemId: hyItem.id, nameAr: 'هجين', qty: 20, unitPriceMinor: 50000, unitCostMinor: 20000, discountPercent: 0, soldByWeight: false }
  /* فاتورة آجلة مدفوعة جزئياً 400 من 1000 */
  const sale = S().postSale({ lines: [hyLine], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, paidMinor: 400000, treasury: '1101' })
  ok('فاتورة الهجين: 1000 آجل منها 400 مدفوعة', sale.totals.totalMinor === 1000000 && sale.paidMinor === 400000)
  ok('1104 مدين 600 (المفتوح)', bal('1104') === 600000, `فعلي ${bal('1104')}`)

  /* مرتجع 500 نقدي: 400 نقداً (سقف المحصل) + 100 ذمم */
  const ret1 = S().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 10, condition: 'resellable' }], refund: 'cash', reason: 'تغيير رأي' })
  ok('الرد الهجين: نقدي 400 + ذمم 100', ret1.cashRefundMinor === 400000 && ret1.creditRefundMinor === 100000, `نقدي ${ret1.cashRefundMinor} ذمم ${ret1.creditRefundMinor}`)
  ok('الخزينة ردت 400 فقط (ما استُلم فعلاً)', bal('1101') === 0, `فعلي ${bal('1101')}`)
  ok('1104 مدين 500 (600 − 100 رد ذمم)', bal('1104') === 500000, `فعلي ${bal('1104')}`)
  ok('المخزون عاد 10 بالسليم (80→90)', S().items.find((i) => i.id === hyItem.id).stockQty === 90)

  /* مرتجع ثانٍ نقدي: المحصل المتبقي صفر ⇒ كله ذمم (المفتوح 500) */
  const ret2 = S().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 5, condition: 'resellable' }], refund: 'cash', reason: 'x' })
  ok('لا محصل متبقٍ ⇒ صفر نقدية و250 ذمم', ret2.cashRefundMinor === 0 && ret2.creditRefundMinor === 250000, `نقدي ${ret2.cashRefundMinor}`)
  ok('الميزان متوازن بعد هجينين', balanced())

  /* التوزيع الحر: رفض كل التجاوزات ثم مزيج سليم */
  throws('توزيع حر ناقص يُرفض', () => S().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'custom', allocation: { cashMinor: 0, creditMinor: 10000, storeCreditMinor: 0, waivedMinor: 0 }, reason: 'x' }), 'لا يساوي')
  throws('توزيع حر بنقدي فوق المحصل يُرفض', () => S().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'custom', allocation: { cashMinor: 50000, creditMinor: 0, storeCreditMinor: 0, waivedMinor: 0 }, reason: 'x' }), 'المُحصَّل')
  const ret3 = S().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 2, condition: 'resellable' }], refund: 'custom', allocation: { cashMinor: 0, creditMinor: 50000, storeCreditMinor: 50000, waivedMinor: 0 }, reason: 'مزيج' })
  ok('مزيج ذمم+رصيد يعمل ويسجل التفصيل', ret3.creditRefundMinor === 100000 && ret3.storeCreditRefundMinor === 50000)
  /* تجاوز المتبقي بعد ثلاثة مرتجعات (10+5+2=17 من 20) */
  throws('إرجاع فوق المتبقي للسطر يُرفض', () => S().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 4, condition: 'resellable' }], refund: 'cash', reason: 'x' }), 'المتبقي')

  /* التالف مقابل السليم: مرتجعان متتاليان على نفس الفاتورة (السطر الواحد بشرطين = طلبان) */
  S().addItem(item({ nameAr: 'تالف', costMinor: 30000, stockQty: 50, priceMinor: 100000 }))
  const dmgItem = S().items.at(-1)
  const dmgSale = S().postSale({ lines: [{ itemId: dmgItem.id, nameAr: 'تالف', qty: 2, unitPriceMinor: 100000, unitCostMinor: 30000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  const dmgStockAfterSale = S().items.find((i) => i.id === dmgItem.id).stockQty
  throws('سطر واحد بشرطين مختلفين في نفس الطلب يُرفض (مكرر)', () => S().postSaleReturn({ saleId: dmgSale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }, { lineIndex: 0, qty: 1, condition: 'damaged' }], refund: 'cash', reason: 'x' }), 'مكرر')
  const dmgRet1 = S().postSaleReturn({ saleId: dmgSale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'damaged' }], refund: 'cash', reason: 'عيب مصنعي', reasonCode: 'defective' })
  ok('التالف لا يعود للمخزون إطلاقاً', S().items.find((i) => i.id === dmgItem.id).stockQty === dmgStockAfterSale)
  const e1 = S().journal.find((e) => e.id === dmgRet1.journalEntryId)
  ok('قيد التالف: 5111 مدين 300 وبلا 1103 و5101 معكوس 300',
    (e1.lines.find((l) => l.accountCode === '5111')?.debit ?? 0) === 30000 &&
    !e1.lines.some((l) => l.accountCode === '1103') &&
    (e1.lines.find((l) => l.accountCode === '5101')?.credit ?? 0) === 30000)
  ok('سبب الإرجاع الموثق محفوظ', dmgRet1.reasonCode === 'defective')
  const dmgRet2 = S().postSaleReturn({ saleId: dmgSale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'cash', reason: 'سليم' })
  ok('السليم وحده يعود للمخزون (+1)', S().items.find((i) => i.id === dmgItem.id).stockQty === dmgStockAfterSale + 1)
  const e2 = S().journal.find((e) => e.id === dmgRet2.journalEntryId)
  ok('قيد السليم: 1103 مدين 300 وبلا 5111',
    (e2.lines.find((l) => l.accountCode === '1103')?.debit ?? 0) === 30000 &&
    !e2.lines.some((l) => l.accountCode === '5111'))
  ok('القيدين متوازنان', e1.lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0 && e2.lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0)

  /* الوحدة الكبرى: كرتونة ×12 تعود 12 وحدة بقيمتها الكاملة */
  S().addItem(item({ nameAr: 'شراب وحدة', costMinor: 3000, stockQty: 240, priceMinor: 5000, extraUnits: [{ nameAr: 'كرتونة', factor: 12 }] }))
  const unitItem = S().items.at(-1)
  const unitSale = S().postSale({ lines: [{ itemId: unitItem.id, nameAr: 'شراب وحدة (كرتونة)', qty: 2, unitPriceMinor: 55000, unitCostMinor: 36000, discountPercent: 0, soldByWeight: false, unitFactor: 12, unitLabel: 'كرتونة' }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  ok('بيع كرتونتين خصم 24 وحدة', S().items.find((i) => i.id === unitItem.id).stockQty === 216)
  S().postSaleReturn({ saleId: unitSale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'cash', reason: 'x' })
  ok('مرتجع كرتونة أعاد 12 وحدة أساسية', S().items.find((i) => i.id === unitItem.id).stockQty === 228)
  ok('متوسط التكلفة ثابت 30 (قيمة كاملة راجعت)', S().items.find((i) => i.id === unitItem.id).costMinor === 3000, `فعلي ${S().items.find((i) => i.id === unitItem.id).costMinor}`)

  /* تسوية العمولة: مستحقة تنعكس نسبياً والمصروفة تصير خصماً */
  S().addEmployee({ nameAr: 'مندوب مرتجعات', phone: '', jobTitle: 'مندوب', salaryMinor: 0, hiredAt: '2026-01-01', notes: '', active: true })
  const emp = S().employees.at(-1)
  const commSale = S().postSale({ lines: [{ itemId: hyItem.id, nameAr: 'هجين', qty: 4, unitPriceMinor: 50000, unitCostMinor: 20000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', staffCommission: { employeeId: emp.id, amountMinor: 40000 } })
  ok('العمولة استُحقت 400', S().staffCommissions.some((c) => c.source === 'sale' && c.sourceId === commSale.id && c.amountMinor === 40000))
  /* مرتجع نصف الفاتورة (2 من 4 = 200 من 400) */
  S().postSaleReturn({ saleId: commSale.id, lineSpecs: [{ lineIndex: 0, qty: 2, condition: 'resellable' }], refund: 'cash', reason: 'x' })
  const commAfter = S().staffCommissions.find((c) => c.source === 'sale' && c.sourceId === commSale.id)
  ok('العمولة انعكست نسبياً (400−200=200)', commAfter.amountMinor === 20000 && commAfter.returnAdjustedMinor === 20000, `فعلي ${commAfter.amountMinor}`)
  /* مرتجع الباقي ⇒ ملغاة */
  S().postSaleReturn({ saleId: commSale.id, lineSpecs: [{ lineIndex: 0, qty: 2, condition: 'resellable' }], refund: 'cash', reason: 'x' })
  const commFinal = S().staffCommissions.find((c) => c.source === 'sale' && c.sourceId === commSale.id)
  ok('مرتجع كامل ⇒ العمولة ملغاة', commFinal.status === 'cancelled' && commFinal.amountMinor === 0, `الحالة ${commFinal.status}`)
  ok('الميزان متوازن بعد تسويات العمولة', balanced())

  /* رد ماكينة الدفع: القيد الذري، سقف المتبقي، منع المرجع المكرر، ومنع الرد المزدوج الخارجي */
  const terminal = { id: 't-depth', code: 'TERM-0009', nameAr: 'ماكينة العمق', providerName: 'visanet', branchId: '', settlementAccountCode: '1102', terminalId: 'T-DEPTH', status: 'active' }
  useDataStore.setState({ paymentTerminals: [...S().paymentTerminals, terminal] })
  S().addItem(item({ nameAr: 'ماكينة صنف', costMinor: 10000, stockQty: 100, priceMinor: 60000 }))
  const macItem = S().items.at(-1)
  const macLine = { itemId: macItem.id, nameAr: 'ماكينة صنف', qty: 1, unitPriceMinor: 60000, unitCostMinor: 10000, discountPercent: 0, soldByWeight: false }
  const macSale = S().postSale({ lines: [macLine], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1102', terminalPayment: { terminalId: 't-depth', providerReference: 'MAC-777' } })
  const macCharge = S().paymentTerminalTransactions.find((t) => t.documentType === 'sale' && t.documentId === String(macSale.id) && t.kind === 'charge')
  ok('تحصيل الماكينة حُفظ ذرياً مع الفاتورة (60)', macCharge != null && macCharge.amountMinor === 60000)
  const macRet = S().postSaleReturn({ saleId: macSale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'cash', reason: 'x', terminalRefund: { originalTransactionId: macCharge.id, providerReference: 'MAC-777-R' } })
  const macRefund = S().paymentTerminalTransactions.find((t) => t.kind === 'refund' && t.documentId === String(macRet.id))
  ok('رد الماكينة سُجل بالمرتجع بمالاً يزيد عن المتبقي', macRefund != null && macRefund.amountMinor === 60000 && macRefund.originalTransactionId === macCharge.id)

  /* انحدار عيب §79 (الرد المزدوج): رد خارجي 50 من تحصيل 60 عبر تطبيق المزود مسجلاً في سجل الماكينة،
     ثم مرتجع كامل من الدرج — قبل الإصلاح كان الدرج يرد 60 فيستلم العميل 110 من تحصيل 60 */
  const dblSale = S().postSale({ lines: [macLine], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1102', terminalPayment: { terminalId: 't-depth', providerReference: 'MAC-888' } })
  const dblCharge = S().paymentTerminalTransactions.find((t) => t.kind === 'charge' && t.documentId === String(dblSale.id))
  S().recordPaymentTerminalTransaction({ id: 'ext-ref-depth', idempotencyKey: 'ext-ref-depth', kind: 'refund', terminalId: 't-depth', branchId: '', userId: 0, documentType: 'manual', documentId: 'manual-depth', amountMinor: 50000, providerReference: 'EXT-DEPTH', occurredAt: new Date().toISOString(), originalTransactionId: dblCharge.id })
  throws('بعد رد ماكينة خارجي 50: الرد التلقائي الكامل من الدرج يُرفض (منع الرد المزدوج)', () => S().postSaleReturn({ saleId: dblSale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'cash', reason: 'x' }), 'سبق رده عبر الماكينة')
  const dblRet = S().postSaleReturn({ saleId: dblSale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'custom', allocation: { cashMinor: 10000, creditMinor: 0, storeCreditMinor: 0, waivedMinor: 50000 }, reason: 'بعد الإصلاح' })
  ok('التوزيع اليدوي: الدرج لا يرد إلا المتبقي 10 (50 سبق خروجها ماكينة)', dblRet.cashRefundMinor === 10000 && dblRet.waivedRefundMinor === 50000, `نقدي ${dblRet.cashRefundMinor}`)
  ok('إجمالي ما استلمه العميل = التحصيل بالضبط (50 ماكينة + 10 درج)', 50000 + dblRet.cashRefundMinor === 60000)

  /* رد ماكينة فوق المتبقي (بعد الرد الخارجي 50 لم يتبق إلا 10 على التحصيل) يُرفض */
  const dblSale2 = S().postSale({ lines: [macLine], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1102', terminalPayment: { terminalId: 't-depth', providerReference: 'MAC-999' } })
  const dblCharge2 = S().paymentTerminalTransactions.find((t) => t.kind === 'charge' && t.documentId === String(dblSale2.id))
  S().recordPaymentTerminalTransaction({ id: 'ext-ref-depth-2', idempotencyKey: 'ext-ref-depth-2', kind: 'refund', terminalId: 't-depth', branchId: '', userId: 0, documentType: 'manual', documentId: 'manual-depth-2', amountMinor: 50000, providerReference: 'EXT-DEPTH-2', occurredAt: new Date().toISOString(), originalTransactionId: dblCharge2.id })
  throws('رد نقدي 60 فوق المتاح 10 (بعد الرد الخارجي) يُرفض — حراسة المُحصَّل تسبق حراسة الماكينة', () => S().postSaleReturn({ saleId: dblSale2.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'custom', allocation: { cashMinor: 60000, creditMinor: 0, storeCreditMinor: 0, waivedMinor: 0 }, reason: 'x', terminalRefund: { originalTransactionId: dblCharge2.id, providerReference: 'MAC-999-R' } }), 'المُحصَّل')

  /* عميل مسجل: الرد الخارجي يخفض النقدي ويوجه الفائض ذمماً (لا رد نقدي مزدوج) */
  const namedSale = S().postSale({ lines: [macLine], customerId: cust.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1102', terminalPayment: { terminalId: 't-depth', providerReference: 'MAC-N1' } })
  const namedCharge = S().paymentTerminalTransactions.find((t) => t.kind === 'charge' && t.documentId === String(namedSale.id))
  S().recordPaymentTerminalTransaction({ id: 'ext-ref-named', idempotencyKey: 'ext-ref-named', kind: 'refund', terminalId: 't-depth', branchId: '', userId: 0, documentType: 'manual', documentId: 'manual-named', amountMinor: 50000, providerReference: 'EXT-NAMED', occurredAt: new Date().toISOString(), originalTransactionId: namedCharge.id })
  const namedRet = S().postSaleReturn({ saleId: namedSale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'cash', reason: 'x' })
  ok('عميل مسجل بعد رد خارجي 50: نقدي 10 فقط والباقي 50 ذمم', namedRet.cashRefundMinor === 10000 && namedRet.creditRefundMinor === 50000, `نقدي ${namedRet.cashRefundMinor} ذمم ${namedRet.creditRefundMinor}`)
  ok('الميزان متوازن ختامياً', balanced())
  console.log('  ✓ هجين + توزيع حر + تالف/سليم + وحدة كبرى + عمولة + ماكينة — كلها حية')
}

/* ─── ④ postWastage حياً: الإعدام FEFO والحدود ─── */
console.log('④ postWastage وpostConsumption حياً')
{
  const { useDataStore } = await import('../src/data/repo.ts')
  const S = () => useDataStore.getState()
  const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
  const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
  const item = (over) => ({ nameAr: 'ص', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over })

  S().addItem(item({ nameAr: 'إعدام FEFO', costMinor: 7000, stockQty: 18, trackExpiry: true }))
  const wf = S().items.at(-1)
  useDataStore.setState({
    batches: [
      { id: 9001, itemId: wf.id, expiryDate: relDays(-30), qty: 6, receivedAt: '2026-01-01' }, /* منتهية — تُعدم أولاً */
      { id: 9002, itemId: wf.id, expiryDate: relDays(45), qty: 6, receivedAt: '2026-01-02' },
      { id: 9003, itemId: wf.id, expiryDate: relDays(400), qty: 6, receivedAt: '2026-01-03' },
    ],
  })
  const inv0 = bal('1103')
  const dmg5111Before = bal('5111') /* رصيد 5111 تراكمي من مرتجعات §③ التالفة */
  const wst = S().postWastage({ reason: 'انتهاء صلاحية', lines: [{ itemId: wf.id, qty: 8 }], notes: 'إعدام دوري' })
  ok('الإعدام: المنتهية استُهلكت كاملة (6) والباقي (2) من الأقرب', S().batches.find((b) => b.id === 9001).qty === 0 && S().batches.find((b) => b.id === 9002).qty === 4)
  ok('المخزون 18−8=10', S().items.find((i) => i.id === wf.id).stockQty === 10)
  ok('قيمة القيد بالمتوسط (8×70=560) على 5111/1103', wst.totalCostMinor === 56000 && bal('5111') - dmg5111Before === 56000 && bal('1103') === inv0 - 56000)
  ok('قيد الإتلاف متوازن والمستند موثق بسبب', balanced() && wst.reason === 'انتهاء صلاحية' && wst.wastageNumber.startsWith('WST-'))

  /* الحدود: مكرر مرفوض وفوق الرصيد مرفوض ورصيد لا ينقلب سالباً */
  throws('صنف مكرر في سطور الإتلاف يُرفض', () => S().postWastage({ reason: 'x', lines: [{ itemId: wf.id, qty: 3 }, { itemId: wf.id, qty: 3 }], notes: '' }), 'مكرر')
  throws('إتلاف فوق الرصيد يُرفض', () => S().postWastage({ reason: 'x', lines: [{ itemId: wf.id, qty: 11 }], notes: '' }), 'تتجاوز رصيد')
  throws('سبب فارغ يُرفض', () => S().postWastage({ reason: '  ', lines: [{ itemId: wf.id, qty: 1 }], notes: '' }), 'سبب')
  ok('الرصيد بقي 10 (لا سالب)', S().items.find((i) => i.id === wf.id).stockQty === 10)

  /* الصرف الداخلي: نفس نمط الدفعات + حساب مصروفات إلزامي */
  S().addItem(item({ nameAr: 'صرف داخلي', costMinor: 4000, stockQty: 12, trackExpiry: true }))
  const cn = S().items.at(-1)
  useDataStore.setState({
    batches: [
      { id: 9101, itemId: cn.id, expiryDate: relDays(-5), qty: 4, receivedAt: '2026-01-01' },
      { id: 9102, itemId: cn.id, expiryDate: relDays(200), qty: 8, receivedAt: '2026-01-02' },
    ],
  })
  const consDoc = S().postConsumption({ purpose: 'ضيافة الورديات', lines: [{ itemId: cn.id, qty: 6 }], notes: '' })
  ok('الصرف استهلك المنتهية أولاً (4) ثم 2 من البعيدة', S().batches.find((b) => b.id === 9101).qty === 0 && S().batches.find((b) => b.id === 9102).qty === 6)
  ok('الصرف على 5114 افتراضياً بقيمة 6×40=240', consDoc.totalCostMinor === 24000 && consDoc.expenseAccount === '5114')
  throws('صرف على حساب غير مصروفات يُرفض', () => S().postConsumption({ purpose: 'x', expenseAccount: '1101', lines: [{ itemId: cn.id, qty: 1 }], notes: '' }), 'مصروفات')
  ok('الميزان متوازن ختامياً', balanced())
  console.log('  ✓ إعدام FEFO (منتهية أولاً) + حدود الصنف المكرر والرصيد + صرف داخلي')
}

console.log(`\n${fail === 0 ? '✅' : '❌'} جولة المالك — عمق المرتجعات والإتلاف: ${pass} ناجح — ${fail} فاشل`)
process.exit(fail === 0 ? 0 : 1)
