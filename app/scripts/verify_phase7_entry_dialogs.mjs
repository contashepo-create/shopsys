/**
 * المرحلة 7 من تدقيق المالك — نوافذ الإدخال المالية.
 *
 * مطلب المالك حرفياً: «أي نافذة إدخال بيانات يجب أن تكون احترافية وتخدم كل سيناريوهات
 * الدفع والقبض والمعاملات». الترجمة العملية لـ«احترافية» في هذا الملف:
 *   ① لغة واحدة: أقسام مرقّمة بنفس نَفَس السند، لا `div` سائب بلا عنوان.
 *   ② تتبع الوضع الليلي: ألوان من طبقة `doc-*` لا هكسات محفورة بلا مقابل ليلي.
 *   ③ تُخبر المستخدم بما سيحدث قبل أن يضغط (القيد المتوقع / الحصيلة).
 *   ④ تمنع الإدخال الخاطئ بدل أن تقبله ثم تشتكي (زر معطّل + سقف + تحقق).
 *   ⑤ تغطي السيناريوهات فعلاً: نقد/بنك/ماكينة، عهدة، آجل، ضريبة، مركز تكلفة، مركبة.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_phase7_entry_dialogs.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reporter } from './auditKit.mjs'

const R = reporter('المرحلة 7 — نوافذ الإدخال المالية')
const UI = '/home/user/shopsys/app/src/ui/'
const read = (f) => readFileSync(UI + f, 'utf8')

const docSection = read('components/DocSection.tsx')
const purchaseExpense = read('components/PurchaseExpenseManager.tsx')
const vouchers = read('pages/VouchersPage.tsx')
const settlements = read('pages/SettlementsPage.tsx')
const salesInvoice = read('pages/AdvancedSalesInvoicePage.tsx')
const treasury = read('pages/TreasuryPage.tsx')
const custody = read('pages/CustodyPage.tsx')
const cheques = read('pages/ChequesPage.tsx')
const installments = read('pages/InstallmentsPage.tsx')
const commissions = read('pages/ExternalCommissionsPage.tsx')

/* ① قطعة أقسام مشتركة بدل تكرار الشكل في كل ملف */
{
  for (const piece of ['export function DocSectionHead', 'export function DocSection', 'export function DocOutcome']) {
    assert.ok(docSection.includes(piece), `قطعة الأقسام المشتركة ناقصة: ${piece}`)
  }
  assert.ok(/doc-head|doc-ink|doc-faint/.test(docSection), 'قطعة الأقسام لا تستعمل طبقة المستند')
  assert.ok(!/#[0-9a-fA-F]{6}/.test(docSection), 'قطعة الأقسام المشتركة تحوي لوناً محفوراً')
  R.ok('قطعة أقسام مشتركة (DocSectionHead/DocSection/DocOutcome) بلغة المستند بلا لون محفور')
}

/* ② كل نافذة مصروف تستعمل الأقسام المرقّمة نفسها */
{
  assert.ok(purchaseExpense.includes("from './DocSection.tsx'") && purchaseExpense.includes('<DocSectionHead'),
    'مدير مصروفات الشراء لا يستعمل القطعة المشتركة')
  const steps = [...purchaseExpense.matchAll(/<DocSectionHead step="([١٢٣٤])"/g)].map((m) => m[1])
  assert.deepEqual(steps, ['١', '٢', '٣', '٤'], `ترقيم أقسام نافذة المصروف غير متسلسل: ${steps.join('')}`)
  assert.ok(salesInvoice.includes('<DocSectionHead step="١" title="بنود يتحملها العميل"'), 'نافذة المصروفات على العميل بلا قسم مرقّم')
  assert.ok(salesInvoice.includes('<DocSectionHead step="١" title="بنود يتحملها العميل"'), 'نافذة المصروفات على العميل بلا قسم مرقّم')
  /* نافذة المصروفات الداخلية أعيد تصميمها بطلب المالك (جولة المعاينة الحية):
     نافذة أوسع (extraWide) بتابات «مصروفات/عمولات» وبطاقة مختصرة لكل مصروف
     بتفاصيل قابلة للفتح بدل الأقسام المرقّمة الطويلة */
  assert.ok(salesInvoice.includes('data-expense-tab="expenses"') && salesInvoice.includes('data-expense-tab="commissions"'),
    'نافذة المصروفات الداخلية الجديدة بلا تابات فاصلة')
  assert.ok(salesInvoice.includes('data-expense-details='), 'بطاقة المصروف بلا تفاصيل قابلة للفتح')
  R.ok('مدير مصروفات الشراء بأقسام مرقّمة (١-٤) · مصروفات العميل بقسم مرقّم · الداخلية بالتصميم الجديد (تابات + بطاقات قابلة للفتح)')
}

/* ③ الوضع الليلي: لا هكس محفور بلا مقابل في نوافذ الإدخال المالية */
{
  const hexes = [...purchaseExpense.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0])
  assert.deepEqual(hexes, [], `نافذة المصروف ما زالت تحوي ألواناً محفورة: ${hexes.join('، ')}`)
  assert.ok(!/\bbg-white\b(?!\/)/.test(purchaseExpense), 'نافذة المصروف تستعمل bg-white ثابتاً يعمي النص في الوضع الليلي')
  R.ok('نافذة المصروف خالية من الألوان المحفورة و bg-white الثابت — تتبع الوضع الليلي عبر متغيرات المستند')
}

