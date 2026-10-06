/**
 * جولة المالك — مراجعة نواة المستندات التجارية ملفاً ملفاً (§76 — نطاق P0 الثاني).
 * تحرس العيوب الثلاثة المكتشفة بالقراءة الدقيقة (المصدر ثم البرهان بالممتلكات):
 *   1) documentCharges.allocateChargeByLineBase: التقريب النصفي لأكثر من سطر كان
 *      يتجاوز الرسم فيأخذ آخر سطر موجب الفرق **سالباً** — (2,[1,1,1,1]) ⇒ [1,1,1,−1].
 *   2) commercialDocument.validateCommercialDocumentMeta: «معتمد» يحمل وقت ترحيل
 *      كان يمر صامتاً — تناقض يفسد سجل التدقيق.
 *   3) statements (بيان كشف الموظف): «مسير X — إجمالي 300000، صافي 250000» كان
 *      يعرض خام الوحدة الصغرى؛ الأرقام الآن في عمودَي العملية/الخصم المنسقين.
 * تشغيل: node --experimental-strip-types scripts/verify_owner_documents_core_review.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const read = (p) => readFileSync(here + p, 'utf8')

let seed = 20261002
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))

/* ─── ① الإجماليات: علاقات القيم الأربع وحدودها ─── */
console.log('① إجماليات المستند: الصافي/الخصم/الرسوم/الضريبة/المدفوع')
{
  const { calculateDocumentTotals, assertDocumentTotals } = await import('../src/core/documentTotals.ts')
  for (let t = 0; t < 3000; t++) {
    const subtotalMinor = ri(0, 10 ** 7)
    const chargeMinor = ri(0, 10 ** 5)
    const taxMinor = ri(0, 10 ** 5)
    const room = subtotalMinor + chargeMinor + taxMinor
    const discountMinor = ri(0, room)
    const grandTotalMinor = subtotalMinor - discountMinor + chargeMinor + taxMinor
    const paidMinor = ri(0, grandTotalMinor)
    const totals = calculateDocumentTotals({ subtotalMinor, discountMinor, chargeMinor, taxMinor, paidMinor })
    assert.equal(totals.grandTotalMinor, grandTotalMinor, 'الإجمالي = الصافي − الخصم + الرسوم + الضريبة')
    assert.equal(totals.dueMinor, grandTotalMinor - paidMinor, 'المتبقي = الإجمالي − المدفوع')
    assertDocumentTotals(totals) /* الحفظ ثم التحقق ذهاباً وإياباً */
  }
  /* الحدود: خصم يلتهم كل شيء ⇒ إجمالي صفر، ومدفوع كامل ⇒ متبقٍ صفر */
  assert.equal(calculateDocumentTotals({ subtotalMinor: 100, discountMinor: 100, chargeMinor: 0, taxMinor: 0, paidMinor: 0 }).grandTotalMinor, 0)
  assert.equal(calculateDocumentTotals({ subtotalMinor: 100, discountMinor: 0, chargeMinor: 0, taxMinor: 0, paidMinor: 100 }).dueMinor, 0)
  /* الرفض: خصم فوق السقف، مدفوع فوق الإجمالي، كسور وسوالب */
  assert.throws(() => calculateDocumentTotals({ subtotalMinor: 100, discountMinor: 101, chargeMinor: 0, taxMinor: 0, paidMinor: 0 }), /يتجاوز/)
  assert.throws(() => calculateDocumentTotals({ subtotalMinor: 100, discountMinor: 0, chargeMinor: 0, taxMinor: 0, paidMinor: 101 }), /يتجاوز/)
  assert.throws(() => calculateDocumentTotals({ subtotalMinor: 100, discountMinor: 0, chargeMinor: 0, taxMinor: 0, paidMinor: 0.5 }), /غير صالحة/)
  assert.throws(() => calculateDocumentTotals({ subtotalMinor: -1, discountMinor: 0, chargeMinor: 0, taxMinor: 0, paidMinor: 0 }), /غير صالحة/)
  console.log('  ✓ 3,000 حالة + الحدود والرفض الأربعة — العلاقات محفوظة ذهاباً وإياباً')
}

