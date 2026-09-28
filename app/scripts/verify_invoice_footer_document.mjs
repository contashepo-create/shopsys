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

/* ④ الرأس على تصميم المالك: حقول بثلاثة أعمدة + عمود مؤشرات ببطاقتين، ولا تكرار للجلسة
      (التصميم المرجعي الذي أرسله المالك 2026-09-28: grid-cols-12 ⇒ 8 حقول + 4 مؤشرات) */
{
  const body = ruleOf('.invoice-doc-header-body')
  assert.ok(/display:\s*grid/.test(body), 'رأس المستند فقد شبكته — المرجع: عمود حقول وعمود مؤشرات')
  const cols = body.match(/grid-template-columns:\s*([^;]+);/)?.[1] ?? ''
  assert.ok(/minmax\(0,\s*1fr\)/.test(cols), `عمود الحقول غير مرن: ${cols}`)
  assert.ok(/minmax\(min\(/.test(cols), `عمود المؤشرات بحدّ صلب يُفيض الرأس: ${cols}`)
  const pad = Number(body.match(/padding:\s*([\d.]+)rem/)?.[1] ?? 9)
  assert.ok(pad <= 0.45, `حشوة رأس المستند ${pad}rem كبيرة`)
  // النموذج المعتمد (2026-09-28): ستة حقول في سطر واحد ثم شريطان عرضيان، وتنكمش تدريجياً
  const fields = ruleOf('.invoice-doc-fields')
  assert.ok(/grid-template-columns:\s*1\.55fr 1fr 1fr 1\.2fr 1\.3fr 1fr/.test(fields), `حقول الرأس ليست ستة أعمدة كالنموذج المعتمد: ${fields}`)
  assert.ok(/@media \(max-width: 1100px\)[^}]*\{[^}]*\.invoice-doc-fields \{ grid-template-columns: repeat\(3/.test(css.replace(/\s+/g, ' ')),
    'لا تنكمش حقول الرأس إلى ثلاثة أعمدة على الشاشات المتوسطة')
  assert.ok(/@media \(max-width: 760px\)[^}]*\{[^}]*\.invoice-doc-fields \{ grid-template-columns: repeat\(2/.test(css.replace(/\s+/g, ' ')),
    'لا تنكمش حقول الرأس إلى عمودين على الشاشات الضيقة')
  assert.ok(/repeat\(auto-fit/.test(ruleOf('.invoice-doc-side')), 'عمود المؤشرات ليس شبكة تنكمش')
  assert.ok(css.includes('.invoice-doc-party'), 'لا قاعدة لبطاقة رصيد الطرف')
  assert.ok(/13rem/.test(ruleOf('.invoice-doc-header-body')), 'عمود بطاقة الطرف ليس بعرض 13rem كالنموذج')
  /* 2026-09-28: شريط المرجع المستقل أُلغي — «المرجع/أمر الشراء» صار أحد الحقول
     الستة، وبقية إعداداته انتقلت إلى شريط بيانات الطرف، تماماً كالنموذج المعتمد. */
  assert.ok(!css.includes('.invoice-doc-refbar {') || !frame.includes('invoice-doc-refbar'), 'شريط المرجع المستقل عاد فوق الحقول')
  for (const [cls, why] of [['invoice-doc-stripfield', 'حقول الشريط المدمجة (المندوب/أمر الشراء)'], ['invoice-doc-stripcheck', 'خيارات الشريط المدمجة']]) {
    assert.ok(css.includes(`.${cls}`), `لا قاعدة CSS لـ${why}`)
  }
  // الإطار نفسه: حقول ثم شريطان رفيعان، وبجانبها بطاقة رصيد الطرف
  const header = frame.slice(frame.indexOf('invoice-doc-header-body'), frame.indexOf('invoice-pos-document'))
  for (const cls of ['invoice-doc-fields', 'invoice-doc-side', 'invoice-doc-party', 'invoice-doc-strip']) {
    assert.ok(header.includes(cls), `رأس الإطار ينقصه ${cls}`)
  }
  // الجلسة والاتصال مرة واحدة فقط: في شريط الإجراءات السفلي
  const cardbar = frame.slice(frame.indexOf('invoice-doc-cardbar-meta'), frame.indexOf('invoice-doc-header-body'))
  assert.ok(!cardbar.includes('invoice-doc-cardbar-session'), 'بيانات الجلسة ما زالت مكرَّرة في شريط البطاقة وفي شريط الإجراءات')
  assert.ok(!cardbar.includes('invoice-doc-online'), 'مؤشر الاتصال مكرَّر في رأس المستند وأسفله')
  assert.ok(frame.slice(frame.indexOf('invoice-doc-actionbar-info')).includes('invoice-doc-cardbar-session'), 'بيانات الجلسة اختفت بدل أن تنتقل لشريط الإجراءات')
  R.ok(`رأس المستند: ستة حقول في سطر + شريطا الصنف وبيانات الطرف + بطاقة الطرف 13rem بحشوة ${pad}rem، والجلسة مرة واحدة أسفل الشاشة`)
}

/* ⑤ بطاقتا المؤشرات كما في المرجع: حالة الطرف بجوار عنوانه وشريط استهلاك، ورقاقة كود للصنف */
{
  for (const [label, src] of PAGES) {
    const card = src.slice(src.indexOf('partyProfile={'), src.indexOf('itemProfile={'))
    assert.ok(card.includes('invoice-doc-cardhead'), `${label}: بطاقة الطرف بلا رأس بطاقة`)
    assert.ok(card.includes('invoice-party-state'), `${label}: لا شارة حالة بجوار عنوان بطاقة الطرف`)
    assert.ok(/is-off/.test(card) && /is-cash/.test(card), `${label}: شارة الحالة لا تميّز الموقوف عن النقدي`)
    assert.ok(card.includes('invoice-doc-gauge'), `${label}: بطاقة الطرف بلا شريط نسبة (استهلاك ائتمان / نسبة سداد)`)
    assert.ok(card.includes('الرصيد السابق'), `${label}: بطاقة الطرف بلا «الرصيد السابق»`)
    assert.ok(card.includes('الرصيد بعد الترحيل'), `${label}: بطاقة الطرف بلا مؤشر الرصيد المتوقع`)
    assert.ok(!card.includes('<small>حالة الحساب</small>'), `${label}: خانة «حالة الحساب» عادت تأكل سطراً بعد نقلها بجوار العنوان`)
    assert.ok(src.includes('partyCreditTone('), `${label}: نغمة الحالة لا تأتي من دالة واحدة`)
    /* النموذج المعتمد يضع الصنف المحدد **شريطاً** في الترويسة لا بطاقة جانبية:
       الصنف · المتاح · تكلفة الشراء · سعر البيع، بجوار اسم المستخدم. */
    const item = src.slice(src.indexOf('itemProfile={'), src.indexOf('itemProfile={') + 2200)
    assert.ok(item.includes('الصنف المحدد'), `${label}: شريط الترويسة بلا «الصنف المحدد»`)
    assert.ok(item.includes('invoice-doc-strip-k') && item.includes('invoice-doc-strip-v'), `${label}: شريط الصنف ليس بمفاتيح وقيم النموذج`)
    assert.ok(item.includes('المتاح'), `${label}: شريط الصنف بلا المتاح من المخزون`)
    assert.ok(item.includes('focusedItem'), `${label}: شريط الصنف لا يتبع آخر سطر مضاف`)
  }
  const state = ruleOf('.invoice-party-state')
  assert.ok(state.includes('--doc-ok'), 'شارة الحالة بلون محفور بدل متغير المستند')
  assert.ok(ruleOf('.invoice-doc-gauge-fill').includes('--doc-accent'), 'شريط النسبة بلون محفور')
  R.ok('بطاقة رصيد الطرف بشريط النسبة، وشريط الصنف المحدد (المتاح · التكلفة · السعر) في الترويسة كالنموذج')
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

/* ⑩ قطع التصميم المرجعي الذي أرسله المالك (2026-09-28) — سبع قطع لا تسقط بالصدفة */
{
  const frameParts = [
    ['invoice-doc-dots', 'نقاط نافذة سطح المكتب الثلاث أعلى يمين المستند'],
    ['invoice-doc-nav', 'سهما المستند السابق/التالي داخل صندوق الرقم'],
    ['invoice-doc-balanced', 'رقاقة «القيد متزن» بجوار رقم المستند'],
  ]
  for (const [cls, label] of frameParts) {
    assert.ok(frame.includes(cls), `الإطار فقد ${label} (${cls})`)
    assert.ok(css.includes(`.${cls}`), `لا قاعدة CSS لـ ${cls}`)
  }
  // قرار المالك (المرحلة ⑨): **لا شريط بحث أصناف منفصل** — البحث من خلية اسم الصنف
  assert.ok(!frame.includes('invoice-doc-entry'), 'عاد شريط البحث/الباركود المنفصل إلى الإطار')
  assert.ok(!frame.includes('itemEntry'), 'الإطار ما زال يستقبل مربع البحث بدل جدول البنود')
  // جدول البنود: الوحدة والضريبة وأدوات السطر والبحث داخل خلية الاسم
  const table = readFileSync(`${ROOT}/src/ui/components/InvoiceLinesTable.tsx`, 'utf8')
  for (const [needle, label] of [['COL.unit', 'عمود الوحدة'], ['COL.tax', 'عمود الضريبة'], ['COL.tools', 'عمود الإجراءات'], ['invoice-line-entry-cell', 'مربع البحث داخل خلية اسم أول سطر فارغ'], ['onDuplicate', 'تكرار السطر']]) {
    assert.ok(table.includes(needle), `جدول البنود ينقصه ${label}`)
  }
  assert.ok(!table.includes('invoice-doc-linebar'), 'عاد شريط أدوات البنود السفلي المكرر')
  assert.ok(/invoice-doc-taxchip/.test(table) && css.includes('.invoice-doc-taxchip'), 'رقاقة نسبة الضريبة على السطر غير موجودة')
  // البلاطات الثلاث وكتلة التسوية في صفحتي البيع والشراء
  const picker = readFileSync(`${ROOT}/src/ui/components/PaymentMethodPicker.tsx`, 'utf8')
  assert.ok(picker.includes('invoice-doc-tiles') && /نقدي/.test(picker) && /ماكينة دفع/.test(picker), 'بلاطات وسيلة الدفع الثلاث غير موجودة')
  for (const [label, src] of PAGES) {
    assert.ok(src.includes('tiles'), `${label}: لوحة التحصيل بلا بلاطات وسيلة الدفع`)
    /* النموذج المعتمد ينهي لوحة الإجماليات عند «صافي إجمالي الفاتورة»:
       المدفوع والمتبقي في حاشية لوحة التحصيل، وحالة اتزان القيد رقاقة في
       شريط المستند — بلا تكرار لنفس الرقم في ثلاثة أماكن. */
    const paidFoot = src.slice(src.indexOf('invoice-doc-panel-foot'), src.indexOf('invoice-doc-grand'))
    assert.ok(/المحصَّل|المستحق للمورد/.test(paidFoot) && /المتبقي/.test(paidFoot), `${label}: حاشية لوحة التحصيل بلا المحصَّل/المتبقي`)
    assert.ok(!src.includes('invoice-doc-settle') && !src.includes('متزن — مدين = دائن'), `${label}: عادت كتلة المدفوع/المتبقي وحالة القيد تكرّر نفسها داخل لوحة الإجماليات`)
    const afterGrand = src.slice(src.indexOf('invoice-doc-grand'), src.indexOf('</section>', src.indexOf('invoice-doc-grand')))
    assert.ok(!afterGrand.includes('<Row '), `${label}: صفوف كشف بعد «صافي إجمالي الفاتورة» — النموذج ينتهي عنده`)
    assert.ok(src.includes('invoice-doc-infield-chip'), `${label}: كود الطرف ليس رقاقة داخل حقله كالمرجع`)
  }
  R.ok('قطع التصميم المرجعي: نقاط النافذة · تصفّح الدفتر · تصفية التصنيف · رقاقات داخل الحقول · وحدة وضريبة وأدوات لكل سطر · بلاطات الدفع · كتلة التسوية')
}

/* ⑪ المرفقات وتخصيص الحقول وتصدير PDF — قطع المرجع المتبقية، ولا زرّ منها شكلي */
{
  const attach = readFileSync(`${ROOT}/src/ui/components/DocumentAttachments.tsx`, 'utf8')
  const repo = readFileSync(`${ROOT}/src/data/repo.ts`, 'utf8')
  const store = readFileSync(`${ROOT}/src/stores/app.store.ts`, 'utf8')
  const table = readFileSync(`${ROOT}/src/ui/components/InvoiceLinesTable.tsx`, 'utf8')

  // (أ) خانة المرفقات موصولة بتخزين حقيقي لا واجهة فارغة
  assert.ok(/documentFiles:\s*DocumentFile\[\]/.test(repo), 'لا جدول مرفقات في قاعدة البيانات — المرفقات ستضيع')
  assert.ok(repo.includes('addDocumentFile:') && repo.includes('removeDocumentFile:'), 'قاعدة البيانات بلا إجراءات إضافة/حذف المرفق')
  assert.ok(repo.includes('validateAttachment({ name: file.name'), 'المرفق يُحفظ بلا فحص نوع وحجم')
  assert.ok(/رحّل الفاتورة أولاً/.test(repo), 'المرفق يُقبل بلا رقم مستند — مرفق يتيم')
  assert.ok(attach.includes('addDocumentFile') && attach.includes('removeDocumentFile') && attach.includes('fileToAttachmentDataUrl'),
    'مكوّن المرفقات لا يقرأ/يكتب في المخزن')
  assert.ok(attach.includes('المرفقات والمستندات ('), 'زر المرفقات بلا عدّاد كما في المرجع')
  assert.ok(css.includes('.invoice-doc-attachbtn') && css.includes('.invoice-doc-attachlist'), 'لا أنماط مستند لخانة المرفقات')
  for (const [label, src] of PAGES) {
    assert.ok(src.includes('DocumentAttachmentsBox'), `${label}: تذييل لوحة الملاحظات بلا خانة مرفقات`)
    assert.ok(/attachments\.forEach/.test(src) && src.includes('addDocumentFile'), `${label}: مرفقات المسودة لا تُربط بالفاتورة عند الترحيل`)
    assert.ok(/attachments\}\)\}\);unsaved\.markClean|,attachments\}\)/.test(src), `${label}: المرفقات لا تُحفظ داخل المسودة`)
  }

  // (ب) تخصيص الحقول: تفضيل محفوظ يقرؤه الجدول فعلاً — وأعمدة الإدخال ممنوعة من الإخفاء
  assert.ok(store.includes('invoiceColumns') && store.includes('toggleInvoiceColumn') && store.includes('resetInvoiceColumns'),
    'لا تفضيل محفوظ لأعمدة جدول البنود')
  assert.ok(/DEFAULT_INVOICE_COLUMNS[\s\S]{0,120}code:\s*true/.test(store), 'الأعمدة لا تبدأ كلها ظاهرة')
  assert.ok(table.includes('state.invoiceColumns'), 'جدول البنود لا يقرأ تفضيل الأعمدة')
  for (const key of ['columns.code', 'columns.unit', 'columns.tax', 'columns.details']) {
    assert.ok(table.includes(key), `عمود ${key} غير موصول بزر تخصيص الحقول`)
  }
  for (const guard of ['COL.qty', 'COL.price', 'COL.total', 'COL.tools']) {
    const idx = table.indexOf(`${guard}}\`} scope="col"`)
    assert.ok(idx > 0 || table.includes(guard), `عمود الإدخال ${guard} اختفى`)
  }
  assert.ok(!/columns\.(qty|price|total|tools|warehouse)/.test(table), 'أعمدة الإدخال (كمية/سعر/إجمالي/مخزن) لا يجوز إخفاؤها — الحساب يمر منها')
  assert.ok(frame.includes('تخصيص الحقول') && frame.includes('data-doc-columns-panel') && css.includes('.invoice-doc-colmenu'),
    'زر «تخصيص الحقول» غير موجود في شريط الإجراءات')
  assert.ok(/الإخفاء عرضٌ فقط/.test(frame), 'قائمة الأعمدة بلا تنبيه أن الإخفاء لا يمس الحساب')

  // (ج) تصدير PDF: زر موصول بمسار طباعة حقيقي مع تلميح الوجهة
  assert.ok(frame.includes('onExportPdf') && frame.includes('تصدير PDF'), 'لا زر «تصدير PDF» في شريط الإجراءات')
  for (const [label, src] of PAGES) {
    assert.ok(src.includes('onExportPdf={exportPdf}'), `${label}: زر PDF غير موصول`)
    assert.ok(/const exportPdf=\(\)=>\{[\s\S]{0,240}printDraft\('a4'\)/.test(src), `${label}: زر PDF لا يفتح قالب A4 فعلاً`)
    assert.ok(src.includes('حفظ كـ PDF'), `${label}: لا تلميح لوجهة الحفظ كـ PDF`)
  }

  // (د) رقاقة العملة داخل حقل المبلغ (المرجع: EGP داخل الحافة)
  assert.ok(css.includes('.invoice-doc-amountcur') && /position:\s*absolute/.test(ruleOf('.invoice-doc-amountcur')), 'رقاقة العملة ليست داخل حافة حقل المبلغ')
  for (const [label, src] of PAGES) {
    assert.ok(src.includes('invoice-doc-amountfield') && src.includes('invoice-doc-amountcur'), `${label}: حقل المبلغ بلا رقاقة العملة`)
  }
  R.ok('المرفقات بتخزين حقيقي وفحص · تخصيص الحقول لا يمس أعمدة الإدخال ولا الحساب · تصدير PDF يفتح قالب A4 · رقاقة العملة داخل حقل المبلغ')
}

R.done()
