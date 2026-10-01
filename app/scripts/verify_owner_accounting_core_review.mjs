/**
 * جولة المالك — مراجعة نواة المحاسبة والقيود ملفاً ملفاً (§70-هـ — أول نطاق P0).
 * تحرس العيبين المكتشفين بالقراءة الدقيقة + ثوابت النطاق الثمانية حية:
 *   1) money.normalizeDigits: «1,234,567» بفواصل آلاف إنجليزية متعددة كانت تُرفض
 *      خطأً «مدخل غير رقمي» (كل الفواصل كانت تتحول نقاطاً).
 *   2) statements.customerUnitDocs: مستخلص المقاولات باسترداد دفعة مقدمة كان يخصم
 *      الاسترداد مرتين (من المدين ودائناً) فينفصل الكشف عن دفتر 1104 بمقداره —
 *      في الحالة النقدية يظهر رصيد دائن وهمي للعميل.
 * تشغيل: node --experimental-strip-types scripts/verify_owner_accounting_core_review.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const read = (p) => readFileSync(here + p, 'utf8')

/* ─── ① النواة الصرفة: محرك النقود — فاصلة الآلاف المتعددة كانت تُرفض ─── */
console.log('① محرك النقود: فواصل الآلاف والفواصل العشرية')
{
  const { toMinor, splitInclusiveTax, addExclusiveTax, mulQty, percentOf } = await import('../src/core/money.ts')
  assert.equal(toMinor('1,234,567', 2), 123456700, 'فواصل آلاف متعددة بلا نقطة يجب أن تُقبل كمليون ومئتين')
  assert.equal(toMinor('1,234,567.50', 2), 123456750, 'فواصل آلاف مع فاصلة عشرية')
  assert.equal(toMinor('١,٢٣٤,٥٦٧', 2), 123456700, 'أرقام عربية-هندية بفواصل آلاف متعددة')
  assert.equal(toMinor('1.234.567,89', 2), 123456789, 'الصيغة الأوروبية (نقاط آلاف وفاصلة عشرية)')
  assert.equal(toMinor('1,5', 2), 150, 'الفاصلة الوحيدة تبقى فاصلة عشرية عربية (سلوك مُوثق لا يُكسر)')
  assert.equal(toMinor('5,000.50', 2), 500050, 'فواصل آلاف قبل نقطة عشرية')
  /* الضريبة الشاملة ثم المضافة: لا قرش يضيع ذهاباً وإياباً */
  const [base, tax] = splitInclusiveTax(114000, 14)
  assert.equal(base + tax, 114000, 'المجموع بعد الفصل = المبلغ الشامل تماماً')
  const [t2, total2] = addExclusiveTax(base, 14)
  assert.equal(total2, 114000, 'إعادة الإضافة تعيد نفس المبلغ')
  assert.equal(mulQty(999, 3), 2997)
  assert.equal(percentOf(1005, 10), 101, 'تقريب نصفي: 100.5 ← 101')
  console.log('  ✓ فواصل الآلاف المتعددة/الأوروبية/العربية + فاصلة عربية وحيدة + ضريبة بلا فقد قرش')
}