/* ─── ② الضريبة: قوس BigInt نصف-صاعد بلا فقد قرش + لقطات مستوفاة ─── */
console.log('② ضريبة المستند: نصف-صاعد BigInt وتجميع حسب الكود')
{
  const { calculateTaxMinor, summarizeTaxes, validateTaxSnapshot } = await import('../src/core/documentTax.ts')
  const vat = { code: 'VAT14', nameAr: 'ضريبة القيمة المضافة ١٤٪', rateBasisPoints: 1400, capturedAt: '2026-01-01T00:00:00.000Z' }
  assert.deepEqual(validateTaxSnapshot(vat), [])
  for (let b = 0; b <= 10000; b += 250) {
    const tax = { ...vat, rateBasisPoints: b }
    for (let t = 0; t < 40; t++) {
      const netMinor = ri(1, 10 ** 9)
      /* نصف-صاعد يدوياً بالمقارنة مع الكسر العشري الدقيق */
      const exact = netMinor * b / 10000
      const expected = Math.floor(exact + 0.5)
      assert.equal(calculateTaxMinor(netMinor, tax), expected, `ضريبة ${netMinor}@${b}bp`)
    }
  }
  assert.equal(calculateTaxMinor(12345, null), 0, 'بلا ضريبة ⇒ صفر')
  /* التجميع: مجموع المجموعات = مجموع الأسطر، وEXEMPT يجمع غير الخاضع */
  for (let t = 0; t < 300; t++) {
    const lines = Array.from({ length: ri(1, 15) }, () => {
      const pick = rnd()
      const netMinor = ri(1, 10 ** 6)
      return { netMinor, tax: pick < 0.2 ? null : pick < 0.6 ? vat : { ...vat, code: 'SRV10', rateBasisPoints: 1000 } }
    })
    const summary = summarizeTaxes(lines)
    const netSum = Object.values(summary).reduce((s, r) => s + r.netMinor, 0)
    const taxSum = Object.values(summary).reduce((s, r) => s + r.taxMinor, 0)
    assert.equal(netSum, lines.reduce((s, l) => s + l.netMinor, 0), 'صافي المجموعات = صافي الأسطر')
    assert.equal(taxSum, lines.reduce((s, l) => s + calculateTaxMinor(l.netMinor, l.tax), 0), 'ضريبة المجموعات = ضريبة الأسطر')
  }
  assert.equal(summarizeTaxes([{ netMinor: 500, tax: null }, { netMinor: 700, tax: null }]).EXEMPT.netMinor, 1200)
  /* رفض اللقطات الفاسدة */
  assert.ok(validateTaxSnapshot({ ...vat, code: 'vat' }).includes('كود الضريبة غير صالح'))
  assert.ok(validateTaxSnapshot({ ...vat, nameAr: '  ' }).includes('اسم الضريبة مطلوب'))
  assert.ok(validateTaxSnapshot({ ...vat, rateBasisPoints: 10001 }).includes('نسبة الضريبة غير صالحة'))
  assert.ok(validateTaxSnapshot({ ...vat, capturedAt: 'ليس تاريخاً' }).includes('وقت لقطة الضريبة غير صالح'))
  assert.throws(() => calculateTaxMinor(100, { ...vat, rateBasisPoints: -1 }), /نسبة/)
  console.log('  ✓ 1,640 نسبة/مبلغ + 300 تجميع — لا قرش يضيع واللقطات محروسة')
}

