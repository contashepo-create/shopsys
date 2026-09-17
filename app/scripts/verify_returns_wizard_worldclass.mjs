/**
 * تحقق ترقية المرتجعات للنمط العالمي (طلب المالك — «مراحل تغطي جميع الاحتمالات»):
 * ─────────────────────────────────────────────────────────────────────────────
 * 1) الإرجاع سطراً بسطر: بند واحد من فاتورة متعددة البنود، جزء من كمية سطر،
 *    وسطران لنفس الصنف بسعرين مختلفين يُرجعان مستقلَّين
 * 2) حالة البضاعة: التالف يذهب هالكاً 5111 ولا يدخل المخزون؛ السليم يعود
 * 3) طرق الرد: نقدي (بخزينة مختارة/بنك)، خصم من الحساب، رصيد للعميل — والهجين
 * 4) الاستبدال: نقدي وآجل (الفاتورة الآجلة تحرك الذمم لا النقدية)
 * 5) الأنشطة: معمل (رد فحص واحد)، مغسلة (رد قطعة)، صيانة (رد قطعة غيار للمخزون)
 * 6) ميزان القيود متوازن في كل حالة + الأسباب الموحدة
 */
import assert from 'node:assert/strict'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
}
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryId: 'EG', activityId: 'grocery', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true, allowNegativeStock: false } }, version: 0 }))

const { buildReturnLinesPerLine, remainingByLine, buildReturnEntry, damagedCostOf, RETURN_REASONS, returnReasonName } = await import('../src/core/returns.ts')
const { computeItemizedRefund } = await import('../src/core/serviceRefund.ts')
const { computeTotals } = await import('../src/core/pos.ts')
const { useDataStore } = await import('../src/data/repo.ts')

let n = 0
const ok = (name) => console.log(`  ✓ ${++n}. ${name}`)
const S = () => useDataStore.getState()
const balancedEntry = (e) => {
  const d = e.lines.reduce((a, l) => a + l.debit, 0)
  const c = e.lines.reduce((a, l) => a + l.credit, 0)
  return d === c && d > 0
}

const mkItem = (nameAr, cost, price, stock) => {
  S().addItem({
    nameAr, sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
    costMinor: cost, stockQty: stock, priceMinor: price, minQty: 0, trackExpiry: false, trackSerial: false,
    warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
  })
  return S().items.at(-1)
}
const line = (it, qty, price, cost, disc = 0) =>
  ({ itemId: it.id, nameAr: it.nameAr, qty, unitPriceMinor: price, unitCostMinor: cost, discountPercent: disc, soldByWeight: false })

