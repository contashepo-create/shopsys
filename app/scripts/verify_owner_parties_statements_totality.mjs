/**
 * بوابة مراجعة §82 — «الأطراف والحسابات» (جولة المالك الثالثة على مصفوفة §70-هـ)
 * ─────────────────────────────────────────────────────────────────────────────
 * النطاق: core/partyCodes · core/partyNotes · core/openPartyDocuments ·
 *         core/statements (كشوف العملاء/الموردين/الموظفين + أعمار الديون).
 *
 * البوابات السابقة غطت كل مسار على حدة (verify_parties_review،
 * verify_control_accounts_offset، verify_voucher_fx_and_specialized…) —
 * ما ليس موجوداً في مكان واحد هو **برهان الشمول الكلي**:
 *
 * ① السيناريو المتشابك والمطابقة الكلية: كل أنواع الحركات المؤثرة في ذمة
 *    طرف واحدةً في حالة واحدة متشابكة، ثم:
 *      Σ أرصدة كشوف **كل** العملاء = رصيد 1104 الدفتري بالقرش
 *      Σ أرصدة كشوف **كل** الموردين = رصيد 2101 الدفتري (معكوساً) بالقرش
 *    أي مسار يقيد 1104/2101 ولا يظهر في كشف طرفه — أو يظهر ولا يقيد —
 *    يكسر هذين المتساويين فوراً. (نمط فجوة §81: الحراسة في المستودع لا الواجهة.)
 * ② أكواد الأطراف: اشتقاق ثابت + مطابقة بحث ذكية + تمدد بعد 9999 + فلتر موحد.
 * ③ سجل ملاحظات الأطراف: تنظيف/حدود/رفض + ترتيب مستقر + ختم عربي.
 * ④ أعمار الديون: شرائح 30/60/90 مع تخصيص FIFO للسداد + افتتاحي دائماً +90 +
 *    قلب أعمدة كشف المورد.
 * ⑤ مستندات الأنشطة المتخصصة (نواة صرفة): قواعد الاستحقاق تطابق الكشف حرفياً
 *    (تذكرة قبل التسليم لا ذمة، معمل آجل، إيجار، سيارة بمقدم، settledOf).
 * ⑥ حراس الأطراف في المستودع: لا حذف عميل/مورد له رصيد أو حركة.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_owner_parties_statements_totality.mjs
 */
import assert from 'node:assert/strict'
import { freshCase, assertInvariants, expectReject, balanceOf, addSimpleItem, addParty, reporter } from './auditKit.mjs'
import { partyCode, matchesPartyCode, partySearchFilter, PARTY_CODE_LABELS } from '../src/core/partyCodes.ts'
import { buildPartyNote, normalizePartyNoteText, partyNotesFor, formatPartyNoteStamp, PARTY_NOTE_MAX } from '../src/core/partyNotes.ts'
import { openCustomerSpecializedDocuments, openSupplierSpecializedDocuments, documentKindLabel } from '../src/core/openPartyDocuments.ts'
import { agingFromStatement, supplierRowsForAging, statementBalance, customerStatement, supplierStatement, employeeStatement } from '../src/core/statements.ts'

const R = reporter('الأطراف والحسابات — الشمول الكلي (§82)')
const bal = (c, code) => balanceOf(c.st().journal, code)
const J = (minor) => minor * 10 // جنيه ⇒ قرش بعشرين قرشاً؟ لا: مباشرة بالوحدة الصغرى

