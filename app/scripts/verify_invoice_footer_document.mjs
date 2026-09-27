/**
 * بلاغ المالك (2026-09-28) على مستند الفاتورة — ثلاث ملاحظات:
 *
 *   ① «المساحة التي بالأعلى كبيرة — أقصد رأس الفاتورة».
 *      كان الرأس ثلاث طبقات متراكمة: شريط علوي + شريط بطاقة يحمل الجلسة والاتصال
 *      (وهما مكرَّران أصلاً في شريط الإجراءات السفلي) + شبكة حقول محشورة في عمود
 *      بعرض 60٪ لأن بطاقة الطرف كانت تحتل عموداً جانبياً بعرض 20rem، فتتكدس
 *      الحقول في ثلاثة أسطر بلا داعٍ.
 *
 *   ② «لماذا لا نستغل المساحة بجانب اسم العميل لنعلم إن كان نشطاً أم لا؟»
 *      كانت «حالة الحساب» خانة مستقلة في المؤشرات، والمساحة بجوار الاسم فارغة.
 *
 *   ③ «لماذا لم تُعد تصميم الإجماليات والتحصيل والشروط كما أرسلتها؟»
 *      اللوحات الثلاث بقيت بالشكل القديم: بطاقات `rounded-2xl border-2` بتدرّجات
 *      `from-brand-500/10` وشارات `bg-emerald-500/10` — لغة مختلفة تماماً عن
 *      بقية المستند الذي صار `invoice-doc-*` يقرأ من `--doc-*`.
 *
 * هذه البوابة تمنع عودة الثلاثة.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_invoice_footer_document.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reporter } from './auditKit.mjs'

const R = reporter('تذييل الفاتورة ورأسها — لغة مستند واحدة')
const ROOT = '/home/user/shopsys/app'
const css = readFileSync(`${ROOT}/src/index.css`, 'utf8')
const frame = readFileSync(`${ROOT}/src/ui/components/InvoicePOSFrame.tsx`, 'utf8')
const sales = readFileSync(`${ROOT}/src/ui/pages/AdvancedSalesInvoicePage.tsx`, 'utf8')
const purchase = readFileSync(`${ROOT}/src/ui/pages/AdvancedPurchaseInvoicePage.tsx`, 'utf8')
const PAGES = [['المبيعات', sales], ['المشتريات', purchase]]

/** جسم قاعدة CSS لمحدِّد يبدأ سطره (أول تطابق) */
const ruleOf = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`(^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`))
  assert.ok(m, `قاعدة مفقودة في index.css: ${selector}`)
  return m[2]
}
/** كتلة تذييل الفاتورة داخل الصفحة (من وسم اللوحات حتى نهاية القسم) */
const footerOf = (src) => {
  const a = src.indexOf('<section className="invoice-totals-footer">')
  assert.ok(a > 0, 'قسم لوحات التذييل غير موجود')
  const b = src.indexOf('\n  </section>\n  </div>\n  </section>', a)
  assert.ok(b > a, 'نهاية قسم التذييل غير معروفة')
  return src.slice(a, b)
}

/* ① اللوحات الثلاث صارت لوحات مستند لا بطاقات ملوّنة */
{
  for (const [label, src] of PAGES) {
    const foot = footerOf(src)
    for (const cls of ['invoice-doc-panel', 'invoice-doc-panel-head', 'invoice-doc-panel-body', 'invoice-doc-panel-foot', 'invoice-doc-sum', 'invoice-doc-grand']) {
      assert.ok(foot.includes(cls), `تذييل ${label}: ينقصه صنف المستند ${cls}`)
    }
    const panels = (foot.match(/className="invoice-doc-panel"/g) ?? []).length
    assert.equal(panels, 3, `تذييل ${label}: عدد لوحات المستند ${panels} — المطلوب ثلاث (شروط · تحصيل · إجماليات)`)
    assert.ok(foot.includes('data-invoice-notes'), `تذييل ${label}: لوحة الملاحظات فقدت وسمها`)
  }
  R.ok('الشروط والتحصيل والإجماليات: ثلاث لوحات مستند في صفحتَي البيع والشراء')
}

/* ② لا بطاقة ملوّنة باقية في التذييل — الشكل يأتي من طبقة المستند وحدها */
{
  const banned = ['from-brand-500', 'from-brand-50', 'bg-gradient-to', 'border-brand-200', 'bg-emerald-500/', 'text-emerald-700', 'rounded-2xl', 'border-2', 'bg-white', 'dark:bg-card-dark', 'text-brand-600', 'bg-slate-50']
    for (const [label, src] of PAGES) {
    const foot = footerOf(src)
    const left = banned.filter((t) => foot.includes(t))
    assert.deepEqual(left, [], `تذييل ${label}: بقايا الشكل القديم (${left.join('، ')}) — الشكل من invoice-doc-* لا من أدوات تيلويند اللونية`)
  }
  R.ok('لا تدرّجات ولا حدود ملوّنة ولا خلفية بيضاء ثابتة في أي لوحة تذييل')
}