/* ─── ③ الرسوم: توزيع بلا حصة سالبة (عيب §76) + صافي ما بعد الرسوم ─── */
console.log('③ رسوم المستند: التوزيع الحتمي وصافي المستند')
{
  const { allocateChargeByLineBase, documentNetAfterCharges, validateDocumentCharges } = await import('../src/core/documentCharges.ts')
  /* العيب الأصلي: (2,[1,1,1,1]) كانت [1,1,1,−1] */
  assert.deepEqual(allocateChargeByLineBase(2, [1, 1, 1, 1]).map((x) => x.amountMinor), [0, 0, 0, 2])
  assert.deepEqual(allocateChargeByLineBase(1, [1, 1, 1, 1]).map((x) => x.amountMinor), [0, 0, 0, 1])
  assert.deepEqual(allocateChargeByLineBase(3, [1, 1, 1, 1]).map((x) => x.amountMinor), [0, 0, 0, 3])
  /* التوثيق القائم محفوظ */
  assert.deepEqual(allocateChargeByLineBase(10, [100, 100, 100]).map((x) => x.amountMinor), [3, 3, 4])
  assert.deepEqual(allocateChargeByLineBase(9, [0, 200, 100]).map((x) => x.amountMinor), [0, 6, 3])
  /* الملكية: 15,000 حالة — المجموع مطابق حرفياً ولا حصة سالبة مهما صغر الرسم */
  for (let t = 0; t < 15000; t++) {
    const amount = ri(0, 500)
    const bases = Array.from({ length: ri(1, 10) }, () => ri(0, 1000))
    const alloc = allocateChargeByLineBase(amount, bases)
    assert.equal(alloc.reduce((s, x) => s + x.amountMinor, 0), amount, 'مجموع الحصص = الرسم')
    for (const share of alloc) assert.ok(share.amountMinor >= 0, 'لا حصة سالبة')
    assert.deepEqual(alloc.map((x) => x.lineIndex), bases.map((_, i) => i), 'فهارس الأسطر مرتبة')
  }
  assert.throws(() => allocateChargeByLineBase(5, [0, 0]), /صفري/)
  assert.throws(() => allocateChargeByLineBase(-1, [1]), /قيمة الرسم/)
  /* الصافي: الخصم ينقص والبقية تزيد */
  for (let t = 0; t < 500; t++) {
    const subtotalMinor = ri(1000, 10 ** 7)
    const charges = Array.from({ length: ri(0, 6) }, (_, k) => ({
      kind: k % 2 === 0 ? 'discount' : 'shipping', nameAr: `بند ${k}`, amountMinor: ri(0, 500), taxable: true,
    }))
    const expected = charges.reduce((net, c) => net + (c.kind === 'discount' ? -c.amountMinor : c.amountMinor), subtotalMinor)
    assert.equal(documentNetAfterCharges(subtotalMinor, charges), expected)
  }
  assert.ok(validateDocumentCharges([{ kind: 'shipping', nameAr: '  ', amountMinor: 5 }]).some((e) => e.includes('مطلوب')))
  assert.ok(validateDocumentCharges([{ kind: 'shipping', nameAr: 'شحن', amountMinor: 5.5 }]).some((e) => e.includes('غير صالحة')))
  console.log('  ✓ 15,000 توزيع بلا سالب + 500 صافي — العيب مؤمَّن بملكية شاملة')
}

/* ─── ④ التسويات: الملغاة لا تحسب والتجاوز مرفوض والحالات ثلاث ─── */
console.log('④ تسويات المستند: مدفوع/متبقٍ/حالة')
{
  const { validateSettlements, settlementSummary } = await import('../src/core/documentSettlement.ts')
  const mk = (over) => ({ id: 'S1', documentId: 'D1', amountMinor: 100, settledAt: '2026-10-01T10:00:00.000Z', method: 'cash', voided: false, ...over })
  for (let t = 0; t < 2000; t++) {
    let grand = ri(100, 10 ** 6)
    const n = ri(0, 6)
    let paid = 0
    const settlements = []
    for (let k = 0; k < n; k++) {
      const amount = ri(1, 1000)
      const voided = rnd() < 0.35
      settlements.push(mk({ id: `S${k}`, amountMinor: amount, voided }))
      if (!voided) paid += amount
    }
    if (paid > grand) grand = paid /* نبقِ السيناريو قانونياً */
    assert.deepEqual(validateSettlements('D1', grand, settlements), [], 'تسويات قانونية تمر')
    const summary = settlementSummary(grand, settlements)
    assert.equal(summary.paidMinor, paid, 'المدفوع يجمع غير الملغى فقط')
    assert.equal(summary.dueMinor, grand - paid)
    assert.equal(summary.status, paid === 0 ? 'unpaid' : paid === grand ? 'paid' : 'partial')
    /* الحفظ ذهاباً وإياباً مع validate */
    const totals = { subtotalMinor: grand, discountMinor: 0, chargeMinor: 0, taxMinor: 0, paidMinor: summary.paidMinor }
    const { calculateDocumentTotals } = await import('../src/core/documentTotals.ts')
    assert.equal(calculateDocumentTotals(totals).dueMinor, summary.dueMinor, 'dueMinor التسويات = dueMinor الإجماليات')
  }
  /* الرفض */
  assert.ok(validateSettlements('D1', 100, [mk({ id: 'S1' }), mk({ id: 'S1', amountMinor: 50 })]).some((e) => e.includes('مكرر')))
  assert.ok(validateSettlements('D1', 100, [mk({ documentId: 'D2' })]).some((e) => e.includes('مستنداً آخر')))
  assert.ok(validateSettlements('D1', 100, [mk({ amountMinor: 0 })]).some((e) => e.includes('قيمة التسوية')))
  assert.ok(validateSettlements('D1', 100, [mk({ settledAt: 'تاريخ؟' })]).some((e) => e.includes('تاريخ التسوية')))
  assert.ok(validateSettlements('D1', 100, [mk({ amountMinor: 101 })]).some((e) => e.includes('تتجاوز')))
  assert.ok(validateSettlements('D1', 100, [mk({ id: '' })]).some((e) => e.includes('معرف')))
  assert.throws(() => settlementSummary(100, [mk({ amountMinor: 101 })]), /تتجاوز/)
  console.log('  ✓ 2,000 سيناريو (مع ملغاة) + سبع حالات رفض — التسويات محروسة')
}

