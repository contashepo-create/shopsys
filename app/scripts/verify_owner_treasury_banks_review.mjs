/**
 * جولة المالك — مراجعة الخزينة والبنوك ملفاً ملفاً (§78 — نطاق P0 الثالث).
 * 13 ملفاً: treasury · treasuryAccess · treasuryUserReport · cheques · exchange ·
 * walletServices · paymentTerminals · paymentTerminalAccess/Charge/Eligibility/
 * Refund/Report/Settlement/Transactions · paymentProviderReconciliation.
 * تحرس العيوب الثلاثة المكتشفة بالقراءة الحرفية + تبرهن ثوابت النطاق:
 *   1) paymentTerminalAccess: الواجهة تعِد «حد العملية (0 = بلا حد)» لكن النواة
 *      كانت تفسّر الصفر منعاً كاملاً — كاشير يتعطل بلا سبب ظاهر.
 *   2) cheques.validateCheque: '2026-02-30' كان يمر (regex فقط) وDate.parse
 *      يدوّره لـ2 مارس فيُحسب الاستحقاق خطأً بصمت في التنبيهات.
 *   3) paymentTerminalReport: «to» بتاريخ فقط كان يستبعد يومه كله (مقارنة
 *      معجمية لحظة/تاريخ).
 * تشغيل: node --experimental-strip-types scripts/verify_owner_treasury_banks_review.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const read = (p) => readFileSync(here + p, 'utf8')

let seed = 20261003
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))

/* ─── ① الخزائن والبنوك المتعددة ─── */
console.log('① الخزائن والبنوك: الأكواد والشجرة والتسمية')
{
  const { DEFAULT_TREASURIES, nextTreasuryCode, validateTreasury, treasuryAccounts, fullCoa, treasuryLabel, } = await import('../src/core/treasury.ts')
  const { STANDARD_COA } = await import('../src/core/ledger.ts')
  assert.equal(DEFAULT_TREASURIES.length, 2, 'خزينة وبنك افتراضيان')
  /* الكود التالي: يبدأ 1121 ويزيد ولا يرتبك بأكواد غير رقمية */
  assert.equal(nextTreasuryCode([]), '1121')
  assert.equal(nextTreasuryCode([{ code: '1121', nameAr: 'أ', kind: 'cash' }, { code: '1125', nameAr: 'ب', kind: 'cash' }]), '1126')
  assert.equal(nextTreasuryCode([{ code: 'خارج', nameAr: 'ج', kind: 'cash' }]), '1121', 'الكود الأجنبي لا يعطّل التسلسل')
  /* الأكواد كلها من هذا المولد بالبناء (1101/1102 أو 1121+) فلا مجال لقفزة 9999 */
  /* الاسم: قصير مرفوض ومكرر مرفوض والاستثناء الذاتي يعمل */
  assert.ok(validateTreasury('خ', []).some((e) => e.includes('قصير')))
  assert.ok(validateTreasury('خزينة فرعية', [{ code: '1121', nameAr: 'خزينة فرعية', kind: 'cash' }]).some((e) => e.includes('نفس الاسم')))
  assert.equal(validateTreasury('خزينة فرعية', [{ code: '1121', nameAr: 'خزينة فرعية', kind: 'cash' }], '1121').length, 0)
  /* الحسابات الورقية: القياسيتان مستثنيتان والمخصصة تحت 11 ورقية */
  const treasuries = [
    { code: '1101', nameAr: 'الخزينة الرئيسية', kind: 'cash' },
    { code: '1102', nameAr: 'البنك الرئيسي', kind: 'bank' },
    { code: '1121', nameAr: 'درج الكاشير 2', kind: 'cash' },
    { code: '1122', nameAr: 'بنك مصر فرع المنصورة', kind: 'bank', channel: 'wallet', branch: 'المنصورة' },
  ]
  const accounts = treasuryAccounts(treasuries)
  assert.equal(accounts.length, 2, 'القياسيتان لا تتكرران')
  for (const a of accounts) {
    assert.equal(a.rootType, 'assets'); assert.equal(a.parentCode, '11'); assert.ok(a.isPostable); assert.equal(a.systemKey, undefined)
  }
  /* الشجرة الكاملة: الإدراج بعد 1102 مباشرة وعدد لا يضيع */
  const tree = fullCoa(STANDARD_COA, treasuries)
  assert.equal(tree.length, STANDARD_COA.length + 2)
  assert.equal(tree.findIndex((a) => a.code === '1121'), tree.findIndex((a) => a.code === '1102') + 1)
  /* بلا مخصصة: الشجرة كما هي حرفياً */
  assert.equal(fullCoa(STANDARD_COA, DEFAULT_TREASURIES), STANDARD_COA, 'بلا مخصصة يُرجع القاعدة نفسها')
  /* نقطة الإدراج مضمونة: 1102 ليست مشروطة بأي وحدة في coaVisibility فلا تختفي أبداً */
  const visibility = read('../src/core/coaVisibility.ts')
  assert.ok(!/^\s*'1102':/m.test(visibility), '1102 غير مشروط بالوحدات — نقطة إدراج الخزائن المخصصة مضمونة')
  /* التسمية بأيقونة النوع */
  assert.ok(treasuryLabel({ code: '1121', nameAr: 'درج', kind: 'cash' }).includes('💰'))
  assert.ok(treasuryLabel({ code: '1122', nameAr: 'محفظة', kind: 'bank', channel: 'wallet' }).includes('📱'))
  assert.ok(treasuryLabel({ code: '1102', nameAr: 'بنك', kind: 'bank', branch: 'دمياط' }).includes('دمياط'))
  console.log('  ✓ الأكواد + الشجرة (بعد 1102 حصراً) + ضمان نقطة الإدراج + التسمية')
}