/* ③ قواعد اللوحات موجودة وتقرأ من متغيرات المستند (فتتبع الوضع الليلي تلقائياً) */
{
  const need = {
    '.invoice-doc-panel': ['--doc-line', '--doc-paper'],
    '.invoice-doc-panel-head': ['--doc-line', '--doc-tint'],
    '.invoice-doc-panel-foot': ['--doc-line', '--doc-tint'],
    '.invoice-doc-sum-row': ['--doc-muted'],
    '.invoice-doc-grand': ['--doc-accent-soft', '--doc-tint-strong'],
  }
  for (const [sel, tokens] of Object.entries(need)) {
    const body = ruleOf(sel)
    for (const token of tokens) assert.ok(body.includes(token), `${sel} لا يقرأ ${token} — سيتجمّد لونه ليلاً`)
  }
  // نغمات الحالة لها بديل ليلي صريح
  for (const token of ['--doc-ok', '--doc-warn', '--doc-danger']) {
    assert.ok(css.includes(`${token}:`), `المتغير ${token} غير معرّف`)
    assert.ok(css.slice(css.indexOf('.dark {')).includes(`${token}:`), `المتغير ${token} بلا بديل ليلي`)
  }
  R.ok('قواعد اللوحات وألوان الحالة كلها متغيرات مستند لها بديل ليلي')
}