/* ─── ⑤ دورة الحياة: المصفوفة كاملة حرفياً ─── */
console.log('⑤ دورة حياة المستند: الانتقالات المسموحة والممنوعة')
{
  const { transitionDocument, isDocumentEditable, isDocumentTerminal, isValidIdempotencyKey, InvalidDocumentTransitionError } = await import('../src/core/documentLifecycle.ts')
  const allowed = [
    ['draft', 'approve', 'approved'], ['draft', 'void', 'voided'],
    ['approved', 'reopen', 'draft'], ['approved', 'post', 'posted'], ['approved', 'void', 'voided'],
    ['posted', 'record_partial_reversal', 'partially_reversed'], ['posted', 'record_full_reversal', 'reversed'],
    ['partially_reversed', 'record_partial_reversal', 'partially_reversed'], ['partially_reversed', 'record_full_reversal', 'reversed'],
  ]
  /* سياق نظيف للمصفوفة؛ حواجز السياق تُفحص منفصلة بعده */
  const ctx = { hasPartialReversal: true, hasFullReversal: true }
  for (const [from, action, to] of allowed) assert.equal(transitionDocument(from, action, ctx), to, `${from}+${action}→${to}`)
  /* كل زوج آخر يُرفض — مسح المصفوفة كاملة */
  const statuses = ['draft', 'approved', 'posted', 'partially_reversed', 'reversed', 'voided']
  const actions = ['approve', 'reopen', 'post', 'record_partial_reversal', 'record_full_reversal', 'void']
  for (const from of statuses) for (const action of actions) {
    if (allowed.some(([f, a]) => f === from && a === action)) continue
    assert.throws(() => transitionDocument(from, action, ctx), InvalidDocumentTransitionError, `يجب رفض ${from}+${action}`)
  }
  /* حواجز السياق: الإلغاء يمنع الآثار المرحلة، والعكس يحتاج مستنداً مرتبطاً */
  assert.throws(() => transitionDocument('approved', 'void', { hasPostedEffects: true }), /آثار مرحّلة/)
  assert.throws(() => transitionDocument('draft', 'void', { hasPostedEffects: true }), /آثار مرحّلة/)
  assert.throws(() => transitionDocument('posted', 'record_partial_reversal', {}), /عكس جزئي دون/)
  assert.throws(() => transitionDocument('posted', 'record_full_reversal', {}), /العكس الكامل دون/)
  /* الوضعيات النهائية والقابلية للتحرير ومفتاح منع التكرار */
  for (const s of statuses) assert.equal(isDocumentEditable(s), s === 'draft')
  for (const s of statuses) assert.equal(isDocumentTerminal(s), s === 'reversed' || s === 'voided')
  assert.ok(isValidIdempotencyKey('sale_01K5ABCD1234567890'))
  assert.ok(!isValidIdempotencyKey('_leadingunderscore_12345')) /* يبدأ برمز */
  assert.ok(!isValidIdempotencyKey('short_key_123')) /* أقل من 16 */
  assert.ok(!isValidIdempotencyKey('has space in it padding1')) /* فراغ */
  assert.ok(isValidIdempotencyKey('legacy_purchase_00000042')) /* مفاتيح النقل القديمة */
  console.log('  ✓ المصفوفة 6×6 كاملة + حواجز السياق + المفتاح — 27 رفضاً محققاً')
}