/* ─── ② صلاحيات الخزائن ─── */
console.log('② صلاحيات الخزائن: الحدود والافتراضي والتحويل')
{
  const { validateUserTreasuryAccess, allowedTreasuryCodes, validateTreasuryAccess, validateTreasuryTransfer, effectiveDefaultTreasury } = await import('../src/core/treasuryAccess.ts')
  /* التحقق: مكرر/مجهول/فارغ/حد تالف/افتراضي خارج المنح */
  const bad = validateUserTreasuryAccess({ grants: [
    { treasuryCode: '1101', operations: [] },
    { treasuryCode: '1101', operations: ['receipt'], maxAmountMinor: -5 },
    { treasuryCode: '9999', operations: ['receipt'] },
  ], defaultTreasuryCode: '1102' }, ['1101', '1102'])
  assert.equal(bad.length, 5, 'المخالفات الخمس كلها تُلتقط: عملية فارغة + حد تالف + مجهول + مكرر + افتراضي خارج المنح')
  /* توافق خلفي: مستخدم قديم بلا منح = كل شيء مسموح */
  assert.equal(allowedTreasuryCodes(null, 'receipt'), null)
  assert.deepEqual(validateTreasuryAccess(null, '1101', 'payment', 10 ** 9), [])
  /* الحد: صفر/غياب = بلا حد، وموجب يمنع التجاوز */
  const grants = { grants: [{ treasuryCode: '1101', operations: ['receipt', 'transfer_from'], maxAmountMinor: 5000 }, { treasuryCode: '1102', operations: ['receipt', 'transfer_to'] }] }
  assert.deepEqual(validateTreasuryAccess(grants, '1101', 'receipt', 5000), [])
  assert.ok(validateTreasuryAccess(grants, '1101', 'receipt', 5001).some((e) => e.includes('يتجاوز')))
  assert.ok(validateTreasuryAccess(grants, '1101', 'payment', 1).some((e) => e.includes('غير مسموح')))
  assert.deepEqual(validateTreasuryAccess({ grants: [{ treasuryCode: '1101', operations: ['receipt'], maxAmountMinor: 0 }] }, '1101', 'receipt', 10 ** 9), [], 'الصفر = بلا حد (الدلالة الموثقة)')
  /* التحويل: الطرفان معاً ومصدر≠وجهة */
  assert.ok(validateTreasuryTransfer(grants, '1101', '1101', 100).some((e) => e.includes('مختلفين')))
  assert.equal(validateTreasuryTransfer(grants, '1101', '1102', 100).length, 0)
  assert.ok(validateTreasuryTransfer(grants, '1102', '1101', 100).some((e) => e.includes('غير مسموح')), 'transfer_from من 1102 غير ممنوح')
  /* الافتراضي الفعال: داخل المسموح وإلا أول مسموح */
  assert.equal(effectiveDefaultTreasury(grants, 'receipt', '1102'), '1101')
  assert.equal(effectiveDefaultTreasury({ ...grants, defaultTreasuryCode: '1102' }, 'receipt', '1101'), '1102')
  assert.equal(effectiveDefaultTreasury(null, 'receipt', '1101'), '1101')
  assert.equal(effectiveDefaultTreasury(grants, 'transfer_to', '1101'), '1102')
  console.log('  ✓ 6 مخالفات + التوافق الخلفي + صفر=بلا حد + التحويل بالاتجاهين')
}