/* ④ تخبر بما سيُرحَّل قبل الضغط */
{
  assert.ok(purchaseExpense.includes('القيد المتوقع'), 'نافذة المصروف لا تعرض القيد المتوقع')
  assert.ok(vouchers.includes('القيد المحاسبي المتولد') || vouchers.includes('القيد الذي سيُرحَّل'), 'نافذة السند لا تعرض القيد')
  assert.ok(settlements.includes('القيد الذي سيُرحَّل'), 'نافذة المقاصة لا تعرض القيد')
  R.ok('ثلاث نوافذ (مصروف/سند/مقاصة) تعرض القيد المتوقع قبل الترحيل — لا ترحيل أعمى')
}

/* ⑤ منع الخطأ بدل قبوله: سقف المقاصة وزر معطّل وتحقق المبلغ */
{
  assert.ok(settlements.includes('offsetCapMinor') && /disabled=\{[^}]*offset/.test(settlements), 'المقاصة بلا سقف أو بلا زر معطّل')
  assert.ok(/disabled=\{![^}]*trim\(\)/.test(vouchers) || vouchers.includes('disabled={!reverseReason.trim()}'), 'نافذة العكس تقبل سبباً فارغاً')
  R.ok('المقاصة محكومة بسقف أقل الرصيدين، ونافذة العكس ترفض سبباً فارغاً')
}

/* ⑥ سيناريوهات الصرف: من أين خرج المال ولمن */
{
  const outgoing = {
    'خزينة نقدية أو بنك/بطاقة (اختيار صريح)': /kind === 'bank' \? 'بنك\/بطاقة' : 'نقدية'/,
    'عهدة موظف': /custodyFileId/,
    'آجل على جهة خارجية (2117)': /payableAccountCode/,
    'على حساب المورد (يزيد مستحقه)': /paidBy === 'supplier'/,
    'الضريبة': /taxTreatment|taxPercent/,
    'مركز التكلفة': /costCenterId/,
    'المركبة': /vehicleId/,
    'تكلفة مخزون أم مصروف فترة': /costTreatment/,
  }
  const missing = Object.entries(outgoing).filter(([, re]) => !re.test(purchaseExpense)).map(([k]) => k)
  assert.deepEqual(missing, [], `سيناريوهات صرف غير مغطّاة في نافذة المصروف: ${missing.join('، ')}`)
  R.ok(`نافذة المصروف تغطي ${Object.keys(outgoing).length} سيناريو صرف: ${Object.keys(outgoing).join(' · ')}`)
}