console.log('1️⃣ النواة: الإرجاع سطراً بسطر (remainingByLine / buildReturnLinesPerLine)')
{
  // فاتورة بسطرين لنفس الصنف بسعرين مختلفين + صنف آخر
  const saleLines = [
    { itemId: 1, nameAr: 'أ', qty: 3, unitPriceMinor: 1000, unitCostMinor: 600, discountPercent: 0, soldByWeight: false },
    { itemId: 1, nameAr: 'أ', qty: 2, unitPriceMinor: 800, unitCostMinor: 600, discountPercent: 10, soldByWeight: false },
    { itemId: 2, nameAr: 'ب', qty: 1, unitPriceMinor: 5000, unitCostMinor: 3000, discountPercent: 0, soldByWeight: false },
  ]
  const rem0 = remainingByLine(saleLines, [])
  assert.deepEqual(rem0, [3, 2, 1])
  ok('المتبقي الأولي لكل سطر مستقل')

  // إرجاع سطر واحد فقط (البند الثاني بسعره المخفض) — النمط العالمي
  const specs1 = [{ lineIndex: 1, qty: 1, condition: 'resellable' }]
  const lines1 = buildReturnLinesPerLine(saleLines, [], specs1)
  assert.equal(lines1.length, 1)
  assert.equal(lines1[0].unitPriceMinor, 800)
  assert.equal(lines1[0].discountPercent, 10)
  assert.equal(lines1[0].saleLineIndex, 1)
  ok('إرجاع بند واحد بسعره وخصمه الأصليين تحديداً (لا خلط بين سطري نفس الصنف)')

  // المتبقي بعد المرتجع الأول يخصم من السطر الصحيح فقط
  const rem1 = remainingByLine(saleLines, lines1)
  assert.deepEqual(rem1, [3, 1, 1])
  ok('المتبقي خُصم من السطر المستهدف فقط')

  // تجاوز متبقي سطر يُرفض حتى لو الصنف نفسه متاح في سطر آخر
  assert.throws(() => buildReturnLinesPerLine(saleLines, lines1, [{ lineIndex: 1, qty: 2, condition: 'resellable' }]), /المتبقي/)
  ok('تجاوز متبقي السطر يُرفض (رغم توفر الصنف في سطر آخر)')

  // سجل قديم بلا saleLineIndex يُستهلك من سطور الصنف بالترتيب (توافق خلفي)
  const legacy = [{ itemId: 1, nameAr: 'أ', qty: 4, unitPriceMinor: 1000, unitCostMinor: 600, discountPercent: 0, soldByWeight: false }]
  const remLegacy = remainingByLine(saleLines, legacy)
  assert.deepEqual(remLegacy, [0, 1, 1])
  ok('التوافق الخلفي: مرتجع قديم بلا فهرس يُستهلك بالترتيب')
}

console.log('2️⃣ النواة: حالة البضاعة في القيد (تالف → 5111)')
{
  const lines = [
    { itemId: 1, nameAr: 'أ', qty: 1, unitPriceMinor: 1000, unitCostMinor: 600, discountPercent: 0, soldByWeight: false, condition: 'resellable' },
    { itemId: 2, nameAr: 'ب', qty: 2, unitPriceMinor: 500, unitCostMinor: 300, discountPercent: 0, soldByWeight: false, condition: 'damaged' },
  ]
  assert.equal(damagedCostOf(lines), 600)
  ok('damagedCostOf يجمع تكلفة التالف فقط (2×300)')
  const totals = computeTotals(lines, 0, 0, true)
  const entry = buildReturnEntry(totals, 'cash', '1101', undefined, 600)
  const acc = (code) => entry.filter((l) => l.accountCode === code)
  assert.equal(acc('1103')[0]?.debit, totals.cogsMinor - 600)
  assert.equal(acc('5111')[0]?.debit, 600)
  assert.equal(acc('5101')[0]?.credit, totals.cogsMinor)
  const d = entry.reduce((a, l) => a + l.debit, 0), c = entry.reduce((a, l) => a + l.credit, 0)
  assert.equal(d, c)
  ok('القيد: مخزون بالسليم فقط + هالك 5111 بالتالف + 5101 دائن بالكامل — متوازن')
  assert.throws(() => buildReturnEntry(totals, 'cash', '1101', undefined, totals.cogsMinor + 1), /تتجاوز/)
  ok('تكلفة تالف أكبر من تكلفة المرتجع تُرفض')
}