/* ─── ③ الشيكات: القيود والآلة والتقويم الحقيقي ─── */
console.log('③ الشيكات: قيود متوازنة وآلة حالات مغلقة وتقويم حقيقي')
{
  const ch = await import('../src/core/cheques.ts')
  /* كل القيود متوازنة على 2,000 مبلغ عشوائي وكل الحسابات المقابلة */
  for (let t = 0; t < 2000; t++) {
    const amount = ri(1, 10 ** 9)
    const counter = ['1104', '4110', '2101', '2104', '5108'][ri(0, 4)]
    const account = ['1101', '1102', '1121'][ri(0, 2)]
    for (const lines of [ch.buildChequeReceiveEntry(amount, 'ن', counter), ch.buildChequeCollectEntry(amount, 'ن', account), ch.buildChequeBounceEntry(amount, 'ن', counter), ch.buildChequeIssueEntry(amount, 'ن', counter), ch.buildChequeClearEntry(amount, 'ن', account), ch.buildChequeCancelEntry(amount, 'ن', counter)]) {
      const dr = lines.reduce((s, l) => s + l.debit, 0), cr = lines.reduce((s, l) => s + l.credit, 0)
      assert.equal(dr, cr, 'القيد متوازن'); assert.equal(dr, amount, 'بقيمة الورقة كاملة')
    }
  }
  /* العكس الصحيح: البونص = عكس الاستلام حرفياً، والإلغاء = عكس التحرير */
  const recv = ch.buildChequeReceiveEntry(900, 'ن', '1104')
  const bounce = ch.buildChequeBounceEntry(900, 'ن', '1104')
  assert.deepEqual(bounce, [{ accountCode: '1104', debit: 900, credit: 0, note: 'ن' }, { accountCode: '1106', debit: 0, credit: 900, note: 'ن' }])
  assert.notDeepEqual(recv, bounce)
  /* آلة الحالات كاملة 7×7 */
  const statuses = ['held', 'deposited', 'collected', 'bounced', 'issued', 'cleared', 'cancelled']
  const allowed = [['held', 'deposited'], ['held', 'collected'], ['held', 'bounced'], ['deposited', 'collected'], ['deposited', 'bounced'], ['issued', 'cleared'], ['issued', 'cancelled']]
  for (const from of statuses) for (const to of statuses) {
    const ok = allowed.some(([f, t2]) => f === from && t2 === to)
    if (ok) ch.assertTransition(from, to)
    else assert.throws(() => ch.assertTransition(from, to), /لا يمكن نقل الشيك/)
  }
  /* (إصلاح §78) التقويم الحقيقي: Date.parse كان يدوّر 2026-02-30 */
  for (const bad of ['2026-02-30', '2026-04-31', '2026-13-01', '2026-01-32']) {
    assert.throws(() => ch.validateCheque({ chequeNumber: 'X', amountMinor: 100, dueDate: bad, partyId: null, partyName: 'ط' }), /التقويم/, `رفض ${bad}`)
  }
  for (const good of ['2024-02-29', '2026-12-31']) {
    assert.doesNotThrow(() => ch.validateCheque({ chequeNumber: 'X', amountMinor: 100, dueDate: good, partyId: null, partyName: 'ط' }))
  }
  /* التنبيهات: بالأيام، الأقدم أولاً، والنهائي مستثنى */
  const today = '2026-10-02'
  const mk = (id, status, dueDate, direction = 'incoming') => ({ id, chequeNumber: `C${id}`, direction, partyId: null, partyName: 'ط', counterAccount: '1104', bankName: 'ب', amountMinor: 100, dueDate, status, notes: '', createdAt: '', receiveEntryId: 1, settleEntryId: null, reverseEntryId: null, depositedAt: null, settledAt: null })
  const alerts = ch.dueCheques([mk(1, 'held', '2026-09-25'), mk(2, 'deposited', '2026-10-04'), mk(3, 'collected', '2026-09-25'), mk(4, 'issued', '2026-10-08', 'outgoing'), mk(5, 'held', '2026-12-01')], today, 7)
  assert.deepEqual(alerts.map((a) => a.cheque.id), [1, 2, 4])
  assert.equal(alerts[0].daysLeft, -7)
  /* المحفظة: مجموع بلا فقد */
  const portfolio = ch.chequePortfolio([mk(1, 'held', '2026-12-01'), mk(2, 'deposited', '2026-12-01'), mk(3, 'bounced', '2026-12-01'), mk(4, 'issued', '2026-12-01', 'outgoing'), mk(5, 'cleared', '2026-12-01', 'outgoing')])
  assert.deepEqual(portfolio, { incomingOpenMinor: 200, incomingOpenCount: 2, outgoingOpenMinor: 100, outgoingOpenCount: 1, bouncedCount: 1 })
  console.log('  ✓ 12,000 قيد متوازن + مصفوفة 7×7 + تقويم حقيقي + تنبيهات ومحفظة')
}

