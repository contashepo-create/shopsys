/**
 * بلاغ المالك على **ترويسة الفاتورة** (2026-09-28، المرحلة ⑩هـ):
 *
 *   ① «صغّر رمز التعديل بجانب اسم العميل».
 *   ② «صغّر حقل المخزن قليلاً» وكذلك «التاريخ والاستحقاق ونمط الفاتورة والمرجع».
 *   ③ «كبّر حقل اسم العميل واليسار قليلاً بحيث يظهر الكلام المكتوب به سطراً بسطر بوضوح».
 *   ④ «انقل المندوب بجانبهم» — أي إلى صف الحقول العلوي لا إلى شريط أسفله.
 *   ⑤ «كبّر حقل الملاحظات ليكون سطراً واضحاً للكتابة».
 *   ⑥ «هذه الملاحظات يجب أن تظهر في تاريخ ملاحظات العميل على صفحته الخاصة
 *      في سجل الملاحظات في بروفايل العملاء».
 *
 * هذه البوابة تمنع رجوع أيٍّ من الستة.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_invoice_header_owner.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reporter } from './auditKit.mjs'

const R = reporter('ترويسة الفاتورة — تعديلات المالك')
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const css = read('src/index.css')
const flat = css.replace(/\s+/g, ' ')
const sale = read('src/ui/pages/AdvancedSalesInvoicePage.tsx')
const purchase = read('src/ui/pages/AdvancedPurchaseInvoicePage.tsx')
const notesLog = read('src/ui/components/PartyNotesLog.tsx')
const core = read('src/core/partyNotes.ts')
const repo = read('src/data/repo.ts')
const statements = read('src/ui/pages/StatementsPage.tsx')
const parties = read('src/ui/pages/PartiesPages.tsx')
const PAGES = [['فاتورة البيع', sale], ['فاتورة الشراء', purchase]]
const ruleOf = (selector) => {
  const at = css.indexOf(`${selector} {`)
  assert.ok(at >= 0, `لا قاعدة CSS للمحدد ${selector}`)
  return css.slice(at, css.indexOf('}', at) + 1)
}

/* ① رمز تعديل الطرف رقاقة صغيرة لا زر عريض */
{
  for (const [label, src] of PAGES) {
    /* قرار المالك ⑩ح: صُغِّر رمز القلم أكثر — 8px داخل رقاقة لا تتجاوز 1.1rem */
    assert.ok(/<Pencil size=\{8\}\/>/.test(src), `${label}: رمز تعديل الطرف ما زال كبيراً — المطلوب 8px`)
    assert.ok(!/<Pencil size=\{(9|1[0-9])\}\/>/.test(src), `${label}: بقي رمز قلم بحجم كبير في المستند`)
  }
  const chip = ruleOf('.invoice-doc .invoice-doc-fields .invoice-pos-edit-party')
  assert.ok(/width: 1\.[0-4]\d*rem/.test(chip), `زر تعديل الطرف ليس رقاقة ضيقة: ${chip}`)
  const smaller = ruleOf('.invoice-doc .invoice-pos-edit-party')
  assert.ok(/width: 1\.0\d*rem/.test(smaller), `رقاقة تعديل الطرف لم تُصغَّر كما طلب المالك: ${smaller}`)
  R.ok('رمز التعديل بجانب اسم الطرف رقاقة 8px أصغر من السابق — لا زر عريض')
}

/* ②③ ميزانية عرض الحقول: الطرف الأعرض · التواريخ والنمط والمرجع والمخزن أضيق · البطاقة أوسع */
{
  const fields = ruleOf('.invoice-doc-fields')
  const cols = fields.match(/grid-template-columns:\s*([^;]+);/)?.[1] ?? ''
  const widths = cols.split(/\s+/).map((token) => Number(token.replace('fr', '')))
  assert.equal(widths.length, 6, `أعمدة الحقول الأساسية ليست ستة: ${cols}`)
  assert.ok(widths[0] >= 1.8, `حقل الطرف لم يكبر — عرضه ${widths[0]}fr والمطلوب ≥1.8fr`)
  for (const index of [1, 2, 4, 5]) {
    assert.ok(widths[index] <= 1, `العمود ${index + 1} (${cols}) لم يصغر — المالك طلب تضييق التاريخ والاستحقاق والنمط والمرجع`)
  }
  assert.ok(widths[3] <= 1.05, `حقل المخزن لم يصغر: ${cols}`)
  // بطاقة الطرف (أقصى اليسار) تبقى ≥13rem على الشاشات المتوسطة حتى يظهر كل مؤشر سطراً كاملاً
  assert.ok(flat.includes('@media (max-width: 1280px) { .invoice-doc .invoice-doc-header-body { grid-template-columns: minmax(0, 1fr) 13rem; } }'),
    'بطاقة الطرف ضاقت دون 13rem عند 1280px — المالك طلب توسيعها')
  const metric = ruleOf('.invoice-doc .invoice-doc-party .invoice-doc-metric')
  assert.ok(/flex-wrap: nowrap/.test(metric), 'مؤشرات بطاقة الطرف تلتفّ بدل سطر واضح لكل مؤشر')
  R.ok('حقل الطرف أعرض · التاريخ والاستحقاق والنمط والمرجع والمخزن أضيق · بطاقة الطرف 13rem بسطر واضح لكل مؤشر')
}