/* ─── ⑥ البيانات المشتركة: اعتماد/ترحيل متسقان (عيب §76) + النقل القديم ─── */
console.log('⑥ بيانات المستند المشتركة: التسلسل الهرمي للحقول ونقل القديم')
{
  const { validateCommercialDocumentMeta, normalizeLegacyDocumentMeta } = await import('../src/core/commercialDocument.ts')
  const valid = {
    status: 'draft', documentDate: '2026-10-01', postedAt: null, dueDate: null, externalReference: null, notes: '',
    createdBy: 'المالك', createdAt: '2026-10-01T08:00:00.000Z', approvedBy: null, approvedAt: null, postedBy: null,
    idempotencyKey: 'sale_01K5ABCD1234567890',
  }
  assert.deepEqual(validateCommercialDocumentMeta(valid), [])
  /* العيب الأصلي: معتمد يحمل وقت ترحيل كان يمر */
  assert.ok(validateCommercialDocumentMeta({ ...valid, status: 'approved', approvedBy: 'مدير', approvedAt: '2026-10-01T09:00:00.000Z', postedAt: '2026-10-01T10:00:00.000Z' }).includes('المستند المعتمد (غير المرحّل) لا يحمل وقت ترحيل'))
  /* بقية التسلسل: مسودة بلا وقت ترحيل، معتمد باسم معتمد، مرحّل باسم مرحّل */
  assert.ok(validateCommercialDocumentMeta({ ...valid, postedAt: '2026-10-01T10:00:00.000Z' }).includes('المسودة لا تحمل وقت ترحيل'))
  const approvedErrors = validateCommercialDocumentMeta({ ...valid, status: 'approved' })
  assert.ok(approvedErrors.some((e) => e.includes('الاعتماد') && e.includes('مطلوب')) || approvedErrors.some((e) => e.includes('اعتماد')), JSON.stringify(approvedErrors))
  assert.ok(validateCommercialDocumentMeta({ ...valid, status: 'posted' }).some((e) => e.includes('ترحيل')))
  assert.ok(validateCommercialDocumentMeta({ ...valid, dueDate: '2026-09-30' }).some((e) => e.includes('يسبق')))
  assert.ok(validateCommercialDocumentMeta({ ...valid, createdBy: ' ' }).some((e) => e.includes('مطلوب')))
  assert.ok(validateCommercialDocumentMeta({ ...valid, documentDate: '01-10-2026' }).some((e) => e.includes('تاريخ المستند')))
  /* النقل القديم: المخرجات تمر التحقق دائماً — 3,000 سيناريو (ملكية الذهاب-والإياب) */
  for (let t = 0; t < 3000; t++) {
    const hasJournal = rnd() < 0.5
    const date = `2026-${String(ri(1, 12)).padStart(2, '0')}-${String(ri(1, 28)).padStart(2, '0')}`
    /* الاستحقاق دائماً بعد التاريخ حتى يكون السجل القديم متسقاً داخلياً */
    const dueDate = rnd() < 0.5 ? '2027-06-01' : null
    const legacy = {
      date,
      journalEntryId: hasJournal ? ri(1, 99999) : null,
      createdBy: rnd() < 0.2 ? '   ' : `موظف ${ri(1, 20)}`,
      createdAt: rnd() < 0.3 ? null : '2026-01-05T12:00:00.000Z',
      notes: rnd() < 0.5 ? 'ملاحظة' : null,
      dueDate,
    }
    const meta = normalizeLegacyDocumentMeta(legacy, { kind: 'purchase', id: ri(1, 99999999) })
    const errors = validateCommercialDocumentMeta(meta)
    assert.deepEqual(errors, [], `سجل قديم قانوني يجب أن يمر: ${JSON.stringify(errors)}`)
    assert.equal(meta.status, hasJournal ? 'posted' : 'draft')
    if (hasJournal) { assert.ok(meta.postedAt); assert.ok(meta.postedBy) } else { assert.equal(meta.postedAt, null); assert.equal(meta.postedBy, null) }
  }
  /* مفتاح النقل يُقبل حتى لو فُقد الأصل */
  const migrated = normalizeLegacyDocumentMeta({ date: '2026-03-15', journalEntryId: 77 }, { kind: 'purchase', id: 42 })
  assert.equal(migrated.idempotencyKey, 'legacy_purchase_00000042')
  console.log('  ✓ 3,000 نقل قديم يمر التحقق + تسلسل الحقول — لا تناقض صامت')
}

/* ─── ⑦ الإصلاحات الثلاثة موثقة في مصدرها ─── */
console.log('⑦ توثيق الإصلاحات في المصدر')
{
  const charges = read('../src/core/documentCharges.ts')
  assert.ok(charges.includes('سالباً') && charges.includes('BigInt(amountMinor)'), 'إصلاح التوزيع السالب موثق')
  const meta = read('../src/core/commercialDocument.ts')
  assert.ok(meta.includes('المستند المعتمد (غير المرحّل) لا يحمل وقت ترحيل'), 'إصلاح المعتمد/وقت الترحيل موثق')
  const statements = read('../src/core/statements.ts')
  assert.ok(statements.includes('خامَّين بالوحدة الصغرى'), 'إصلاح بيان المسير الخام موثق')
  assert.ok(!statements.includes('— إجمالي ${line.grossMinor}'), 'لا بقايا للبيان الخام')
  console.log('  ✓ الإصلاحات الثلاثة موجودة بتعليقاتها في الملفات الثلاثة')
}

console.log('✅ جولة المالك — مراجعة نواة المستندات: 7 فحوص ناجحة')