console.log('3️⃣ التكامل: postSaleReturn بمواصفات السطور + التالف لا يدخل المخزون')
{
  useDataStore.setState({ appUsers: [], currentUserId: null })
  const itA = mkItem('صنف سليم/تالف', 600, 1000, 10)
  const itB = mkItem('صنف آخر', 300, 500, 10)
  const sale = S().postSale({
    lines: [line(itA, 3, 1000, 600), line(itB, 2, 500, 300)],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, paidMinor: 4000,
  })
  const stockA0 = S().items.find((i) => i.id === itA.id).stockQty
  const stockB0 = S().items.find((i) => i.id === itB.id).stockQty
  const t0 = S().journal.filter((e) => e.lines.some((l) => l.accountCode === '5111')).length

  // إرجاع بند واحد فقط (itA) قطعة سليمة + قطعة تالفة عبر مواصفتين؟ لا — سطر واحد بحالة واحدة:
  // نرجع 1 تالفة من سطر itA فقط
  const ret = S().postSaleReturn({
    saleId: sale.id,
    lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'damaged' }],
    refund: 'cash', reason: '', reasonCode: 'defective',
  })
  assert.equal(ret.lines.length, 1)
  assert.equal(ret.lines[0].condition, 'damaged')
  assert.equal(ret.reasonCode, 'defective')
  ok('مرتجع بند واحد من فاتورة ببندين — بمواصفة سطر وحالة وسبب موحد')

  const stockA1 = S().items.find((i) => i.id === itA.id).stockQty
  const stockB1 = S().items.find((i) => i.id === itB.id).stockQty
  assert.equal(stockA1, stockA0) // تالف — لا يدخل المخزون
  assert.equal(stockB1, stockB0) // لم يُرجع أصلاً
  ok('التالف لم يدخل المخزون والبند الآخر لم يُمس')

  const entry = S().journal.find((e) => e.id === ret.journalEntryId)
  assert.ok(balancedEntry(entry))
  assert.ok(entry.lines.some((l) => l.accountCode === '5111' && l.debit === 600))
  assert.ok(!entry.lines.some((l) => l.accountCode === '1103'))
  ok('قيد المرتجع: هالك 5111 مدين 600 وبلا سطر مخزون — متوازن')
  assert.equal(S().journal.filter((e) => e.lines.some((l) => l.accountCode === '5111')).length, t0 + 1)

  // ثم إرجاع سليم من نفس الفاتورة يعود للمخزون طبيعياً
  const ret2 = S().postSaleReturn({
    saleId: sale.id,
    lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }],
    refund: 'cash', reason: '', reasonCode: 'changed_mind',
  })
  assert.equal(S().items.find((i) => i.id === itA.id).stockQty, stockA0 + 1)
  const entry2 = S().journal.find((e) => e.id === ret2.journalEntryId)
  assert.ok(entry2.lines.some((l) => l.accountCode === '1103' && l.debit === 600))
  ok('السليم من نفس الفاتورة يعود للمخزون بقيد 1103')

  // خزينة رد مختارة (بنك = تحويل)
  S().addTreasury('بنك الرد', 'bank')
  const bank = S().treasuries.at(-1)
  const ret3 = S().postSaleReturn({
    saleId: sale.id,
    lineSpecs: [{ lineIndex: 1, qty: 1, condition: 'resellable' }],
    refund: 'cash', reason: '', treasury: bank.code,
  })
  assert.equal(ret3.treasury, bank.code)
  const entry3 = S().journal.find((e) => e.id === ret3.journalEntryId)
  assert.ok(entry3.lines.some((l) => l.accountCode === bank.code && l.credit === 500))
  ok('طريقة الرد «تحويل بنكي»: النقدية خرجت من البنك المختار لا خزينة البيع')
}