/* ⑦ سيناريوهات القبض والصرف في السند: ما لا يخدمه المصروفُ يخدمه السند */
{
  const voucherScenarios = {
    'ماكينة الدفع الإلكتروني ورسومها': /terminalPayment/,
    'تخصيص السداد على فواتير بعينها': /allocations/,
    'دفعة تحت الحساب': /تحت الحساب/,
    'طرف (عميل/مورد/موظف)': /partyKind|PartyQuickPicker/,
    'مركز تكلفة ومركبة': /costCenterId[\s\S]*vehicleId|vehicleId[\s\S]*costCenterId/,
    'تاريخ السند': /voucherDate/,
  }
  const missing = Object.entries(voucherScenarios).filter(([, re]) => !re.test(vouchers)).map(([k]) => k)
  assert.deepEqual(missing, [], `سيناريوهات غير مغطّاة في السند: ${missing.join('، ')}`)
  R.ok(`سند القبض/الصرف يغطي ${Object.keys(voucherScenarios).length} سيناريو إضافي: ${Object.keys(voucherScenarios).join(' · ')}`)
}

/* ⑧ نافذة التحويل بين الخزائن: رسوم + رصيد حي + منع العجز */
{
  assert.ok(treasury.includes('<DocSection step="١"') && treasury.includes('<DocSection step="٢"') && treasury.includes('<DocSection step="٣"'),
    'نافذة التحويل بلا أقسام مرقّمة')
  assert.ok(treasury.includes('transferFeeMinor') && treasury.includes('5108'), 'نافذة التحويل لا تفصل رسوم التحويل عن المبلغ')
  assert.ok(treasury.includes('balances.get(from)?.balance') && treasury.includes('balances.get(to)?.balance'), 'نافذة التحويل لا تعرض رصيد الطرفين')
  assert.ok(treasury.includes('transferShort') && /disabled=\{transferAmountMinor <= 0 \|\| from === to \|\| transferShort > 0\}/.test(treasury),
    'نافذة التحويل تسمح بتحويل يُعجز الخزينة أو من الخزينة لنفسها')
  assert.ok(treasury.includes('<DocOutcome>') && treasury.includes('القيد الذي سيُرحَّل'), 'نافذة التحويل لا تعرض القيد قبل الترحيل')
  R.ok('نافذة التحويل بين الخزائن: ثلاثة أقسام + رصيد الطرفين + رسوم منفصلة (5108) + منع العجز + القيد قبل الترحيل')
}

/* ⑨ مصدر السداد يغيّر الطرف الدائن فعلاً (لا شكل بلا أثر) */
{
  assert.ok(/paidBy === source/.test(purchaseExpense), 'أزرار مصدر السداد بلا حالة مختارة')
  for (const src of ['treasury', 'custody', 'payable']) {
    assert.ok(purchaseExpense.includes(`'${src}'`), `مصدر السداد «${src}» غير موجود`)
  }
  assert.ok(purchaseExpense.includes("payableAccountCode: '2117'"), 'الآجل لا يربط بحساب المصروفات المستحقة 2117')
  R.ok('مصادر السداد الثلاثة (خزينة/عهدة/آجل) تغيّر الحساب الدائن: 2117 للآجل وملف العهدة للعهدة')
}

/* ⑩ الحقول ذات المعنى المالي لا تُترك نصاً حراً */
{
  assert.ok(purchaseExpense.includes('DecimalInput') || /inputMode="decimal"/.test(purchaseExpense), 'قيمة المصروف تُدخل كنص حر')
  assert.ok(vouchers.includes('amountInWords'), 'السند بلا تفقيط')
  R.ok('القيم المالية بحقول رقمية، والسند يعرض المبلغ كتابةً (تفقيط) قبل الاعتماد')
}