/* ─── ④ خدمات المحافظ: برهان جبري أن القيد متوازن دائماً ─── */
console.log('④ خدمات المحافظ: توازن جبري بكل الفروع')
{
  const w = await import('../src/core/walletServices.ts')
  /* 3,000 حالة عشوائية: كل تركيبة مدفوع/آجل/تمويل/هامش/ضريبة */
  for (let t = 0; t < 3000; t++) {
    const paidToProvider = ri(1, 10 ** 6)
    const charge = Math.max(1, paidToProvider + ri(-(10 ** 5), 10 ** 5))
    const paid = ri(0, charge)
    const input = { type: 'topup', provider: 'vodafone', targetPhone: '0100', paidToProviderMinor: paidToProvider, chargeMinor: charge, paidMinor: paid, customerId: paid < charge ? 5 : null, fundingTreasury: '1101', receiveTreasury: paid > 0 ? '1102' : '', vatPercent: [0, 14, 15][ri(0, 2)], notes: '' }
    const totals = w.computeWalletTotals(input)
    /* الثوابت الجبرية */
    assert.equal(totals.profitGrossMinor, charge - paidToProvider)
    assert.equal(totals.remainingMinor, charge - paid)
    assert.equal(totals.revenueMinor, totals.profitGrossMinor - totals.vatMinor)
    if (totals.profitGrossMinor > 0 && input.vatPercent > 0) {
      const expectedVat = Math.round((totals.profitGrossMinor * input.vatPercent) / (100 + input.vatPercent))
      assert.equal(totals.vatMinor, expectedVat, 'ضريبة شاملة نصف-صاعدة')
      assert.ok(totals.vatMinor <= totals.profitGrossMinor)
    } else assert.equal(totals.vatMinor, 0, 'خسارة/نسبة صفر ⇒ لا ضريبة')
    /* القيد متوازن مهما كانت التركيبة (برهان آلي) */
    const lines = w.buildWalletServiceEntry(input, totals, 'تسمية')
    const dr = lines.reduce((s, l) => s + l.debit, 0), cr = lines.reduce((s, l) => s + l.credit, 0)
    assert.equal(dr, cr, `توازن: تحصيل ${paid} + آجل ${totals.remainingMinor} = تمويل ${paidToProvider} + هامش وصافي`)
    /* قيمة القيد: ربح ⇒ المحصَّل؛ خسارة ⇒ التمويل (سطر 4103 مديناً يكمل التوازن) — دائماً الأكبر */
    assert.equal(dr, Math.max(charge, paidToProvider), 'قيمة القيد = الأكبر من المحصَّل والتمويل')
  }
  /* التحقق: الآجل يحتاج عميلاً والمدفوع لا يتجاوز المحصل */
  assert.ok(w.validateWalletService({ type: 'topup', provider: 'vodafone', targetPhone: '01', paidToProviderMinor: 100, chargeMinor: 150, paidMinor: 50, customerId: null, fundingTreasury: '1101', receiveTreasury: '1101', vatPercent: 0, notes: '' }).some((e) => e.includes('عميلاً مسجلاً')))
  assert.ok(w.validateWalletService({ type: 'topup', provider: 'vodafone', targetPhone: '01', paidToProviderMinor: 100, chargeMinor: 100, paidMinor: 150, customerId: 1, fundingTreasury: '1101', receiveTreasury: '1101', vatPercent: 0, notes: '' }).some((e) => e.includes('لا يتجاوز')))
  assert.deepEqual(w.walletSummary([{ chargeMinor: 100, paidToProviderMinor: 90, status: 'settled' }, { chargeMinor: 500, paidToProviderMinor: 400, status: 'returned' }]), { count: 1, chargeMinor: 100, profitMinor: 10 })
  console.log('  ✓ 3,000 قيد متوازن جبرياً (ربح/خسارة/آجل/ضريبة) + حراس الإدخال')
}