// ——— ① السيناريو المتشابك + المطابقة الكلية ———
{
  const c = await freshCase({ activityId: 'general' })
  // تفعيل الولاء كما تفعله شاشة الإعدادات — يُقرأ لحظة البيع من localStorage،
  // والدمج (لا الاستبدال) لأن setup.allowNegativeTreasury وغيره يعيشان في نفس المفتاح
  {
    const raw = JSON.parse(globalThis.localStorage.getItem('shopsys-app') ?? '{}')
    raw.state = { ...(raw.state ?? {}), loyalty: { enabled: true, pointsPerUnit: 1, redeemValueMinor: 5, minRedeemPoints: 100 } }
    globalThis.localStorage.setItem('shopsys-app', JSON.stringify(raw))
  }
  // ثلاثة عملاء وثلاثة موردين — منهم من بلا حركات إطلاقاً (مساهمة الصفر جزء من البرهان)
  const custA = addParty(c, 'customer', 'عميل الأنشطة الكاملة')
  const custB = addParty(c, 'customer', 'عميل المقاصة')
  const custC = addParty(c, 'customer', 'عميل بلا حركات')
  const supA = addParty(c, 'supplier', 'مورد الأنشطة الكاملة')
  const supB = addParty(c, 'supplier', 'مورد المقاصة')
  const supC = addParty(c, 'supplier', 'مورد بلا حركات')

  const item = addSimpleItem(c, { nameAr: 'بضاعة §82', priceMinor: 1000 })
  // شراء نقدي تأسيسي (لا يمس 2101) لتغذية حراسة المخزون (§81) قبل أي بيع
  c.st().postPurchase({ supplierId: supC.id, date: '2026-04-01', lines: [{ itemId: item.id, qty: 1000, unitPriceMinor: 600, expiryDate: null }], expenses: [], paidMinor: 600000, treasury: '1101', notes: '' })
  const sellOnCredit = (customerId, amountMinor, date) =>
    c.st().postSale({
      lines: [{ itemId: item.id, nameAr: item.nameAr, qty: amountMinor / 1000, unitPriceMinor: 1000, unitCostMinor: 600, discountPercent: 0, soldByWeight: false }],
      customerId, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101', date,
    })

  // العميل أ: بيع آجل + بيع جزئي + مرتجع هجين + سند قبض + تحصيل مخصص + استبدال ولاء
  const s1 = sellOnCredit(custA.id, 100000, '2026-05-01') // 1000 جنيه ⇒ 100 نقطة ولاء
  const s2 = sellOnCredit(custA.id, 80000, '2026-05-02')
  // جزئي: نغطي 30000 نقداً (postSale بpayment credit ثم دفع؟ الأسهل: سند قبض يعادل الجزئية)
  // المرتجع الهجين يتطلب مُحصَّلاً فعلياً على الفاتورة: نحصّل 30000 على S2 تحديداً
  // (مطابقة محددة لا FIFO — وإلا لذهبت للفاتورة الأقدم S1)
  const clr = c.st().receiveClientPayment({ customerId: custA.id, amountMinor: 30000, treasury: '1101', specificDocKey: `sale:${s2.id}`, notes: 'دفعة على الفاتورة' })
  assert.deepEqual(clr.allocations.map((a) => [a.docKey, a.appliedMinor]), [[`sale:${s2.id}`, 30000]], 'المطابقة المحددة تذهب للفاتورة المطلوبة لا للأقدم')
  c.st().postSaleReturn({
    saleId: s2.id, qtyByItem: new Map([[item.id, 40]]), refund: 'custom',
    allocation: { cashMinor: 30000, creditMinor: 10000, storeCreditMinor: 0, waivedMinor: 0 },
    reason: 'مرتجع هجين §82', treasury: '1101',
  })
  const rv = c.st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 20000, description: 'سند قبض §82', partyKind: 'customer', partyId: custA.id, date: '2026-05-10' })
  assert.match(rv.voucherNumber, /^RV-\d+$/, 'رقم سند القبض')
  assert.equal(c.st().customers.find((x) => x.id === custA.id).loyaltyPoints, 1800, 'نقاط الولاء: 1000 من أول فاتورة + 800 من الثانية (قبل الاستبدال)')
  c.st().redeemLoyaltyPoints(custA.id, 100) // 100 نقطة × 5 قرش = 500 دائن

  // العميل ب: بيع آجل ثم مقاصة جزئية مع مورد ب
  sellOnCredit(custB.id, 200000, '2026-05-03')
  // العميل ج: قيد يدوي فقط (غرامة) — مسار القيود اليدوية بطرف
  c.st().postManualEntry({
    date: '2026-06-01', description: 'غرامة تأخير — قيد يدوي بطرف',
    lines: [
      { accountCode: '1104', debit: 7000, credit: 0, note: 'غرامة', partyKind: 'customer', partyId: custC.id },
      { accountCode: '5108', debit: 0, credit: 7000, note: 'غرامات متنوعة' },
    ],
  })

  // المورد أ: شراء آجل + مرتجع على الحساب + أصل ثابت بمقدم نقدي وباقٍ آجل (مسار التمويل النقدي
  // الرسمي «دفع من خزينة/بنك والباقي آجل») + قسط + سند صرف
  const pu = c.st().postPurchase({ supplierId: supA.id, date: '2026-05-04', lines: [{ itemId: item.id, qty: 300, unitPriceMinor: 700, expiryDate: null }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
  c.st().postPurchaseReturn({ purchaseId: pu.id, qtyByItem: new Map([[item.id, 70]]), refund: 'debt', reason: 'مرتجع مورد §82' })
  const asset = c.st().addAsset({ nameAr: 'ماكينة §82', costMinor: 100000, salvageMinor: 5000, lifeMonths: 60, paidMinor: 40000, notes: 'مقدم نقداً والباقي آجل', treasury: '1101', funding: 'cash', supplierId: supA.id })
  assert.equal(asset.paidMinor, 40000, 'المقدم محفوظ على الأصل')
  c.st().payAssetInstallment({ assetId: asset.id, amountMinor: 20000, treasury: '1101' })
  c.st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 60000, description: 'سند صرف §82', partyKind: 'supplier', partyId: supA.id, date: '2026-05-20' })

  // المورد ب: شراء آجل ثم مقاصة مع العميل ب
  c.st().postPurchase({ supplierId: supB.id, date: '2026-05-05', lines: [{ itemId: item.id, qty: 200, unitPriceMinor: 750, expiryDate: null }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
  const ofs = c.st().postPartyOffset({ customerId: custB.id, supplierId: supB.id, amountMinor: 100000, notes: 'مقاصة §82' })
  assert.match(ofs.offsetNumber, /^OFS-\d{4}$/)

  // الثابت الخامس بإزاحة محسوبة لا مكتوبة: التقييم السريع (كمية×متوسط مقرب للقرش)
  // يفرق عن الدفتر الدقيق بفروق تقريب صغيرة عند تعدد مستويات أسعار الشراء —
  // نحسبها ديناميكياً ونحرس سقفها (0.1% من قيمة المخزون) فلا يمر انحراف حقيقي متخفياً
  const inventoryValued = c.st().items.filter((i) => !i.isService).reduce((s, i) => s + (i.stockQty ?? 0) * (i.costMinor ?? 0), 0)
  const roundingOffset = inventoryValued - bal(c, '1103')
  assert.ok(Math.abs(roundingOffset) <= Math.max(1000, Math.round(Math.abs(bal(c, '1103')) / 1000)), `فرق تقريب المخزون ${roundingOffset} داخل السقف`)
  assertInvariants('السيناريو المتشابك قبل المطابقة', c, { inventoryOffsetMinor: roundingOffset })

  // ——— المطابقة الكلية: كل طرف في الدفتر له كشف، وكل كشف له سطر دفتر ———
  const customers = c.st().customers
  const suppliers = c.st().suppliers
  const sumCustomerStatements = customers.reduce((s, cu) => s + c.st().getCustomerBalance(cu.id), 0)
  const sumSupplierStatements = suppliers.reduce((s, su) => s + c.st().getSupplierBalance(su.id), 0)
  const ledger1104 = bal(c, '1104')
  const ledger2101 = bal(c, '2101')
  assert.equal(sumCustomerStatements, ledger1104, `Σ كشوف العملاء (${sumCustomerStatements}) = رصيد 1104 (${ledger1104})`)
  assert.equal(sumSupplierStatements, -ledger2101, `Σ كشوف الموردين (${sumSupplierStatements}) = رصيد 2101 معكوساً (${ledger2101} دائن)`)
  // أرصدة محسوبة يدوياً للتثليث:
  // العميل أ: 180000 آجلتان (نقطة لكل جنيه ⇒ 1800 نقطة ولاء) − 30000 تحصيل مخصص − 10000 مرتجع الذمم − 20000 سند − 500 ولاء = 119500
  assert.equal(c.st().getCustomerBalance(custA.id), 119500, 'رصيد العميل أ: 180000 − 30000 تحصيل − 10000 مرتجع الذمم − 20000 سند − 500 ولاء')
  // العميل ب: 200000 − مقاصة 100000
  assert.equal(c.st().getCustomerBalance(custB.id), 100000)
  assert.equal(c.st().getCustomerBalance(custC.id), 7000, 'قيد يدوي بطرف يدخل كشف عميل ج')
  // المورد أ: 210000 شراء − 49000 مرتجع + 60000 أصل آجل − 20000 قسط − 60000 سند = 141000
  assert.equal(c.st().getSupplierBalance(supA.id), 141000)
  // المورد ب: 150000 − 100000 مقاصة
  assert.equal(c.st().getSupplierBalance(supB.id), 50000)
  assert.equal(c.st().getSupplierBalance(supC.id), 0, 'مورد بلا حركات يساهم صفراً لا يلوث المجموع')
  // صفوف الكشف نفسها = رصيد الدالة (مصدر واحد داخل النواة)
  for (const cu of customers) {
    const rowsBalance = c.st().getCustomerStatementRows(cu.id).reduce((s, r) => s + r.debitMinor - r.creditMinor, 0)
    assert.equal(rowsBalance, c.st().getCustomerBalance(cu.id), `صفوف كشف ${cu.nameAr} = رصيد دالته`)
  }
  for (const su of suppliers) {
    const rowsBalance = c.st().getSupplierStatementRows(su.id).reduce((s, r) => s + r.creditMinor - r.debitMinor, 0)
    assert.equal(rowsBalance, c.st().getSupplierBalance(su.id), `صفوف كشف ${su.nameAr} = رصيد دالته`)
  }
  // الرصيد الافتتاحي يدخل الكشف والدفتر معاً (الطرف الوحيد ذو افتتاحي)
  R.ok('① المطابقة الكلية: Σ كشوف كل العملاء = 1104 وΣ كشوف كل الموردين = −2101 بالقرش — لا مسار يقيد الحساب ويغيب عن الكشف')
  R.ok('① التثليث اليدوي: أرصدة الأطراف الستة كما حُسبت على الورق (119500/100000/7000 · 141000/50000/0)')
  R.ok('① مصدر واحد: صفوف الكشف = رصيد الدالة لكل طرف من الأطراف الستة')

  // ——— أرصدة افتتاحية تُختبر في حالة مستقلة (بالمسار الرسمي setOpeningBalance) ———
  const c2 = await freshCase({ activityId: 'general' })
  const cust1 = addParty(c2, 'customer', 'عميل افتتاحي')
  const sup1 = addParty(c2, 'supplier', 'مورد افتتاحي')
  c2.st().setOpeningBalance({ kind: 'customer', refId: cust1.id, amountMinor: 15000, label: 'مديونية سابقة' })
  c2.st().setOpeningBalance({ kind: 'supplier', refId: sup1.id, amountMinor: 8000, label: 'مستحق سابق' })
  const sumC2 = c2.st().customers.reduce((s, cu) => s + c2.st().getCustomerBalance(cu.id), 0)
  assert.equal(sumC2, bal(c2, '1104'), 'الافتتاحي: Σ كشوف = 1104 منذ أول لحظة')
  const sumS2 = c2.st().suppliers.reduce((s, su) => s + c2.st().getSupplierBalance(su.id), 0)
  assert.equal(sumS2, -bal(c2, '2101'), 'الافتتاحي: Σ كشوف الموردين = −2101')
  const firstRow = c2.st().getCustomerStatementRows(cust1.id)[0]
  assert.equal(firstRow.docLabel, 'رصيد افتتاحي')
  assert.equal(firstRow.balanceMinor, 15000)
  const supFirstRow = c2.st().getSupplierStatementRows(sup1.id)[0]
  assert.equal(supFirstRow.docLabel, 'رصيد افتتاحي')
  assert.equal(supFirstRow.balanceMinor, 8000, 'افتتاحي المورد دائن له بالرصيد الموجب')
  R.ok('① الرصيد الافتتاحي: أول صف في الكشف ويدخل المجموع الكلي فور الترحيل — بالمقارنة المزدوجة (عميل ومورد)')
}

// ——— ② أكواد الأطراف ———
{
  assert.equal(partyCode('CUS', 1), 'CUS-0001')
  assert.equal(partyCode('PAT', 42), 'PAT-0042')
  assert.equal(partyCode('CUS', 0), 'CUS-0000', 'معرف غير صالح ⇒ صفر حشو لا NaN')
  assert.equal(partyCode('SUP', 10000), 'SUP-10000', 'يتمدد بعد 9999 بلا قصّ')
  assert.equal(PARTY_CODE_LABELS.LPT, 'كود المريض', 'مريض المعمل له تسمية عرض')
  // المطابقة الذكية: كامل/بلا أصفار/أرقام مجردة/بلا شرطة/حالة خلط
  assert.ok(matchesPartyCode('PAT-0042', 'PAT', 42) && matchesPartyCode('pat-42', 'PAT', 42) && matchesPartyCode('0042', 'PAT', 42) && matchesPartyCode('42', 'PAT', 42) && matchesPartyCode('PAT42', 'PAT', 42))
  assert.ok(!matchesPartyCode('CUS-42', 'PAT', 42), 'بادئة صنف آخر لا تطابق')
  assert.ok(!matchesPartyCode('142', 'PAT', 42), 'الأرقام المجردة تطابق المعرف بالضبط لا substring')
  assert.ok(!matchesPartyCode('  ', 'PAT', 42), 'فراغ ليس استعلاماً')
  // «PAT-004» تُفهم ككود المعرف 4 لا كبحث جزئي — الأرقام في الكود تطابق المعرف بالضبط
  assert.ok(!matchesPartyCode('PAT-004', 'PAT', 42), 'بادئة الكود بالأرقام = معرف كامل لا بحث جزئي')
  // الفلتر الموحد: الاسم أو الهاتف أو الكود
  const list = [
    { id: 1, nameAr: 'محمد عبده', phone: '01000000001' },
    { id: 42, nameAr: 'سارة أحمد', phone: '01234567890' },
    { id: 142, nameAr: 'محمد عبده سيد', phone: '01111111111' },
  ]
  assert.deepEqual(partySearchFilter(list, 'سارة', 'CUS').map((p) => p.id), [42])
  assert.deepEqual(partySearchFilter(list, '01234567890', 'CUS').map((p) => p.id), [42])
  assert.deepEqual(partySearchFilter(list, 'cus-42', 'CUS').map((p) => p.id), [42], 'الكود أدق من تشابه الأسماء: «محمد عبده» اثنان ولا يظهران')
  assert.deepEqual(partySearchFilter(list, 'محمد عبده', 'CUS').map((p) => p.id).sort(), [1, 142], 'بحث الاسم يستمر كما هو')
  assert.equal(partySearchFilter(list, '', 'CUS').length, 3, 'استعلام فارغ = القائمة كلها')
  R.ok('② أكواد الأطراف: اشتقاق ثابت + تمدد + مطابقة ذكية (42≠142) + فلتر موحد أدق من تشابه الأسماء')
}

// ——— ③ سجل ملاحظات الأطراف ———
{
  assert.equal(normalizePartyNoteText('  مرحى   بالعائد  '), 'مرحى بالعائد')
  assert.equal(normalizePartyNoteText('ي'.repeat(500)).length, PARTY_NOTE_MAX, 'حد أقصى 400 حرف')
  assert.equal(normalizePartyNoteText('سطر\nجديد\tمضغوط'), 'سطر جديد مضغوط', 'لا أسطر جديدة تكسر السجل')
  assert.throws(() => buildPartyNote({ partyKind: 'customer', partyId: 1, text: '   ', userName: 'المالك' }), /ملاحظة فارغة/)
  assert.throws(() => buildPartyNote({ partyKind: 'customer', partyId: 0, text: 'نص', userName: 'المالك' }), /اختر طرفاً/)
  assert.throws(() => buildPartyNote({ partyKind: 'supplier', partyId: 1, text: 'نص', userName: '', at: 'ليس تاريخاً' }), /تاريخ/)
  const n1 = buildPartyNote({ partyKind: 'customer', partyId: 7, text: 'وعد بالسداد الجمعة', userName: 'مبيعات', source: 'INV-12', at: '2026-09-28T12:00:00Z', id: 'n1' })
  const n2 = buildPartyNote({ partyKind: 'customer', partyId: 7, text: 'سدد نصفها', userName: 'مبيعات', at: '2026-09-28T12:00:00Z', id: 'n2' })
  const n3 = buildPartyNote({ partyKind: 'supplier', partyId: 7, text: 'مورد آخر — لا تظهر لعميل', userName: 'مشتريات', at: '2026-09-28T12:00:00Z', id: 'n3' })
  const older = buildPartyNote({ partyKind: 'customer', partyId: 7, text: 'أقدم', userName: 'مالك', at: '2026-09-01T08:00:00Z', id: 'n0' })
  assert.equal(n1.source, 'INV-12')
  assert.ok(n1.id && n2.id && n1.id !== n2.id, 'معرفات فريدة')
  // ترتيب مستقر: الأحدث أولاً، وعند تساوي الطابع يفوز الأحدث إدخالاً
  const for7 = partyNotesFor([older, n1, n2, n3], 'customer', 7)
  assert.deepEqual(for7.map((n) => n.id), ['n2', 'n1', 'n0'], 'n3 مورد فلا يظهر؛ عند تساوي الطابع يفوز الأحدث إدخالاً (n2 قبل n1) ثم الأقدم زمنياً')
  assert.deepEqual(partyNotesFor([n1], 'customer', 8), [], 'طرف آخر لا يرى ملاحظات غيره')
  const stamp = formatPartyNoteStamp('2026-09-28T14:30:00Z')
  // Intl العربي يحقن محارف اتجاه (U+200F) بين المكونات — نجردها قبل النمط
  const stripped = stamp.replace(/\u200f|\u200e/g, '')
  assert.ok(/^[\d٠-٩]{2}\/[\d٠-٩]{2}\/[\d٠-٩]{4} [\d٠-٩]{2}:[\d٠-٩]{2}$/.test(stripped), `ختم عربي مضغوط بالأرقام العربية «${stamp}»`)
  assert.equal(formatPartyNoteStamp('garbage'), '—')
  R.ok('③ سجل ملاحظات الأطراف: تنظيف وحدود ورفض + ترتيب مستقر (الأحدث إدخالاً عند التعادل) + عزلة طرف/صنف')
}

// ——— ④ أعمار الديون ———
{
  const rows = customerStatement({
    customerId: 1,
    openingMinor: 5000,
    sales: [
      { invoiceNumber: 'S-1', date: '2026-06-01', customerId: 1, payment: 'credit', totals: { totalMinor: 100000 } },
      { invoiceNumber: 'S-2', date: '2026-08-01', customerId: 1, payment: 'credit', totals: { totalMinor: 60000 } },
      { invoiceNumber: 'S-3', date: '2026-09-20', customerId: 1, payment: 'credit', totals: { totalMinor: 30000 } },
    ],
    saleReturns: [], allSales: [], vouchers: [
      // سداد 90000 في 2026-09-25: يستهلك FIFO: 100000 يبقى 10000 ثم 60000 يبقى ...
      { voucherNumber: 'RV-1', kind: 'receipt', date: '2026-09-25', partyKind: 'customer', partyId: 1, amountMinor: 90000 },
    ], cheques: [],
  })
  const asOf = '2026-10-01'
  const buckets = agingFromStatement(rows, asOf)
  // افتتاحي 5000 ⇒ +90 · S-1 (122 يوماً) بقيت 10000 ⇒ +90 · S-2 (61 يوماً) بقيت 60000 ⇒ 61-90
  // S-3 (11 يوماً) 30000 ⇒ حالي. المجموع = رصيد الكشف 105000
  assert.equal(buckets.over90Minor, 15000, 'الافتتاحي + أقدم دين في الشريحة الأعمق')
  assert.equal(buckets.d61_90Minor, 60000)
  assert.equal(buckets.d31_60Minor, 0)
  assert.equal(buckets.currentMinor, 30000)
  assert.equal(buckets.totalMinor, statementBalance(rows), 'مجموع الشرائح = رصيد الكشف بالقرش — لا يتناقض الأعمار مع الرصيد')
  assert.equal(statementBalance(rows), 105000, 'افتتاحي 5000 + 100000 + 60000 + 30000 − 90000')
  // السداد لا يُنسب للأقدم إلا بعد استهلاك دائن الفاتورة نفسها (فاتورة نقدية لا تُخصم من دين أقدم)
  const rowsCashSale = customerStatement({
    customerId: 2,
    sales: [{ invoiceNumber: 'S-9', date: '2025-01-01', customerId: 2, payment: 'credit', totals: { totalMinor: 50000 } }],
    saleReturns: [], allSales: [],
    vouchers: [], cheques: [],
  })
  // فاتورة نقدية مسددة بالكامل لا تترك ديناً قائماً
  const rowsPaidCash = customerStatement({
    customerId: 2,
    sales: [{ invoiceNumber: 'S-10', date: '2025-01-01', customerId: 2, payment: 'cash', totals: { totalMinor: 50000 } }],
    saleReturns: [], allSales: [], vouchers: [], cheques: [],
  })
  const bOld = agingFromStatement(rowsCashSale, '2026-10-01')
  const bPaid = agingFromStatement(rowsPaidCash, '2026-10-01')
  assert.equal(bOld.over90Minor, 50000)
  assert.equal(bPaid.totalMinor, 0, 'النقدي المسدد لا يترك ديناً في أي شريحة')
  // كشف المورد يقلب أعمدته قبل محرك الأعمار
  const supRows = supplierStatement({
    supplierId: 3,
    purchases: [{ invoiceNumber: 'P-1', date: '2026-06-01', supplierId: 3, grandTotalMinor: 80000, paidMinor: 0 }],
    purchaseReturns: [], allPurchases: [], vouchers: [], cheques: [],
  })
  const supBuckets = agingFromStatement(supplierRowsForAging(supRows), '2026-10-01')
  assert.equal(supBuckets.over90Minor, 80000, 'دين المورد (دائن بالكشف) يدخل الشريحة الأعمس بعد القلب')
  assert.equal(supBuckets.totalMinor, statementBalance(supRows))
  R.ok('④ أعمار الديون: شرائح 30/60/90 بتخصيص FIFO، والمجموع = رصيد الكشف، والافتتاحي أعمق دائماً، والنقدي لا يترك ديناً')
}

// ——— ⑤ مستندات الأنشطة المتخصصة (مصدر حقيقة واحد مع الكشف) ———
{
  const settled = { 'lab:1': 5000 }
  const docs = openCustomerSpecializedDocuments({
    customerId: 9,
    settledOf: (k) => settled[k] ?? 0,
    labOrders: [{ id: 1, orderNumber: 'LAB-1', date: '2026-07-01', patientId: 71, payment: 'credit', totals: { totalMinor: 20000 } }],
    linkedLabPatientIds: [71],
    tickets: [
      // تذكرة غير مسلّمة: إيراد لم يُعترف به — لا ذمة قبل التسليم (نفس قاعدة الكشف)
      { id: 1, ticketNumber: 'TK-1', customerId: 9, deliveredAt: null, totals: { grandMinor: 70000, paidMinor: 0 } },
      { id: 2, ticketNumber: 'TK-2', customerId: 9, deliveredAt: '2026-07-05', totals: { grandMinor: 90000, paidMinor: 30000 }, refunds: [{ mode: 'customer_credit', amountMinor: 4000 }] },
    ],
    rentals: [{ id: 1, contractNumber: 'RC-1', date: '2026-07-02', customerId: 9, totals: { grandMinor: 50000, collectCreditMinor: 20000 } }],
    trips: [{ id: 1, tripNumber: 'TR-1', date: '2026-07-03', customerId: 9, payment: 'credit', totals: { grandMinor: 15000 } }],
    walletOps: [{ id: 1, opNumber: 'W-1', date: '2026-07-04', customerId: 9, status: 'done', chargeMinor: 8000, paidMinor: 2500 }],
    cars: [{ id: 1, make: 'تويوتا', model: 'كورولا', plateOrVin: 'ABC-123', buyerCustomerId: 9, salePayment: 'credit', salePaidMinor: 10000, saleTotalMinor: 40000, soldAt: '2026-07-06' }],
    propertySales: [{ id: 1, saleNumber: 'PS-1', date: '2026-07-07', buyerCustomerId: 9, dueMinor: 12000 }],
  })
  const map = new Map(docs.map((d) => [d.docKey, d]))
  assert.ok(!map.has('ticket:1'), 'تذكرة قبل التسليم لا تصير ذمة')
  assert.equal(map.get('ticket:2')?.dueMinor, 90000 - 30000 - 4000, 'تذكرة مسلّمة: المتبقي بعد المدفوع ومرتجع الذمم')
  assert.equal(map.get('lab:1')?.dueMinor, 20000)
  assert.equal(map.get('lab:1')?.settledMinor, 5000, 'ما خُصِّص سابقاً يظهر مستقلاً عن المتبقي')
  assert.equal(map.get('rental:1')?.dueMinor, 20000, 'الإيجار: الجزء التحصيلي الآجل فقط')
  assert.equal(map.get('trip:1')?.dueMinor, 15000)
  assert.equal(map.get('wallet:1')?.dueMinor, 5500, 'خدمة محفظة: 8000 − 2500')
  assert.equal(map.get('carsale:1')?.dueMinor, 30000, 'سيارة آجلة بمقدم')
  assert.equal(map.get('propsale:1')?.dueMinor, 12000)
  // عميل آخر لا يرى مستنداته
  const otherDocs = openCustomerSpecializedDocuments({ customerId: 10, settledOf: () => 0, tickets: [{ id: 2, ticketNumber: 'TK-2', customerId: 9, deliveredAt: '2026-07-05', totals: { grandMinor: 90000, paidMinor: 30000 } }] })
  assert.equal(otherDocs.length, 0, 'customerId مختلف = لا مستندات')
  // نفس القاعدة للكشف: تذكرة غير مسلّمة لا تظهر في customerUnitDocs
  const unitDocs = (await import('../src/core/statements.ts')).customerUnitDocs({
    customerId: 9,
    tickets: [
      { ticketNumber: 'TK-1', customerId: 9, deliveredAt: null, totals: { grandMinor: 70000, paidMinor: 0, creditMinor: 0 } },
      { ticketNumber: 'TK-2', customerId: 9, deliveredAt: '2026-07-05', totals: { grandMinor: 90000, paidMinor: 30000, creditMinor: 60000 } },
    ],
  })
  assert.equal(unitDocs.length, 1, 'الكشف كذلك لا يرى غير المسلّمة')
  assert.equal(unitDocs[0].debitMinor - unitDocs[0].creditMinor, 60000, 'والمسلّمة تدخل بالمتخلف فقط (90000−30000)')

  // المورد: فاتورة سيارات + تجهيز + تكلفة مشروع — بلا ازدواج
  const supDocs = openSupplierSpecializedDocuments({
    supplierId: 5,
    settledOf: () => 0,
    carPurchaseInvoices: [{ id: 1, invoiceNumber: 'CPI-1', date: '2026-07-10', supplierId: 5, dueMinor: 95000, carIds: [1, 2] }],
    carPrepCosts: [{ id: 1, carId: 3, date: '2026-07-11', description: 'دهان كامل', supplierId: 5, dueMinor: 7000 }],
    projectCosts: [{ id: 1, date: '2026-07-12', description: 'خرسانة مسلحة', supplierId: 5, dueMinor: 4000 }],
    carLabel: (id) => `سيارة#${id}`,
  })
  assert.deepEqual(supDocs.map((d) => d.docKey), ['carinv:1', 'carprep:1', 'projcost:1'])
  assert.equal(supDocs[0].docLabel.includes('2 سيارة'), true)
  assert.ok(documentKindLabel('carinv:9').length > 0 && documentKindLabel('unknown:x') === 'مستند')
  R.ok('⑤ المستندات المتخصصة: تذكرة قبل التسليم لا ذمة (كالكشف حرفياً)، settledOf مستقل، وحدة العرض صحيحة')
}

// ——— ⑥ حراس الأطراف في المستودع ———
{
  const c = await freshCase({ activityId: 'general' })
  const cust = addParty(c, 'customer', 'عميل محروس')
  const sup = addParty(c, 'supplier', 'مورد محروس')
  const item = addSimpleItem(c, { nameAr: 'سعر الحراسة', priceMinor: 1000 })
  c.st().postPurchase({ supplierId: sup.id, date: '2026-07-01', lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 500, expiryDate: null }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
  c.st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 5, unitPriceMinor: 1000, unitCostMinor: 500, discountPercent: 0, soldByWeight: false }], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101', date: '2026-07-02' })
  expectReject('حذف عميل له رصيد', c, () => c.st().removeCustomer(cust.id), /رصيد/)
  expectReject('حذف مورد له رصيد', c, () => c.st().removeSupplier(sup.id), /رصيد/)
  // عميل نظيف تماماً يُحذف
  const ghost = addParty(c, 'customer', 'عميل وهمي نظيف')
  c.st().removeCustomer(ghost.id)
  assert.ok(!c.st().customers.some((x) => x.id === ghost.id))
  // مكرر: إضافة عميل بنفس الاسم والهاتف
  expectReject('عميل مكرر (اسم+هاتف)', c, () => c.st().addCustomer({ nameAr: 'عميل محروس', phone: cust.phone ?? '' }), /مكرر|مسجل|موجود/)
  // عيب §82 المكتشف بقياس الأثر: التمويل غير النقدي مع دفعة نقدية كان يُقبل ويُصفَّر بصمت —
  // القيمة تختفي (لا خزينة ولا مقدم ولا كشف) والمورد يُحمَّل بكامل التكلفة. الآن رفض صريح.
  expectReject('أصل بتمويل آجل مع دفعة نقدية', c, () => c.st().addAsset({ nameAr: 'ماكينة مستحيلة', costMinor: 50000, salvageMinor: 0, lifeMonths: 12, paidMinor: 20000, notes: '', funding: 'supplier_credit', supplierId: sup.id }), /لا يقبل دفعة نقدية|مقدم/)
  expectReject('أصل بتمويل رأس مال مع دفعة نقدية', c, () => c.st().addAsset({ nameAr: 'أصل مالك', costMinor: 50000, salvageMinor: 0, lifeMonths: 12, paidMinor: 20000, notes: '', funding: 'capital' }), /لا يقبل دفعة نقدية/)
  R.ok('⑥ الحراس: لا حذف لطرف له ذمة، والنظيف يُحذف، والمكرر يُرفض — وعيب §82: لا قيمة تختفي بصمت في اقتناء الأصول (حارس المستودع)')
}

// ——— ⑦ كشف الموظف الشامل: كل أنواع الصفوف في كشف واحد محسوب يدوياً ———
{
  const c = await freshCase({ activityId: 'general' })
  c.st().addEmployee({ nameAr: 'موظف §82', phone: '0100', jobTitle: 'إداري', salaryMinor: 500000, hiredAt: '2026-01-01', notes: '', active: true })
  const emp = c.st().employees.at(-1)
  c.st().grantEmployeeAdvance({ employeeId: emp.id, amountMinor: 90000, treasury: '1101', notes: '' })
  c.st().postPayroll({ month: '2026-09', payMode: 'cash', treasury: '1101', custodyFileId: null, notes: '', lines: [{ employeeId: emp.id, baseMinor: 500000, allowancesMinor: 20000, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 40000 }] })
  c.st().repayEmployeeAdvance({ employeeId: emp.id, amountMinor: 10000, treasury: '1101' })
  const com = c.st().addStaffCommission({ employeeId: emp.id, source: 'sale', sourceId: null, description: 'عمولة بيع §82', amountMinor: 15000 })
  const com2 = c.st().addStaffCommission({ employeeId: emp.id, source: 'sale', sourceId: null, description: 'عمولة مصروفة §82', amountMinor: 8000 })
  c.st().payStaffCommission({ commissionId: com2.id, treasury: '1101' })
  const file = c.st().openCustodyFile({ employeeId: emp.id, projectId: null, reason: 'عهدة مشتريات §82', notes: '' })
  c.st().fundCustodyFile({ fileId: file.id, amountMinor: 30000, treasury: '1101', description: 'تمويل عهدة' })
  c.st().addEmployeeDeduction({ employeeId: emp.id, amountMinor: 5000, reason: 'تأخير §82' })
  const rows = employeeStatement({
    employeeId: emp.id,
    advances: c.st().employeeAdvances,
    payrollRuns: c.st().payrollRuns,
    advanceRepayments: c.st().advanceRepayments,
    commissions: c.st().staffCommissions,
    custodyTransactions: c.st().custodyTxs.map((tx) => ({
      date: tx.date,
      employeeId: c.st().custodyFiles.find((f) => f.id === tx.fileId)?.employeeId ?? -1,
      type: tx.type,
      amountMinor: tx.amountMinor,
      description: tx.description,
    })),
    deductions: c.st().employeeDeductions,
  })
  const labels = rows.map((r) => r.docLabel).join(' | ')
  assert.ok(labels.includes('سلفة'), 'صف السلفة')
  assert.ok(labels.includes('مسير'), 'صف المسير')
  assert.ok(labels.includes('سداد نقدي'), 'صف السداد النقدي')
  assert.ok(labels.includes('عمولة') && labels.includes('مستحقة') && labels.includes('مصروفة'), 'صفا العمولتين')
  assert.ok(labels.includes('عهدة') || labels.includes('تمويل'), 'صف العهدة')
  assert.ok(labels.includes('جزاء'), 'صف الجزاء')
  // الرصيد اليدوي: سلفة 90000 + عهدة 30000 − استقطاع 40000 − سداد نقدي 10000 − عمولة مستحقة 15000
  // (المصروفة مدين ودائن معاً فأثرها صفر، والجزاء صف توثيقي بمبلغ صفري)
  assert.equal(statementBalance(rows), 55000, 'كشف الموظف الشامل = الحساب اليدوي (سلف وعهدة ضد استقطاع وسداد وعمولة)')
  R.ok('⑦ كشف الموظف: السبع صفوف معاً (سلفة/مسير/سداد/عمولتان/عهدة/جزاء) والرصيد = الحساب اليدوي 55000')
}

R.done()