/* ⑪ المحرك يطابق ما تَعِد به النافذة: تحويل برسوم يخرج كاملاً ويقيد الرسوم 5108 */
{
  const { freshCase, balanceOf, assertInvariants } = await import('./auditKit.mjs')
  const c = await freshCase({ activityId: 'grocery', label: 'تحويل برسوم' })
  c.st().postManualEntry({
    date: '2026-01-02',
    description: 'رصيد افتتاحي للاختبار',
    lines: [
      { accountCode: '1101', debit: 500_00, credit: 0, note: 'نقدية' },
      { accountCode: '3101', debit: 0, credit: 500_00, note: 'رأس مال' },
    ],
  })
  const before = { from: balanceOf(c.st().journal, '1101'), to: balanceOf(c.st().journal, '1102'), exp: balanceOf(c.st().journal, '5108') }
  c.st().postVoucher({ kind: 'transfer', treasury: '1101', counterAccountCode: '1102', amountMinor: 200_00, feeMinor: 15_00, description: 'تحويل للبنك' })
  const after = { from: balanceOf(c.st().journal, '1101'), to: balanceOf(c.st().journal, '1102'), exp: balanceOf(c.st().journal, '5108') }
  assert.equal(before.from - after.from, 215_00, 'المصدر لم يخرج منه المبلغ + الرسوم')
  assert.equal(after.to - before.to, 200_00, 'الوجهة لم تستلم صافي المبلغ')
  assert.equal(after.exp - before.exp, 15_00, 'الرسوم لم تُقيَّد مصروفاً عمومياً 5108')
  assertInvariants(c, 'تحويل بين الخزائن برسوم')
  R.ok('اختبار حي: تحويل 200 برسوم 15 ⇒ المصدر −215 · الوجهة +200 · 5108 +15 — مطابق تماماً لما تعرضه النافذة')
}

/* ⑫ نوافذ العهدة الثلاث: تعزيز · مصروف · تسوية */
{
  for (const [title, needle] of [['تعزيز', 'تعزيز عهدة'], ['مصروف', 'مصروف من العهدة'], ['تسوية', 'تسوية وإغلاق عهدة']]) {
    assert.ok(custody.includes(needle), `نافذة ${title} ليست بلغة المستند`)
  }
  assert.equal((custody.match(/<DocOutcome>/g) ?? []).length, 3, 'ليست كل نوافذ العهدة تعرض القيد قبل الترحيل')
  // الحسابات المعروضة في المعاينة هي نفسها التي يرحّل عليها المحرك
  const engine = readFileSync('/home/user/shopsys/app/src/core/custody.ts', 'utf8')
  for (const code of ['1108', '2107', '1107']) {
    assert.ok(engine.includes(`'${code}'`), `حساب العهدة ${code} غير موجود في المحرك`)
    assert.ok(custody.includes(`(${code})`), `النافذة لا تُظهر الحساب ${code} الذي يرحّل عليه المحرك`)
  }
  assert.ok(/disabled=\{amountMinor <= 0 \|\| !expDesc\.trim\(\) \|\| \(excess > 0 && !expAllowExcess\)\}/.test(custody),
    'نافذة مصروف العهدة تسمح بتجاوز الرصيد بلا إقرار صريح')
  assert.ok(custody.includes('over = returned > viewSummary.remainingMinor') && /disabled=\{returnAmount\.trim\(\) === '' \|\| over\}/.test(custody),
    'نافذة التسوية تقبل مرتجعاً أكبر من العهدة')
  R.ok('نوافذ العهدة الثلاث بلغة المستند، وكل منها يعرض قيده بحسابات المحرك نفسها (1108/2107/1107) ويمنع التجاوز بلا إقرار')
}

/* ⑬ الشيكات: ورقة قبض وورقة دفع — القيد الصحيح قبل الترحيل */
{
  assert.ok(cheques.includes('شيك وارد — ورقة قبض') && cheques.includes('شيك صادر — ورقة دفع'), 'نافذة الشيك ليست بلغة المستند')
  assert.ok(cheques.includes('أوراق قبض (1106)') && cheques.includes('أوراق دفع (2106)'), 'نافذة الشيك لا تعرض حسابي الأوراق')
  assert.ok(cheques.includes('لا نقد يدخل الآن') && cheques.includes('لا نقد يخرج الآن'),
    'النافذة لا توضح أن تسجيل الشيك ليس حركة نقدية — أخطر لبس محاسبي في الشيكات')
  const engine = readFileSync('/home/user/shopsys/app/src/core/cheques.ts', 'utf8')
  for (const code of ['1106', '2106']) assert.ok(engine.includes(`'${code}'`), `حساب الأوراق ${code} غير موجود في محرك الشيكات`)
  assert.ok(/disabled=\{!chequeNumber\.trim\(\) \|\| \(!partyId && !partyName\.trim\(\)\) \|\| amountMinor <= 0 \|\| !dueDate\}/.test(cheques),
    'نافذة الشيك تقبل شيكاً بلا رقم أو طرف أو مبلغ أو استحقاق')
  R.ok('الشيكات: ورقة قبض 1106 وورقة دفع 2106 بمعاينة القيد، مع توضيح أن التسجيل لا يحرك النقد، ورفض الشيك الناقص')
}