/* ─── ② النواة الصرفة: القيد وحارسه وتوزيع مراكز التكلفة ─── */
console.log('② محرك القيد: توازن وحراسة وتوزيع')
{
  const { assertBalanced, buildReversalLines, allocateJournalLine, UnbalancedEntryError } = await import('../src/core/ledger.ts')
  const { validateEntry, assertJournalIntegrity } = await import('../src/core/ledgerGuard.ts')
  assert.throws(() => assertBalanced([{ accountCode: '1101', debit: 100, credit: 0 }]), /طرفين/, 'سطر واحد مرفوض')
  assert.throws(() => assertBalanced([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 90 }]), UnbalancedEntryError)
  assert.throws(() => assertBalanced([{ accountCode: '1101', debit: -5, credit: 0 }, { accountCode: '4101', debit: 0, credit: -5 }]), /سالب/)
  assert.throws(() => assertBalanced([{ accountCode: '1101', debit: 10, credit: 10 }, { accountCode: '4101', debit: 0, credit: 0 }]), /معاً/)
  /* العكس ينقل الطرف ومركز التكلفة (AUDIT-011) */
  const rev = buildReversalLines([{ accountCode: '1104', debit: 500, credit: 0, partyKind: 'customer', partyId: 7, costCenterId: 3 }])
  assert.equal(rev[0].credit, 500)
  assert.equal(rev[0].partyKind, 'customer')
  assert.equal(rev[0].partyId, 7)
  assert.equal(rev[0].costCenterId, 3)
  /* التوزيع بالباقي الأكبر: 100 على [1,1,1] = 34+33+33 بلا فقد */
  const alloc = allocateJournalLine({ accountCode: '5108', debit: 100, credit: 0 }, [{ costCenterId: 1, weight: 1 }, { costCenterId: 2, weight: 1 }, { costCenterId: 3, weight: 1 }])
  assert.equal(alloc.reduce((s, l) => s + l.debit, 0), 100)
  assert.deepEqual(alloc.map((l) => l.debit).sort((a, b) => b - a), [34, 33, 33])
  const alloc2 = allocateJournalLine({ accountCode: '5108', debit: 0, credit: 1000 }, [{ costCenterId: 1, weight: 1 }, { costCenterId: 2, weight: 2 }, { costCenterId: 3, weight: 7 }])
  assert.equal(alloc2.reduce((s, l) => s + l.credit, 0), 1000)
  /* الحارس: سنة مقفلة تمنع إلا قيد الإقفال، وتعديل السطور مرفوض، والرقم المكرر مرفوض */
  const coa = [{ code: '1101', nameAr: 'خزينة', rootType: 'assets', parentCode: '11', isPostable: true }, { code: '11', nameAr: 'متداولة', rootType: 'assets', parentCode: '1', isPostable: false }]
  const mk = (id, num, lines, date = '2026-01-05') => ({ id, entryNumber: num, date, description: '', sourceType: 'manual', sourceId: null, lines, createdBy: 'x', createdAt: '2026-01-05T00:00:00Z', reversedByEntryId: null, reversesEntryId: null })
  const good = mk(1, 1, [{ accountCode: '1101', debit: 50, credit: 0 }, { accountCode: '1101', debit: 0, credit: 50 }])
  assert.equal(validateEntry(good, { coa, fiscalYears: [{ nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'closed' }] }).length, 0)
  const inClosed = mk(2, 2, good.lines, '2025-06-01')
  assert.ok(validateEntry(inClosed, { coa, fiscalYears: [{ nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'closed' }] }).some((e) => e.includes('مقفلة')), 'تاريخ داخل سنة مقفلة يُرفض')
  const closing = { ...inClosed, sourceType: 'year_closing' }
  assert.equal(validateEntry(closing, { coa, fiscalYears: [{ nameAr: '2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'closed' }] }).length, 0, 'قيد الإقفال نفسه معفى')
  const edited = mk(1, 1, [{ accountCode: '1101', debit: 60, credit: 0 }, { accountCode: '1101', debit: 0, credit: 60 }])
  assert.throws(() => assertJournalIntegrity([good], [edited], { coa }), /تعديل صامت/, 'ث9')
  const dup = mk(9, 1, good.lines)
  assert.throws(() => assertJournalIntegrity([], [good, dup], { coa }), /مكرر/, 'ث4')
  console.log('  ✓ توازن/سالب/مزدوج + عكس ينقل الطرف والمركز + توزيع بلا فقد + حارس السنة المقفلة وث9 وث4')
}

/* ─── ③ حياً: المستخلص باسترداد دفعة مقدمة — الكشف = الدفتر ─── */
console.log('③ كشف العميل مقابل دفتر 1104: استرداد الدفعة المقدمة')
{
  const mem = new Map()
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
  globalThis.window = globalThis
  const { useDataStore, EMPTY_EXTENDED } = await import('../src/data/repo.ts')
  const S = () => useDataStore.getState()
  const bal1104 = () => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === '1104') v += l.debit - l.credit; return v }

  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل المقاولات', phone: '0100', creditLimitMinor: 0, notes: '' })
  const cust = S().customers.at(-1)
  const proj = S().addProject({ nameAr: 'برج المراجعة', clientName: 'عميل المقاولات', clientId: cust.id, contractValueMinor: 10_000_000, retentionPercent: 10, startDate: '2026-09-01', notes: '' })

  /* دفعة مقدمة مليون على البنك: التزام 2109 — لا تظهر في كشف العميل أصلاً */
  S().receiveClientAdvance({ projectId: proj.id, amountMinor: 1_000_000, treasury: '1102' })
  assert.equal(bal1104(), 0, 'الدفعة المقدمة ليست ذمة على العميل (1104 صفر)')
  assert.equal(S().getCustomerBalance(cust.id), 0, 'ولا تظهر في كشفه')

  /* مستخلص آجل 3م + ضريبة 14٪ − محتجز 10٪ = مستحق 3.12م، استرداد 600 ألف */
  S().addProjectExtract({ projectId: proj.id, grossMinor: 3_000_000, vatPercent: 14, payment: 'credit', description: 'الهيكل', advanceRecoveryMinor: 600_000 })
  const due1 = 3_120_000
  assert.equal(bal1104(), due1 - 600_000, 'الدفتر: 1104 بالمستحق ناقص الاسترداد')
  assert.equal(S().getCustomerBalance(cust.id), due1 - 600_000, 'الكشف يجب أن يطابق الدفتر (كان ينقص الاسترداد مرتين)')
  const row1 = S().getCustomerStatementRows(cust.id).find((r) => r.docLabel.includes('مستخلص'))
  assert.equal(row1.debitMinor, due1, 'سطر المستخلص مدين بالمستحق الكامل')
  assert.equal(row1.creditMinor, 600_000, 'ودائن بالاسترداد فقط (الصافي = netDue)')

  /* مستخلص نقدي 1م بلا ضرائب (محتجز المشروع 10٪ ⇒ مستحق 900 ألف)، استرداد باقي
     الدفعة 400 ألف: صافي نقدي 500 ألف — 1104 لا يتحرك إطلاقاً */
  S().addProjectExtract({ projectId: proj.id, grossMinor: 1_000_000, vatPercent: 0, payment: 'cash', treasury: '1102', description: 'تشطيبات', advanceRecoveryMinor: 400_000 })
  assert.equal(bal1104(), due1 - 600_000, 'المستخلص النقدي لا يلمس 1104')
  assert.equal(S().getCustomerBalance(cust.id), due1 - 600_000, 'ورصيد الكشف لا يتغير (كان يظهر دائناً وهمياً بـ400 ألف)')
  const row2 = S().getCustomerStatementRows(cust.id).filter((r) => r.docLabel.includes('مستخلص')).at(-1)
  assert.equal(row2.debitMinor, 900_000, 'مدين بالمستحق بعد المحتجز')
  assert.equal(row2.creditMinor, 900_000, 'نقدي: الاسترداد 400 + النقد 500 = المستحق كاملاً')
  assert.equal(row2.debitMinor - row2.creditMinor, 0, 'صافي السطر صفر')
  /* الدفعة المقدمة استُردت بالكامل: 2109 صفر */
  let bal2109 = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === '2109') bal2109 += l.debit - l.credit
  assert.equal(bal2109, 0)
  /* أعمار الديون من نفس الصفوف: المجموع = الرصيد (لا تناقض) */
  const { agingFromStatement } = await import('../src/core/statements.ts')
  const aging = agingFromStatement(S().getCustomerStatementRows(cust.id), '2026-10-02')
  assert.equal(aging.totalMinor, due1 - 600_000, 'أعمار الديون مجموعها = رصيد الكشف')
  console.log(`  ✓ آجل: كشف=دفتر=${(due1 - 600_000) / 100}ج · نقدي: صافٍ صفر · 2109 استُرد كاملاً · الأعمار متسقة`)
}

/* ─── ④ مصدرية خفيفة: النطاق الثمانية بأماكنها ─── */
console.log('④ مصدرية النطاق')
{
  const files = ['money.ts', 'ledger.ts', 'ledgerGuard.ts', 'fiscal.ts', 'openingBalances.ts', 'statements.ts', 'coaVisibility.ts', 'customAccounts.ts']
  for (const f of files) {
    const src = read(`../src/core/${f}`)
    assert.ok(src.length > 500, `${f} موجود`)
  }
  assert.ok(read('../src/core/money.ts').includes('فواصل متعددة بلا نقطة'), 'تعليق إصلاح فواصل الآلاف')
  assert.ok(read('../src/core/statements.ts').includes('debitMinor: ex.totals.dueMinor'), 'إصلاح مدين المستخلص بالمستحق الكامل')
  console.log(`  ✓ الملفات الثمانية موجودة والإصلاحان موثقان في مكانهما`)
}

/* ─── ⑤ مراجعة §75: تعزيزات الإدخال والحارس والشجرة ─── */
console.log('⑤ تعزيزات §75: فاصلة واعية بالخانات + حروف JS مرفوضة + تواريخ حارس + يتامى الشجرة')
{
  const { toMinor } = await import('../src/core/money.ts')
  /* الفاصلة الوحيدة تحسمها خانات العملة: مجموعة ثلاثية = آلاف (كانت تصير 1.50 بألف ضعف الخطأ) */
  assert.equal(toMinor('1,5', 2), 150, 'فاصلة عشرية عربية (سلوك مُوثق لا يُكسر)')
  assert.equal(toMinor('1,50', 2), 150)
  assert.equal(toMinor('1,500', 2), 150000, 'مجموعة ثلاثية = فاصل آلاف إنجليزي')
  assert.equal(toMinor('1,500', 3), 1500, 'عملة 3 خانات: الفاصلة العشرية العربية تبقى داخل الكسور')
  assert.equal(toMinor('1,234,567,89', 2), 123456789, 'أوروبية: الأخيرة عشرية والباقي آلاف')
  assert.equal(toMinor('1.234.567,89', 2), 123456789)
  assert.equal(toMinor('+5.50', 2), 550, 'إشارة موجبة مقبولة')
  for (const bad of ['0x10', '0b101', '1_000', '5%', 'abc']) {
    assert.throws(() => toMinor(bad, 2), /غير رقمي/, `${bad} يجب أن يُرفض — حروف JS كانت تُقرأ بصمت`)
  }

  const { validateEntry, assertJournalIntegrity } = await import('../src/core/ledgerGuard.ts')
  const coa = [{ code: '1101', nameAr: 'خزينة', rootType: 'assets', parentCode: '11', isPostable: true }, { code: '4101', nameAr: 'مبيعات', rootType: 'revenue', parentCode: '4', isPostable: true }]
  const mk = (id, num, date, lines, description = 'قيد') => ({ id, entryNumber: num, date, description, sourceType: 'manual', sourceId: null, lines, createdBy: 'x', createdAt: '2026-01-05T00:00:00Z', reversedByEntryId: null, reversesEntryId: null })
  const ok2 = [{ accountCode: '1101', debit: 50, credit: 0 }, { accountCode: '4101', debit: 0, credit: 50 }]
  /* تاريخ غير موجود تقويمياً: 2026-02-30 كان يجتاز الاختبار النصي ويتدحرج لمارس */
  assert.ok(validateEntry(mk(1, 1, '2026-02-30', ok2), { coa }).some((e) => e.includes('التقويم')), '2026-02-30 مرفوض')
  assert.ok(validateEntry(mk(1, 1, '2026-13-01', ok2), { coa }).some((e) => e.includes('التقويم') || e.includes('غير صالح')), 'شهر 13 مرفوض')
  assert.equal(validateEntry(mk(1, 1, '2024-02-29', ok2), { coa }).length, 0, '29 فبراير في سنة كبيسة مقبول')
  /* ث9-ممتد: تحريك تاريخ قيد مرحّل أو تغيير وصفه مرفوض — والتطبيع ISO متسامح */
  const posted = mk(1, 1, '2026-01-05', ok2, 'وصف أصلي')
  const movedDate = mk(1, 1, '2026-03-05', ok2, 'وصف أصلي')
  assert.throws(() => assertJournalIntegrity([posted], [movedDate], { coa }), /تاريخ/, 'تحريك التاريخ بين الفترات مرفوض')
  const changedDesc = mk(1, 1, '2026-01-05', ok2, 'وصف محرر')
  assert.throws(() => assertJournalIntegrity([posted], [changedDesc], { coa }), /وصف|مصدر/, 'تحرير الوصف مرفوض')
  const isoPosted = mk(1, 1, '2026-01-05T09:00:00.000Z', ok2, 'وصف أصلي')
  assert.doesNotThrow(() => assertJournalIntegrity([isoPosted], [posted], { coa }), 'تطبيع ISO إلى YYYY-MM-DD متسامح (يحدث داخل غلاف set)')
  const linked = { ...posted, reversedByEntryId: 9 }
  assert.doesNotThrow(() => assertJournalIntegrity([posted], [linked], { coa }), 'ربط العكس reversedByEntryId مسموح')

  /* يتامى الشجرة: سلسلة مجموعات بلا أوراق تختفي كلها (كانت تبقى معلقة بمرور واحد) */
  const { coaForModules } = await import('../src/core/coaVisibility.ts')
  /* شجرة اصطناعية: سلسلة 4 ← 41 ← 4106 (تخصصي معمل في خريطة الوحدات) */
  const tree = [
    { code: '1', nameAr: 'أصول', rootType: 'assets', parentCode: null, isPostable: false },
    { code: '11', nameAr: 'متداولة', rootType: 'assets', parentCode: '1', isPostable: false },
    { code: '1101', nameAr: 'خزينة', rootType: 'assets', parentCode: '11', isPostable: true },
    { code: '4', nameAr: 'إيرادات', rootType: 'revenue', parentCode: null, isPostable: false },
    { code: '41', nameAr: 'مجموعة تخصصية', rootType: 'revenue', parentCode: '4', isPostable: false },
    { code: '4106', nameAr: 'إيرادات تحاليل طبية', rootType: 'revenue', parentCode: '41', isPostable: true },
  ]
  const codesNoModules = coaForModules(tree, ['pos']).map((a) => a.code)
  assert.ok(!codesNoModules.includes('4106'), 'الحساب التخصصي مخفي بلا وحدته')
  assert.ok(!codesNoModules.includes('41'), 'أبوه المجموعة يختفي معه')
  assert.ok(!codesNoModules.includes('4'), 'وسلسلة الأيتام كلها تختفي حتى نقطة الثبات')
  assert.ok(codesNoModules.includes('1101') && codesNoModules.includes('11') && codesNoModules.includes('1'), 'الفروع العامة تبقى')
  const codesUsed = coaForModules(tree, ['pos'], new Set(['4106'])).map((a) => a.code)
  assert.ok(codesUsed.includes('4106') && codesUsed.includes('41') && codesUsed.includes('4'), 'صمام الأمان: حساب عليه حركة يبقى بسلسلته')
  console.log('  ✓ فاصلة/خانات + حروف JS + تقويم + ث9-ممتد بتسامح ISO + يتامى الشجرة حتى الثبات')
}

/* ─── ⑥ §76: برهان بالممتلكات — ثوابت النواة بآلاف الحالات لا بحالات مختارة ─── */
console.log('⑥ برهان بالممتلكات: شجرة/ذهاب-إياب/ضريبة/توازن/حارس/توزيع/إقفال/أعمار')
{
  let seed = 20261002
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))

  const { toMinor, formatMinor, splitInclusiveTax, mulQty } = await import('../src/core/money.ts')
  const { STANDARD_COA, assertBalanced, allocateJournalLine } = await import('../src/core/ledger.ts')
  const { validateEntry, assertJournalIntegrity } = await import('../src/core/ledgerGuard.ts')
  const { buildYearClosingLines, buildFiscalYearReport } = await import('../src/core/fiscal.ts')
  const { agingFromStatement, employeeStatement } = await import('../src/core/statements.ts')

  /* شجرة الحسابات: أبوة/طبيعة/مفاتيح فريدة/بادئات */
  const codes = new Set(STANDARD_COA.map((a) => a.code))
  const sysKeys = new Set()
  for (const a of STANDARD_COA) {
    assert.ok(a.parentCode === null || codes.has(a.parentCode), `أب مفقود ${a.code}`)
    if (a.parentCode) assert.equal(a.rootType, STANDARD_COA.find((x) => x.code === a.parentCode).rootType, `طبيعة ${a.code}`)
    if (a.systemKey) { assert.ok(!sysKeys.has(a.systemKey), `مفتاح مكرر ${a.systemKey}`); sysKeys.add(a.systemKey); assert.ok(a.isPostable) }
    const rootDigit = { assets: '1', liabilities: '2', equity: '3', revenue: '4', expenses: '5' }[a.rootType]
    if (a.code.length >= 2) assert.equal(a.code[0], rootDigit, `بادئة ${a.code}`)
  }
  assert.equal(sysKeys.size, 69, "عدد مفاتيح النظام — 69 حساباً نظامياً")

  /* ذهاب/إياب بكل الخانات وحدودها */
  const cfgs = { 0: { code: 'IQD', symbol: 'د.ع', decimals: 0, name: 'د' }, 2: { code: 'EGP', symbol: 'ج.م', decimals: 2, name: 'ج' }, 3: { code: 'KWD', symbol: 'د.ك', decimals: 3, name: 'د' } }
  for (const d of [0, 2, 3]) {
    for (const v of [0, 1, 99, 12345, 999999999, Number.MAX_SAFE_INTEGER]) {
      for (let signed of [v, -v]) {
        if (signed === 0) signed = 0
        assert.equal(toMinor(formatMinor(signed, cfgs[d], false), d), signed, `ذهاب/إياب ${signed}`)
      }
    }
    for (let i = 0; i < 150; i++) {
      const v = ri(0, 99999999) * 10 ** d + ri(0, 10 ** d - 1)
      assert.equal(toMinor(formatMinor(v, cfgs[d], false), d), v)
      assert.equal(toMinor(formatMinor(-v, cfgs[d], false), d), -v)
    }
  }
  /* الضريبة الشاملة لا تفقد قرشاً */
  for (let p = 0; p <= 100; p += 5) for (let i = 0; i < 60; i++) {
    const gross = ri(1, 500000000)
    const [base, tax] = splitInclusiveTax(gross, p)
    assert.equal(base + tax, gross, `ضريبة ${gross}@${p}`)
  }
  assert.equal(mulQty(1001, 0.5), 501, 'نصف صاعد: 500.5 → 501')

  /* التوازن بالممتلكات: صحيح يقبل، وكل عبث يُرفض */
  for (let i = 0; i < 250; i++) {
    const n = ri(2, 6)
    const lines = []
    let credit = 0
    for (let k = 0; k < n - 1; k++) { const t = k === 0 ? ri(1, 10 ** 7) : ri(0, 10 ** 7); lines.push({ accountCode: '1101', debit: t, credit: 0 }); credit += t }
    lines.push({ accountCode: '4101', debit: 0, credit })
    assertBalanced(lines)
    const bad = lines.map((l) => ({ ...l }))
    bad[0].debit += 1
    assert.throws(() => assertBalanced(bad))
  }
  /* الحارس: كل طفرة تُكتشف */
  const coa = [{ code: '1101', nameAr: 'خزينة', rootType: 'assets', parentCode: '11', isPostable: true }, { code: '4101', nameAr: 'مبيعات', rootType: 'revenue', parentCode: '4', isPostable: true }]
  const mk = (over = {}) => ({ id: 1, entryNumber: 1, date: '2026-06-15', description: 'قيد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdBy: 'x', createdAt: '', reversedByEntryId: null, reversesEntryId: null, ...over })
  for (let i = 0; i < 250; i++) {
    assert.equal(validateEntry(mk(), { coa }).length, 0)
    const pick = ri(0, 5)
    const bad = mk()
    if (pick === 0) bad.lines = [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 99 }]
    else if (pick === 1) bad.lines[0].accountCode = '9999'
    else if (pick === 2) bad.date = '2026-02-30'
    else if (pick === 3) bad.lines[0].debit = 100.5
    else if (pick === 4) bad.sourceType = ''
    else bad.lines[0].debit = -100
    assert.notEqual(validateEntry(bad, { coa }).length, 0, `طفرة ${pick}`)
  }
  /* التوزيع: المجموع محفوظ */
  for (let i = 0; i < 200; i++) {
    const amount = ri(1, 10 ** 6)
    const weights = Array.from({ length: ri(1, 6) }, () => ri(1, 500))
    const alloc = allocateJournalLine({ accountCode: '5108', debit: amount, credit: 0 }, weights.map((w, idx) => ({ costCenterId: idx + 1, weight: w })))
    assert.equal(alloc.reduce((sum, l) => sum + l.debit, 0), amount)
  }
  /* الإقفال والتقرير: تصفير تام وتراكمية صحيحة */
  for (let t = 0; t < 40; t++) {
    const journal = []
    let rev = 0, exp = 0
    for (let i = 0; i < ri(2, 20); i++) {
      const isRev = rnd() < 0.5
      const amt = ri(1, 10 ** 6)
      const date = `2026-${String(ri(1, 12)).padStart(2, '0')}-${String(ri(1, 28)).padStart(2, '0')}`
      journal.push({ date, lines: [{ accountCode: isRev ? '4101' : '5101', debit: isRev ? 0 : amt, credit: isRev ? amt : 0 }, { accountCode: '1101', debit: isRev ? amt : 0, credit: isRev ? 0 : amt }] })
      if (isRev) rev += amt; else exp += amt
    }
    const fy = { startDate: '2026-01-01', endDate: '2026-12-31', nameAr: '2026' }
    const closing = buildYearClosingLines(journal, fy)
    assert.equal(closing.lines.reduce((sum, l) => sum + l.debit, 0), closing.lines.reduce((sum, l) => sum + l.credit, 0), 'إقفال متوازن')
    assert.equal(closing.totalRevenueMinor, rev)
    assert.equal(closing.totalExpenseMinor, exp)
    const rep = buildFiscalYearReport([...journal, { id: 999, date: '2026-12-31', lines: closing.lines.map((l) => ({ accountCode: l.accountCode, debit: l.debit, credit: l.credit })) }], fy, [999])
    assert.equal(rep.totalRevenueMinor, rev, 'التقرير لا يحسب قيد الإقفال')
    for (const row of rep.rows) assert.equal(row.closingMinor, row.openingMinor + row.movementMinor)
  }
  /* الأعمار: المجموع = القائم */
  for (let t = 0; t < 250; t++) {
    const rows = []
    for (let i = 0; i < ri(1, 12); i++) rows.push({ date: `2026-${String(ri(1, 12)).padStart(2, '0')}-${String(ri(1, 28)).padStart(2, '0')}`, docLabel: '', debitMinor: rnd() < 0.6 ? ri(1, 99999) : 0, creditMinor: rnd() < 0.5 ? ri(1, 99999) : 0, balanceMinor: 0 })
    const aging = agingFromStatement(rows, '2026-10-02')
    const net = rows.reduce((sum, r) => sum + r.debitMinor - r.creditMinor, 0)
    assert.equal(aging.totalMinor, Math.max(net, 0), 'الأعمار = القائم')
    assert.equal(aging.currentMinor + aging.d31_60Minor + aging.d61_90Minor + aging.over90Minor, aging.totalMinor)
  }
  /* §76: بيانان المسير لا يعرضان خام الوحدة الصغرى (كان «إجمالي 300000») */
  const empRows = employeeStatement({
    employeeId: 1,
    advances: [],
    payrollRuns: [{ runNumber: 'PR-0001', date: '2026-09-30', lines: [{ employeeId: 1, baseMinor: 300000, allowancesMinor: 0, overtimeMinor: 0, advancesMinor: 50000, deductionsMinor: 0, grossMinor: 300000, netMinor: 250000 }] }],
  })
  assert.equal(empRows[0].docLabel, 'مسير PR-0001', 'بيان المسير بلا أرقام خام')
  assert.equal(empRows[0].operationMinor, 300000, 'الإجمالي في عموده المنسق')
  assert.equal(empRows[0].creditMinor, 50000, 'أثر استقطاع السلفة')
  console.log('  ✓ ~4,000 حالة عشوائية + شجرة كاملة + بيان المسير نظيف — الثوابت برهانية')
}

console.log('✅ جولة المالك — مراجعة نواة المحاسبة والقيود: 6 فحوص ناجحة')