/* ④ المندوب صعد إلى صف الحقول */
{
  assert.ok(/<Field label="المندوب"/.test(sale), 'المندوب ليس حقلاً في صف الترويسة')
  const strip = sale.slice(sale.indexOf('invoice-doc-partymeta'), sale.indexOf('partyProfile='))
  assert.ok(!strip.includes('invoice-doc-stripfield">المندوب'), 'المندوب ما زال في الشريط السفلي للترويسة')
  assert.ok(flat.includes('.invoice-doc-fields:has(> :nth-child(7)) { grid-template-columns:'),
    'لا ميزانية عرض لسبعة حقول — صف الترويسة سينكسر بعد إضافة المندوب')
  R.ok('المندوب انتقل إلى صف الحقول العلوي بميزانية عرض لسبعة حقول')
}

/* ⑤ سطر ملاحظة الطرف: حقل كتابة عريض لا نص للقراءة */
{
  for (const [label, src] of PAGES) {
    assert.ok(src.includes('invoice-doc-noteline'), `${label}: لا سطر ملاحظة قابل للكتابة في الترويسة`)
    assert.ok(!src.includes('invoice-doc-partynote'), `${label}: ما زال سطر الملاحظة نصاً للقراءة فقط`)
    assert.ok(/value=\{partyNote\} onChange=\{e=>setPartyNote\(e\.target\.value\)\}/.test(src), `${label}: سطر الملاحظة غير موصول بحالة الكتابة`)
  }
  const line = ruleOf('.invoice-doc-noteline')
  assert.ok(/flex: 1 1 \d/.test(line) && /min-width: 1[0-9]rem/.test(line), `سطر الملاحظة لا يتمدد ليكون سطر كتابة واضحاً: ${line}`)
  const input = ruleOf('.invoice-doc-noteline > input')
  assert.ok(/flex: 1/.test(input) && /min-height: 1\.[3-9]/.test(input), `مربع الملاحظة ضيق أو قصير: ${input}`)
  R.ok('ملاحظة الطرف صارت سطر كتابة عريضاً داخل الترويسة')
}

/* ⑥ الملاحظة تُقيَّد في سجل ملاحظات الطرف وتظهر في صفحته وبروفايله */
{
  for (const symbol of ['buildPartyNote', 'partyNotesFor', 'formatPartyNoteStamp', 'normalizePartyNoteText']) {
    assert.ok(core.includes(`export function ${symbol}`), `نواة سجل الملاحظات بلا ${symbol}`)
  }
  assert.ok(/partyId <= 0\) throw new Error/.test(core), 'السجل يقبل ملاحظة بلا طرف مسجَّل')
  assert.ok(repo.includes('partyNotes: PartyNote[]') && repo.includes('addPartyNote:') && repo.includes('deletePartyNote:'),
    'طبقة البيانات بلا سجل ملاحظات محفوظ')
  assert.ok(sale.includes("addPartyNote({partyKind:'customer'") && purchase.includes("addPartyNote({partyKind:'supplier'"),
    'الفاتورة لا تقيّد الملاحظة في سجل الطرف')
  for (const [label, src] of PAGES) {
    assert.ok(/commitPartyNote\((sale|p)\.invoiceNumber\)/.test(src), `${label}: الملاحظة لا تُحفظ برقم الفاتورة عند الترحيل`)
  }
  assert.ok(notesLog.includes('سجل الملاحظات —') && notesLog.includes('formatPartyNoteStamp'),
    'مكوّن السجل لا يعرض تاريخ كل ملاحظة')
  assert.ok(statements.includes('<PartyNotesLog'), 'صفحة الطرف (كشف الحساب) بلا سجل ملاحظات')
  assert.ok(/<PartyNotesLog kind="customer"/.test(parties) && /<PartyNotesLog kind="supplier"/.test(parties),
    'بروفايل العميل/المورد في سجل الأطراف بلا سجل ملاحظات')
  R.ok('كل ملاحظة تُكتب في الفاتورة تظهر بتاريخها وكاتبها ورقم فاتورتها في صفحة الطرف وبروفايله')
}

R.done()