console.log('4️⃣ الاستبدال: نقدي وآجل')
{
  const itX = mkItem('استبدال-قديم', 500, 1000, 10)
  const itY = mkItem('استبدال-جديد', 700, 1500, 10)
  // نقدي
  const sCash = S().postSale({
    lines: [line(itX, 1, 1000, 500)], customerId: null, payment: 'cash',
    invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, paidMinor: 1000,
  })
  const exc = S().postExchange({
    originalSaleId: sCash.id, returnQtyByItem: new Map([[itX.id, 1]]),
    newLines: [line(itY, 1, 1500, 700)], notes: '',
  })
  assert.equal(exc.netMinor, 500)
  const retDoc = S().saleReturns.find((r) => r.id === exc.returnId)
  assert.equal(retDoc.refund, 'cash')
  ok('استبدال فاتورة نقدية: مرتجع نقدي وفرق 500 يدفعه العميل')

  // آجل: عميل مسجل بفاتورة آجلة — الاستبدال يحرك الذمم لا النقدية
  S().addCustomer({ nameAr: 'عميل استبدال آجل', phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '', creditLimitMinor: 0 })
  const cust = S().customers.at(-1)
  const sCredit = S().postSale({
    lines: [line(itX, 2, 1000, 500)], customerId: cust.id, payment: 'credit',
    invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, paidMinor: 0,
  })
  const cash0 = S().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === '1101').reduce((a, l) => a + l.debit - l.credit, 0)
  const exc2 = S().postExchange({
    originalSaleId: sCredit.id, returnQtyByItem: new Map([[itX.id, 1]]),
    newLines: [line(itY, 1, 1500, 700)], notes: '',
  })
  const retDoc2 = S().saleReturns.find((r) => r.id === exc2.returnId)
  assert.equal(retDoc2.refund, 'credit')
  assert.equal(retDoc2.cashRefundMinor, 0)
  const newSale2 = S().sales.find((s) => s.id === exc2.newSaleId)
  assert.equal(newSale2.payment, 'credit')
  const cash1 = S().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === '1101').reduce((a, l) => a + l.debit - l.credit, 0)
  assert.equal(cash1, cash0)
  ok('استبدال فاتورة آجلة: المرتجع يخفض الذمم والجديد يضيف لها — الدرج لم يتحرك إطلاقاً')
}

console.log('5️⃣ الأنشطة: بنود قابلة للرد لكل نشاط')
{
  // computeItemizedRefund: النسبة والسقف
  const items = [
    { key: 'test:0', label: 'سكر صائم', valueMinor: 10000 },
    { key: 'test:1', label: 'صورة دم', valueMinor: 20000 },
  ]
  const r1 = computeItemizedRefund({ items, selectedKeys: ['test:0'], grandMinor: 28500, refundedMinor: 0 })
  assert.equal(r1.amountMinor, 9500) // 28500×10000/30000 — يرث الخصم نسبياً
  ok('معمل: رد فحص واحد يرث خصم الأمر نسبياً (9500 من 28500)')
  const r2 = computeItemizedRefund({ items, selectedKeys: ['test:0', 'test:1'], grandMinor: 28500, refundedMinor: 9500 })
  assert.equal(r2.amountMinor, 19000) // السقف: المتبقي فقط
  ok('سقف المتبقي يمنع تجاوز الوعاء')
  assert.throws(() => computeItemizedRefund({ items, selectedKeys: [], grandMinor: 28500, refundedMinor: 0 }), /اختر/)
  ok('بلا اختيار بنود يُرفض')
  const r3 = computeItemizedRefund({
    items: [{ key: 'part:0', label: 'قطعة', valueMinor: 5000, restockCostMinor: 3000 }, { key: 'labor', label: 'أجر', valueMinor: 5000 }],
    selectedKeys: ['part:0'], grandMinor: 10000, refundedMinor: 0,
  })
  assert.equal(r3.restockCostMinor, 3000)
  ok('اختيار قطعة مخزنية يحمل تكلفتها للإرجاع')
}