/* ④ الرأس مضغوط: عمود واحد، وشريط الطرف بعرض المستند، ولا تكرار للجلسة */
{
  const body = ruleOf('.invoice-doc-header-body')
  assert.ok(/flex-direction:\s*column/.test(body), 'رأس المستند ما زال عمودين — بطاقة الطرف تضغط الحقول فتتكدس أسطراً')
  assert.ok(!/grid-template-columns/.test(body), 'شبكة العمودين عادت إلى رأس المستند')
  const pad = Number(body.match(/padding:\s*([\d.]+)rem/)?.[1] ?? 9)
  assert.ok(pad <= 0.4, `حشوة رأس المستند ${pad}rem كبيرة`)
  const fields = ruleOf('.invoice-doc-fields')
  const colMin = Number(fields.match(/minmax\(min\(([\d.]+)rem/)?.[1] ?? 99)
  assert.ok(colMin <= 9, `أدنى عرض لعمود الحقول ${colMin}rem — يفرض أسطراً إضافية في الرأس`)
  const party = ruleOf('.invoice-doc-party')
  assert.ok(/border-bottom/.test(party) && !/border-inline-start/.test(party), 'شريط الطرف ما زال عموداً جانبياً')
  // الجلسة والاتصال مرة واحدة فقط: في شريط الإجراءات السفلي
  const cardbar = frame.slice(frame.indexOf('invoice-doc-cardbar-meta'), frame.indexOf('invoice-doc-header-body'))
  assert.ok(!cardbar.includes('invoice-doc-cardbar-session'), 'بيانات الجلسة ما زالت مكرَّرة في شريط البطاقة وفي شريط الإجراءات')
  assert.ok(!cardbar.includes('invoice-doc-online'), 'مؤشر الاتصال مكرَّر في رأس المستند وأسفله')
  assert.ok(frame.slice(frame.indexOf('invoice-doc-actionbar-info')).includes('invoice-doc-cardbar-session'), 'بيانات الجلسة اختفت بدل أن تنتقل لشريط الإجراءات')
  R.ok(`رأس المستند عمود واحد بحشوة ${pad}rem وحقول من ${colMin}rem، وبيانات الجلسة مرة واحدة أسفل الشاشة`)
}

/* ⑤ حالة الطرف بجوار اسمه لا في خانة مستقلة */
{
  for (const [label, src] of PAGES) {
    const card = src.slice(src.indexOf('invoice-party-profile-card'), src.indexOf('invoice-party-profile-metrics'))
    assert.ok(card.includes('invoice-party-state'), `${label}: لا شارة حالة بجوار اسم الطرف`)
    assert.ok(/is-off/.test(card) && /is-cash/.test(card), `${label}: شارة الحالة لا تميّز الموقوف عن النقدي`)
    const metrics = src.slice(src.indexOf('invoice-party-profile-metrics'))
    assert.ok(!metrics.slice(0, 1600).includes('<small>حالة الحساب</small>'), `${label}: خانة «حالة الحساب» ما زالت تأكل عموداً بعد نقلها بجوار الاسم`)
    assert.ok(metrics.slice(0, 1600).includes('الرصيد بعد الترحيل'), `${label}: الخانة المحرَّرة لم تُستثمر في مؤشر الرصيد المتوقع`)
    assert.ok(src.includes('partyCreditTone('), `${label}: نغمة الحالة لا تأتي من دالة واحدة`)
  }
  const state = ruleOf('.invoice-party-state')
  assert.ok(state.includes('--doc-ok'), 'شارة الحالة بلون محفور بدل متغير المستند')
  R.ok('حالة الطرف شارة ملوّنة بجوار اسمه، والخانة المحرَّرة صارت «الرصيد بعد الترحيل»')
}

/* ⑥ فحص وظيفي: نغمة الحد الائتماني تحكم على الرصيد المتوقع لا الحالي */
{
  const { partyCreditTone } = await import('../src/core/money.ts')
  assert.equal(partyCreditTone(0, null, true), 'positive', 'المتزن يجب أن يكون أخضر')
  assert.equal(partyCreditTone(-5000, null, true), 'positive', 'الدائن لنا ليس تحذيراً')
  assert.equal(partyCreditTone(5000, null, true), 'warning', 'المديونية بلا حد ائتماني تحذير')
  assert.equal(partyCreditTone(5000, 10000, true), 'warning', 'داخل الحد الائتماني تحذير لا خطر')
  assert.equal(partyCreditTone(15000, 10000, true), 'danger', 'تجاوز الحد الائتماني يجب أن يكون خطراً')
  assert.equal(partyCreditTone(0, 10000, false), 'danger', 'الحساب الموقوف خطر ولو كان متزناً')
  R.ok('partyCreditTone: موقوف ⇒ خطر · تجاوز الحد ⇒ خطر · مديونية داخل الحد ⇒ تحذير · متزن/دائن ⇒ سليم')
}

/* ⑦ الشروط الجاهزة تُكتب بضغطة بدل إعادة كتابتها في كل مستند */
{
  for (const [label, src, name] of [['المبيعات', sales, 'SALE_TERMS'], ['المشتريات', purchase, 'PURCHASE_TERMS']]) {
    const list = src.match(new RegExp(`const ${name}=\\[([^\\]]*)\\]`))?.[1] ?? ''
    const terms = list.split("','").filter(Boolean)
    assert.ok(terms.length >= 3, `${label}: قائمة الشروط الجاهزة قصيرة (${terms.length})`)
    assert.ok(src.includes(`${name}.map(`), `${label}: الشروط الجاهزة غير معروضة كأزرار`)
    assert.ok(/setNotes\(notes\.trim\(\)\?/.test(src), `${label}: زر الشرط يمسح الملاحظات بدل أن يضيف إليها`)
  }
  R.ok('شروط جاهزة بضغطة واحدة تُضاف لملاحظات المستند ولا تمسح ما قبلها')
}

/* ⑧ التحصيل: ملء سريع بالمبلغ كاملاً أو تحويله لآجل، وسطر متبقٍ صريح */
{
  assert.ok(sales.includes('تحصيل المبلغ كاملاً') && sales.includes('بيع آجل بلا تحصيل'), 'لوحة التحصيل بلا أزرار ملء سريع')
  assert.ok(purchase.includes('سداد المستحق كاملاً') && purchase.includes('شراء آجل بلا سداد'), 'لوحة الدفع بلا أزرار ملء سريع')
  for (const [label, src] of PAGES) {
    assert.ok(/paidTouched\.current=true;const full=|paidTouched\.current=true;setPaid\(String\(/.test(src), `${label}: الملء السريع لا يعلّم الحقل كمُعدَّل يدوياً`)
    assert.ok(footerOf(src).includes('is-due'), `${label}: لا سطر «متبقٍ» بارز في تذييل اللوحة`)
  }
  R.ok('التحصيل والسداد: ملء المبلغ كاملاً أو تحويله لآجل بضغطة، والمتبقي معلن في ذيل اللوحة')
}

/* ⑨ صفوف الكشف بنقاط موصولة ومحاذاة واحدة للمبالغ */
{
  for (const [label, src] of PAGES) {
    const row = src.match(/function Row\(\{[^}]*\}[^)]*\)\{return <div className=\{`([^`]*)`/)?.[1] ?? ''
    assert.ok(row.includes('invoice-doc-sum-row'), `${label}: صف الكشف لا يستعمل صنف المستند`)
    assert.ok(row.includes('is-strong'), `${label}: لا تمييز لسطر الإجمالي`)
  }
  const sumRow = ruleOf('.invoice-doc-sum-row')
  assert.ok(/dotted/.test(ruleOf('.invoice-doc-sum-row > i')), 'لا نقاط موصولة بين البند ومبلغه')
  assert.ok(/direction:\s*ltr/.test(ruleOf('.invoice-doc-sum-row > b')) && /monospace/.test(ruleOf('.invoice-doc-sum-row > b')),
    'المبالغ في الكشف بلا محاذاة يسارية بخط أحادي')
  assert.ok(sumRow.includes('--doc-muted'), 'صف الكشف بلون محفور')
  R.ok('كشف الإجماليات: بند ونقاط موصولة ومبلغ أحادي المسافة — شكل المستند المحاسبي')
}

R.done()