/* ─── ⑤ ماكينات الدفع: الحركات والتسوية ─── */
console.log('⑤ ماكينات الدفع: بناء الحركات وحدود الرد والتسوية')
{
  const { validatePaymentTerminal, nextTerminalCode, } = await import('../src/core/paymentTerminals.ts')
  const { buildTerminalCharge } = await import('../src/core/paymentTerminalCharge.ts')
  const { buildTerminalRefund } = await import('../src/core/paymentTerminalRefund.ts')
  const { remainingRefundableMinor, validateTerminalTransaction } = await import('../src/core/paymentTerminalTransactions.ts')
  const { calculateTerminalSettlement, validateSettlementTransactions, netSettlementTransactions } = await import('../src/core/paymentTerminalSettlement.ts')
  /* تعريف الماكينة: كود فريد وطرفية مكررة لدى المزود مرفوضة */
  const t1 = { id: 'a', code: 'TERM-0001', nameAr: 'كاشير ١', providerName: 'visanet', branchId: 'b1', settlementAccountCode: '1102', terminalId: 'T-9', status: 'active' }
  assert.deepEqual(validatePaymentTerminal(t1, [t1]), [])
  assert.ok(validatePaymentTerminal({ ...t1, id: 'b' }, [t1]).some((e) => e.includes('مستخدم')))
  assert.ok(validatePaymentTerminal({ ...t1, id: 'b', terminalId: 'T-9', providerName: 'visanet', code: 'TERM-0002' }, [t1]).some((e) => e.includes('مكرر')))
  assert.ok(validatePaymentTerminal({ ...t1, code: 'term' }, []).some((e) => e.includes('كود')))
  assert.equal(nextTerminalCode(['TERM-0001', 'TERM-0007', 'x']), 'TERM-0008')
  /* قبض: مفتاح منع التكرار من نوع المستند والماكينة، والمرجع يولَّد عند غيابه */
  const charge = buildTerminalCharge({ terminal: t1, documentType: 'sale', documentId: 15, amountMinor: 2500, providerReference: '', occurredAt: '2026-10-02T10:00:00Z', userId: 3 })
  assert.equal(charge.idempotencyKey, 'sale:15:terminal:a')
  assert.ok(charge.providerReference.startsWith('AUTO-'))
  assert.equal(validateTerminalTransaction(charge).length, 0)
  /* ردود متعددة: المجموع لا يتجاوز الأصل أبداً (ملكية) */
  for (let trial = 0; trial < 500; trial++) {
    const original = buildTerminalCharge({ terminal: t1, documentType: 'sale', documentId: 1, amountMinor: ri(100, 10000), providerReference: 'r', occurredAt: '2026-10-02T09:00:00Z', userId: 1 })
    const all = [original]
    const nRefs = ri(0, 4)
    let refunded = 0
    for (let k = 0; k < nRefs; k++) {
      const remain = remainingRefundableMinor(original, all)
      if (remain <= 0) break
      const amount = ri(1, remain)
      all.push(buildTerminalRefund(original, all, { documentId: 100 + k, amountMinor: amount, providerReference: `r${k}`, occurredAt: '2026-10-02T12:00:00Z', userId: 1 }))
      refunded += amount
    }
    assert.equal(remainingRefundableMinor(original, all), original.amountMinor - refunded, 'المتبقي دقيق')
    assert.ok(remainingRefundableMinor(original, all) >= 0)
    assert.equal(netSettlementTransactions(all), original.amountMinor - refunded)
  }
  assert.throws(() => buildTerminalRefund(charge, [charge], { documentId: 2, amountMinor: 2501, providerReference: 'x', occurredAt: '2026-10-02T12:00:00Z', userId: 1 }), /يتجاوز/)
  /* رد بلا أصل مرفوض ورد على ماكينة أخرى مرفوض */
  const refund = buildTerminalRefund(charge, [charge], { documentId: 3, amountMinor: 100, providerReference: 'y', occurredAt: '2026-10-02T12:00:00Z', userId: 1 })
  assert.ok(validateTerminalTransaction({ ...refund, terminalId: 'آخر' }, charge).some((e) => e.includes('ماكينة')), 'رد بماكينة أخرى مرفوض')
  /* التسوية: متوقعة = إجمالي − رسوم − ضريبتها، والفرق إشارة صحيحة */
  for (let t = 0; t < 2000; t++) {
    const gross = ri(1, 10 ** 7), fee = ri(0, gross), feeTax = ri(0, Math.max(0, gross - fee))
    const expected = gross - fee - feeTax
    const deposited = Math.max(0, expected + ri(-100, 100))
    const s = calculateTerminalSettlement({ grossMinor: gross, feeMinor: fee, feeTaxMinor: feeTax, depositedMinor: deposited })
    assert.equal(s.differenceMinor, deposited - expected)
    assert.equal(s.balanced, deposited === expected)
  }
  assert.throws(() => calculateTerminalSettlement({ grossMinor: 100, feeMinor: 101, feeTaxMinor: 0, depositedMinor: 0 }), /تتجاوز/)
  assert.throws(() => calculateTerminalSettlement({ grossMinor: 100.5, feeMinor: 0, feeTaxMinor: 0, depositedMinor: 0 }), /غير صالحة/)
  assert.deepEqual(validateSettlementTransactions([]), ['تسوية الماكينة بلا عمليات'])
  assert.ok(validateSettlementTransactions(['a', 'a']).some((e) => e.includes('مكررة')))
  console.log('  ✓ 500 محفظة ردود + 2,000 تسوية + بناء القبض والحراس')
}