console.log('6️⃣ الصيانة: مرتجع خدمة مع إرجاع قطعة غيار للمخزون')
{
  const part = mkItem('قطعة غيار مرتجعة', 3000, 5000, 5)
  S().openTicket({ customerId: null, customerName: 'عميل صيانة', customerPhone: '', deviceName: 'جهاز', issue: 'عطل', estimateMinor: 0, notes: '' })
  const t = S().tickets.at(-1)
  S().setTicketStatus(t.id, 'in_progress')
  S().setTicketStatus(t.id, 'ready')
  S().deliverTicket(t.id, {
    laborMinor: 10000,
    parts: [{ itemId: part.id, qty: 1, unitPriceMinor: 5000 }],
    payment: 'cash', vatPercent: 0,
  })
  const delivered = S().tickets.find((x) => x.id === t.id)
  assert.equal(delivered.totals.grandMinor, 15000)
  const stock0 = S().items.find((i) => i.id === part.id).stockQty // بعد الصرف

  const upd = S().refundMaintenanceTicket({
    ticketId: t.id, amountMinor: 5000, mode: 'cash', reason: 'قطعة أُعيدت',
    returnParts: [{ itemId: part.id, qty: 1 }],
  })
  assert.equal(S().items.find((i) => i.id === part.id).stockQty, stock0 + 1)
  ok('القطعة عادت للمخزون فعلياً')
  const entry = S().journal.find((e) => e.id === upd.refunds.at(-1).journalEntryId)
  assert.ok(balancedEntry(entry))
  assert.ok(entry.lines.some((l) => l.accountCode === '1103' && l.debit === 3000))
  assert.ok(entry.lines.some((l) => l.accountCode === '5101' && l.credit === 3000))
  assert.ok(entry.lines.some((l) => l.accountCode === '4102' && l.debit === 5000))
  ok('القيد: 4102 مدين 5000 + مخزون/تكلفة 3000 متوازن')
  assert.deepEqual(upd.returnedParts.map((p) => ({ itemId: p.itemId, qty: p.qty })), [{ itemId: part.id, qty: 1 }])
  ok('التذكرة توثق القطع المرتجعة (منع الإرجاع المزدوج)')
  assert.throws(() => S().refundMaintenanceTicket({ ticketId: t.id, amountMinor: 1000, mode: 'cash', reason: 'x', returnParts: [{ itemId: part.id, qty: 1 }] }), /المتبقي|المصروف/)
  ok('إرجاع نفس القطعة مرتين يُرفض')
}

console.log('7️⃣ الأسباب الموحدة والتقارير')
{
  assert.ok(RETURN_REASONS.length >= 6)
  assert.equal(RETURN_REASONS.find((r) => r.id === 'defective').defaultCondition, 'damaged')
  assert.equal(RETURN_REASONS.find((r) => r.id === 'changed_mind').defaultCondition, 'resellable')
  assert.equal(returnReasonName('expired'), 'منتهي الصلاحية')
  ok('قائمة أسباب موحدة بحالة افتراضية لكل سبب (تالف/سليم)')
}

console.log('8️⃣ واجهات: المعالج والصناديق موصولة')
{
  const fs = await import('node:fs')
  const ui = (p) => fs.readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8')
  const wiz = ui('pages/SaleReturnsPage.tsx')
  for (const marker of ['STEPS', 'lineSpecs: specs', "condition: 'damaged'", 'allocationOf', 'TreasuryPicker', "navigate('/sales/exchange')", 'RETURN_REASONS']) {
    assert.ok(wiz.includes(marker), `SaleReturnsPage يفتقد ${marker}`)
  }
  ok('معالج المرتجع: مراحل + سطر بسطر + حالة + خزينة رد + مسار استبدال + أسباب')
  const box = ui('components/ServiceRefundBox.tsx')
  assert.ok(box.includes('refundableItems') && box.includes('computeItemizedRefund'))
  ok('صندوق الخدمة الموحد: وضع البنود مفعل')
  assert.ok(ui('pages/LabPages.tsx').includes('refundableItems={viewing.tests'))
  assert.ok(ui('pages/LaundryPage.tsx').includes('refundableItems={viewing.lines'))
  assert.ok(ui('pages/MaintenancePage.tsx').includes('returnParts'))
  ok('المعمل بالفحوصات، المغسلة بالقطع، الصيانة بالقطع المستردة للمخزون')
}

console.log(`\n✅ ${n}/${n} — المرتجع بالنمط العالمي: مراحل، سطر بسطر، سليم/تالف، نقدي/تحويل/حساب/رصيد/استبدال، وكل قيد متوازن`)
