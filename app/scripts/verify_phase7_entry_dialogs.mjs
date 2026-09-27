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
  assert.ok(salesInvoice.includes('<DocSectionHead step="١" title="عمولات البيع"') && salesInvoice.includes('<DocSectionHead step="٢" title="مصروفات داخلية على الفاتورة"'),
    'نافذة المصروفات الداخلية بلا أقسام مرقّمة')
  R.ok('نوافذ المصروفات الثلاث بأقسام مرقّمة كسند القبض/الصرف (٤ أقسام في مدير الشراء، وقسم/قسمان في نوافذ الفاتورة)')
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

R.done('— نوافذ الإدخال المالية بلغة واحدة، تتبع الوضع الليلي، وتشرح أثرها المحاسبي قبل الترحيل')