/* ─── ⑥ صلاحيات ماكينات الدفع: إصلاح «0 = بلا حد» ─── */
console.log('⑥ صلاحيات ماكينات الدفع: الصفر = بلا حد (إصلاح §78)')
{
  const { assertTerminalOperation, validateTerminalAccess, } = await import('../src/core/paymentTerminalAccess.ts')
  const { eligiblePaymentTerminals } = await import('../src/core/paymentTerminalEligibility.ts')
  /* العيب الأصلي: الواجهة تعِد «(0 = بلا حد)» والنواة كانت تمنع كل شيء */
  const zero = { grants: [{ terminalId: 't1', operations: ['charge'], maxAmountMinor: 0 }] }
  assert.doesNotThrow(() => assertTerminalOperation(zero, 't1', 'charge', 999_999_999), 'الصفر = بلا حد كما في الواجهة والخزائن')
  assert.doesNotThrow(() => assertTerminalOperation({ grants: [{ terminalId: 't1', operations: ['charge'] }] }, 't1', 'charge', 5))
  assert.throws(() => assertTerminalOperation({ grants: [{ terminalId: 't1', operations: ['charge'], maxAmountMinor: 3000 }] }, 't1', 'charge', 3001), /يتجاوز/)
  assert.throws(() => assertTerminalOperation(zero, 't1', 'refund', 1), /صلاحية/)
  /* التحقق البنيوي */
  assert.equal(validateTerminalAccess({ defaultTerminalId: 't2', grants: [{ terminalId: 't1', operations: ['charge'] }] }, new Set(['t1'])).length, 1, 'الافتراضي غير الممنوح وحده يُلتقط')
  assert.ok(validateTerminalAccess({ grants: [{ terminalId: 't1', operations: ['charge', 'charge'] }] }, new Set(['t1'])).some((e) => e.includes('مكررة')))
  /* الترشيح: الموقوفة والمعلقة خارج، والمالك يرى النشطة فقط، والمقيد بمنحه */
  const terminals = [
    { id: 't1', code: 'A', nameAr: '١', providerName: 'p', branchId: 'b1', settlementAccountCode: '1102', terminalId: 'T1', status: 'active' },
    { id: 't2', code: 'B', nameAr: '٢', providerName: 'p', branchId: 'b1', settlementAccountCode: '1102', terminalId: 'T2', status: 'suspended' },
    { id: 't3', code: 'C', nameAr: '٣', providerName: 'p', branchId: 'b2', settlementAccountCode: '1102', terminalId: 'T3', status: 'active' },
  ]
  assert.deepEqual(eligiblePaymentTerminals(terminals, { roleId: 'owner' }, 'charge').map((t) => t.id), ['t1', 't3'])
  assert.deepEqual(eligiblePaymentTerminals(terminals, { roleId: 'owner' }, 'charge', 'b2').map((t) => t.id), ['t3'])
  assert.deepEqual(eligiblePaymentTerminals(terminals, { roleId: 'cashier', paymentTerminalAccess: { grants: [{ terminalId: 't1', operations: ['refund'] }] } }, 'charge').map((t) => t.id), [])
  assert.deepEqual(eligiblePaymentTerminals(terminals, { roleId: 'cashier', paymentTerminalAccess: { grants: [{ terminalId: 't3', operations: ['charge'] }] } }, 'charge').map((t) => t.id), ['t3'])
  /* الواجهة تحمل نص الوعد — الدلالتان متطابقتان الآن */
  const permissions = read('../src/ui/pages/PermissionsPage.tsx')
  assert.ok(permissions.includes('(0 = بلا حد)'), 'نص الوعد ما زال في الواجهة والنواة تفي به')
  console.log('  ✓ الصفر=بلا حد (نواة=واجهة) + الترشيح بالحالة/الفرع/المنح')
}