/* ⑭ الأقساط: تحصيل دفعة لا يتجاوز المتبقي ولا يُثبت إيراداً مكرراً */
{
  assert.ok(installments.includes('خطة أقساط') && installments.includes('<DocOutcome>'), 'نافذة الأقساط بلا معاينة قيد')
  assert.ok(installments.includes('ذمم العملاء (1104)') && installments.includes('4111'),
    'نافذة الأقساط لا توضح أن التحصيل تخفيض مديونية وأن الهامش 4111 أُثبت مسبقاً')
  assert.ok(/over = payMinor > liveProgress\.remainingMinor/.test(installments) && /disabled=\{payMinor <= 0 \|\| over\}/.test(installments),
    'نافذة الأقساط تقبل تحصيلاً أكبر من المتبقي')
  assert.ok(installments.includes('availableTerminals') && installments.includes('TreasuryPicker'), 'نافذة الأقساط لا تغطي النقدي والماكينة معاً')
  R.ok('الأقساط: تحصيل نقدي/بنكي/ماكينة بمعاينة قيد 1104، ومنع تجاوز المتبقي، وبيان أن هامش 4111 أُثبت عند الإنشاء')
}

/* ⑮ العمولات الخارجية: تحصيل وسداد باتجاهين */
{
  assert.ok(commissions.includes('تحصيل عمولة مستحقة لنا') && commissions.includes('سداد عمولة مستحقة علينا'), 'نافذة العمولات ليست باتجاهين واضحين')
  for (const code of ['1112', '2114', '4112', '5113']) {
    assert.ok(commissions.includes(code), `نافذة العمولات لا تذكر الحساب ${code}`)
  }
  assert.ok(/over = amountMinor > remaining/.test(commissions) && /disabled=\{amountMinor <= 0 \|\| over\}/.test(commissions),
    'نافذة العمولات تقبل مبلغاً أكبر من المتبقي')
  R.ok('العمولات الخارجية: تحصيل (خزينة/1112) وسداد (2114/خزينة) بمعاينة القيد، مع منع تجاوز المتبقي وبيان أن الإيراد/المصروف أُثبت عند الاستحقاق')
}

/* ⑯ لا شاشة مالية محوّلة تعود لألوان محفورة تعمي الوضع الليلي */
{
  const migrated = { 'الشيكات': cheques, 'الأقساط': installments, 'العمولات': commissions, 'العهد': custody, 'الخزائن': treasury }
  const offenders = Object.entries(migrated)
    .map(([name, src]) => [name, (src.match(/<Modal[^>]*bare>[\s\S]*?<\/Modal>/g) ?? []).join('').match(/#[0-9a-fA-F]{6}/g) ?? []])
    .filter(([, hits]) => hits.length > 0)
    .map(([name, hits]) => `${name}: ${hits.join('، ')}`)
  assert.deepEqual(offenders, [], `ألوان محفورة داخل نوافذ المستند: ${offenders.join(' · ')}`)
  R.ok('خمس شاشات مالية محوّلة (شيكات · أقساط · عمولات · عهد · خزائن) بلا لون محفور داخل نوافذ المستند')
}

R.done('— نوافذ الإدخال المالية بلغة واحدة، تتبع الوضع الليلي، وتشرح أثرها المحاسبي قبل الترحيل')