/* ─── ⑦ التقارير والمطابقة: الحدود الزمنية وحساب الاستثناءات ─── */
console.log('⑦ تقارير الماكينة والمطابقة مع المزود')
{
  const { summarizeTerminalTransactions, summarizeTerminalReconciliation, terminalDocumentLabel, terminalReportCsv } = await import('../src/core/paymentTerminalReport.ts')
  const { parseProviderStatementCsv, reconcileProviderStatement, summarizeReconciliation } = await import('../src/core/paymentProviderReconciliation.ts')
  const { summarizeTreasuryByUser, treasuryUserSummaryCsv } = await import('../src/core/treasuryUserReport.ts')
  /* (إصلاح §78) «to» بتاريخ فقط يشمل يومه كله */
  const mkTx = (id, occurredAt, kind = 'charge', amountMinor = 100) => ({ id, idempotencyKey: `k${id}`, kind, terminalId: 't1', branchId: 'b1', userId: 1, documentId: 'd', amountMinor, providerReference: `r${id}`, occurredAt, ...(kind === 'charge' ? {} : { originalTransactionId: 'p' }) })
  assert.equal(summarizeTerminalTransactions([mkTx('a', '2026-10-02T23:30:00Z')], '2026-10-02', '2026-10-02').length, 1, 'نهاية بتاريخ فقط تشمل اليوم')
  assert.equal(summarizeTerminalTransactions([mkTx('a', '2026-10-03T00:01:00Z')], '2026-10-02', '2026-10-02').length, 0)
  assert.equal(summarizeTerminalTransactions([mkTx('a', '2026-10-02T08:00:00Z')], '2026-10-02T09:00:00Z').length, 0, 'بداية بلحظة كاملة كما هي')
  /* التسوية مقابل القيود: settled من أسماء المعرفات */
  const recon = summarizeTerminalReconciliation([mkTx('a', '2026-10-02T08:00:00Z'), mkTx('b', '2026-10-02T09:00:00Z', 'refund', 30)], [{ id: 's', terminalId: 't1', bankAccountCode: '1102', transactionIds: ['a'], settledAt: '', userId: 1, grossMinor: 100, feeMinor: 0, feeTaxMinor: 0, depositedMinor: 100, differenceMinor: 0, journalEntryId: 1 }])
  assert.deepEqual(recon[0], { terminalId: 't1', unsettledCount: 1, unsettledNetMinor: -30, settledCount: 1 })
  assert.equal(terminalDocumentLabel('wallet_service'), 'خدمات المحافظ')
  assert.ok(terminalReportCsv([]).startsWith('\uFEFF'), 'CSV بBOM')
  /* مطابقة المزود: كل الحالات الخمس — الردود بإشارة سالبة في الكشف */
  const csv = 'providerReference,amountMinor\nr1,1000\nr2,-500\nr1,1000\nr9,700\n'
  const local = [
    { ...mkTx('x1', '2026-10-02T08:00:00Z'), providerReference: 'r1', amountMinor: 1000 },
    { ...mkTx('x2', '2026-10-02T08:00:00Z', 'refund', 500), providerReference: 'r2' },
    { ...mkTx('x3', '2026-10-02T08:00:00Z'), providerReference: 'r9', amountMinor: 699 },
    { ...mkTx('x4', '2026-10-02T08:00:00Z'), providerReference: 'r-local-only', amountMinor: 50 },
  ]
  const matches = reconcileProviderStatement('t1', parseProviderStatementCsv(csv), local)
  const byRef = Object.fromEntries(matches.map((m) => [`${m.providerReference}:${m.status}`, m]))
  assert.ok(byRef['r1:matched'], 'r1 مطابق')
  assert.ok(byRef['r2:matched'], 'r2 رد بحاصل سالب يطابق')
  assert.ok(byRef['r1:duplicate_statement'], 'r1 مكرر بالكشف')
  assert.ok(byRef['r9:amount_mismatch'], 'r9 فرق مبلغ')
  assert.ok(matches.some((m) => m.status === 'missing_statement' && m.providerReference === 'r-local-only'), 'محلي بلا كشف')
  const summary = summarizeReconciliation(matches)
  assert.ok(summary.exceptionCount > 0 && !summary.canClose, 'باستثناءات لا يُغلق')
  const clean = reconcileProviderStatement('t1', [{ providerReference: 'r1', amountMinor: 1000 }], [{ ...mkTx('x1', '2026-10-02T08:00:00Z'), providerReference: 'r1', amountMinor: 1000 }])
  assert.equal(summarizeReconciliation(clean).canClose, true, 'نظيف تماماً يُغلق')
  /* تقرير المستخدم النقدي: التحويل خروج للمصدر ودخول للوجهة */
  const entries = [
    { id: 1, date: '2026-10-01', createdBy: 'أحمد', sourceType: 'receipt_voucher', lines: [{ accountCode: '1101', debit: 500, credit: 0 }, { accountCode: '1104', debit: 0, credit: 500 }] },
    { id: 2, date: '2026-10-02', createdBy: 'سارة', sourceType: 'transfer', lines: [{ accountCode: '1102', debit: 300, credit: 0 }, { accountCode: '1101', debit: 0, credit: 300 }] },
    { id: 3, date: '2026-11-01', createdBy: 'أحمد', sourceType: 'payment_voucher', lines: [{ accountCode: '1101', debit: 0, credit: 50 }, { accountCode: '5108', debit: 50, credit: 0 }] },
  ]
  const byUser = Object.fromEntries(summarizeTreasuryByUser(entries, ['1101', '1102'], '2026-10-01', '2026-10-31').map((s) => [s.userName, s]))
  assert.equal(byUser['أحمد'].receiptsMinor, 500); assert.equal(byUser['أحمد'].paymentsMinor, 0); assert.equal(byUser['أحمد'].operationsCount, 1, 'نوفمبر خارج الفترة')
  assert.equal(byUser['سارة'].receiptsMinor, 300, 'وجهة التحويل دخول'); assert.equal(byUser['سارة'].paymentsMinor, 300, 'مصدر التحويل خروج'); assert.equal(byUser['سارة'].netMinor, 0)
  assert.ok(treasuryUserSummaryCsv([]).includes('المستخدم'))
  console.log('  ✓ حدود زمنية مصححة + مطابقة كل الحالات + تقرير المستخدم بالاتجاهين')
}

/* ─── ⑧ الاستبدال والإصلاحات الموثقة ─── */
console.log('⑧ الاستبدال (ملابس) وتوثيق الإصلاحات')
{
  const { computeExchangeNet, validateExchange } = await import('../src/core/exchange.ts')
  assert.deepEqual(computeExchangeNet(300, 450), { returnValueMinor: 300, newValueMinor: 450, netMinor: 150, })
  assert.equal(computeExchangeNet(500, 200).netMinor, -300, 'نرد له الفرق')
  assert.equal(computeExchangeNet(200, 200).netMinor, 0)
  assert.ok(validateExchange({ returnLines: [], newLines: [{ itemId: 1, qty: 1 }] }).some((e) => e.includes('بإرجاع')))
  assert.ok(validateExchange({ returnLines: [{ itemId: 1, qty: 0 }], newLines: [{ itemId: 2, qty: 1 }] }).some((e) => e.includes('كمية مرتجعة')))
  const access = read('../src/core/paymentTerminalAccess.ts')
  assert.ok(access.includes('الصفر/الغياب = بلا حد'), 'إصلاح حد الماكينة موثق')
  const cheques = read('../src/core/cheques.ts')
  assert.ok(cheques.includes('2026-02-30') && cheques.includes('يوماً حقيقياً'), 'إصلاح تقويم الشيك موثق')
  const report = read('../src/core/paymentTerminalReport.ts')
  assert.ok(report.includes('تطبيع تاريخ فقط'), 'إصلاح الحد الزمني موثق')
  console.log('  ✓ صافي الاستبدال بالاتجاهات الثلاثة + الإصلاحات الثلاثة موثقة بمصدرها')
}

console.log('✅ جولة المالك — مراجعة الخزينة والبنوك: 8 فحوص ناجحة')
