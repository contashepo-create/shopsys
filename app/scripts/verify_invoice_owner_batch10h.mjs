/**
 * بوابة دفعة المالك ⑩ح على مستند الفاتورة (2026-09-28)
 * ─────────────────────────────────────────────────────
 * أحد عشر بنداً طلبها المالك دفعةً واحدة، وكل بند هنا مقفول بفحص نصي حتى
 * لا يسقط بالصدفة في تعديل لاحق:
 *   ① بطاقة الطرف: الحد ⇐ الرصيد السابق ⇐ الرصيد بعد الترحيل بلا شريط استهلاك
 *   ② التحصيل المتعدد منقول من الفاتورة التجريبية برسائله
 *   ③ رمز تعديل الطرف أصغر
 *   ④ الحقول حسب نمط المحرِّر (مبسط · بيع مباشر · احترافي/متقدم)
 *   ⑤ القوائم المنسدلة تظل منسدلة بعد الاختيار
 *   ⑥ خمسة سطور في جدول الأصناف
 *   ⑦ لوحة الشروط: مربع نص + شروط جاهزة + أزرار المصاريف داخلها
 *   ⑧ الشريط العلوي: أزرار نافذة وظيفية بلا زر رجوع/طابعة/ثلاث نقاط
 *   ⑨ إلغاء الشارات الزائدة مع بقاء تاريخ الفاتورة قابلاً للتعديل
 *   ⑩ تسميات الحقول بلا التفاف وبمحاذاة واحدة
 *   ⑪ اسم حقل الملاحظة زر يفتح سجل الملاحظات (تعديل وحذف) مع بقاء آخر ملاحظة
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('دفعة المالك ⑩ح على الفاتورة')
const ROOT = '/home/user/shopsys/app'
const read = (path) => readFileSync(`${ROOT}/${path}`, 'utf8')
const css = read('src/index.css')
const sales = read('src/ui/pages/AdvancedSalesInvoicePage.tsx')
const purchase = read('src/ui/pages/AdvancedPurchaseInvoicePage.tsx')
const frame = read('src/ui/components/InvoicePOSFrame.tsx')
const table = read('src/ui/components/InvoiceLinesTable.tsx')
const pickers = read('src/ui/components/KeyboardPickers.tsx')
const notesLog = read('src/ui/components/PartyNotesLog.tsx')
const repo = read('src/data/repo.ts')
const mockup = readFileSync('/home/user/shopsys/docs/mockups/invoice-layout-2026/index.html', 'utf8')
const ruleOf = (selector) => {
  const at = css.indexOf(`${selector} {`)
  assert.ok(at >= 0, `لا قاعدة CSS للمحدد ${selector}`)
  return css.slice(at, css.indexOf('}', at) + 1)
}

/* ① بطاقة الطرف: ترتيب ثابت · بلا شريط استهلاك · تلوين من دالة واحدة */
{
  for (const [label, src, first] of [['المبيعات', sales, 'الحد الائتماني'], ['المشتريات', purchase, 'شروط السداد']]) {
    const card = src.slice(src.indexOf('partyProfile={'), src.indexOf('itemProfile={'))
    assert.ok(!card.includes('استهلاك'), `${label}: شريط استهلاك الحد الائتماني عاد بعد إلغائه`)
    assert.ok(card.indexOf(first) < card.indexOf('الرصيد السابق'), `${label}: ترتيب بطاقة الطرف ليس ${first} ⇐ الرصيد السابق`)
    assert.ok(card.indexOf('الرصيد السابق') < card.indexOf('الرصيد بعد الترحيل'), `${label}: «الرصيد بعد الترحيل» ليس آخر البطاقة`)
    assert.ok(/is-\$\{partyBalanceTone\(/.test(card), `${label}: تلوين الرصيد ليس من دالة النغمة الموحدة`)
  }
  // البطاقة تمتد لأسفل بارتفاع صفوف الحقول المجاورة (طلب المالك: لا فراغ أسفلها)
  assert.ok(css.includes('.invoice-doc .invoice-doc-party { display: flex; height: 100%;'), 'بطاقة الطرف لا تملأ ارتفاع صف الحقول بجانبها')
  R.ok('بطاقة الطرف: الحد/الشروط ⇐ الرصيد السابق ⇐ الرصيد بعد الترحيل، بلا شريط استهلاك وبتلوين موحّد وبكامل الارتفاع')
}

/* ② التحصيل المتعدد كما في الفاتورة التجريبية: أربعة طرق في فاتورة واحدة */
{
  assert.ok(mockup.includes('تحصيل متعدد (أكثر من طريقة في فاتورة واحدة)'), 'النموذج المرجعي تغيّر: نص «تحصيل متعدد» غير موجود')
  assert.ok(sales.includes('تحصيل متعدد (أكثر من طريقة في فاتورة واحدة)'), 'نص «تحصيل متعدد» لم يُنقل من النموذج حرفياً')
  for (const id of ['pay-cash', 'pay-bank', 'pay-card', 'pay-staff']) {
    assert.ok(sales.includes(`id="${id}"`), `صف التحصيل ${id} مفقود من لوحة التحصيل المتعدد`)
  }
  assert.ok(/const \[multiPay,setMultiPay\]=useState\(false\)/.test(sales), 'حالة التحصيل المتعدد غير موجودة')
  assert.ok(sales.includes('{!multiPay&&<>') && sales.includes('{multiPay&&<div className="invoice-doc-payrows">'), 'المفرد والمتعدد لا يتبادلان الظهور كما في النموذج')
  // المبلغ البنكي يدخل المحصَّل والتوزيع المحاسبي
  assert.ok(/bankPaidMinor/.test(sales) && /kind==='bank'/.test(sales), 'الشق البنكي من التحصيل المتعدد لا يُرحَّل على حساب البنك')
  assert.ok(sales.includes('invoice-doc-paynote'), 'لا رسالة بوابة تحصيل أسفل اللوحة')
  R.ok('التحصيل المتعدد: أربعة صفوف (نقدي · بنك · ماكينة · موظف) بتبادل مع الوضع المفرد وترحيل لكل حساب')
}

/* ②ب رسائل بوابة التحصيل بنصوص النموذج وحسابها الصحيح */
{
  for (const text of ['عميل نقدي — التحصيل كامل', 'ضمن حد الائتمان', 'مسدَّدة بالكامل']) {
    assert.ok(sales.includes(text), `رسالة التحصيل «${text}» غير منقولة من النموذج`)
  }
  const logic = sales.slice(sales.indexOf('const minCollectMinor'), sales.indexOf('const minCollectMinor') + 420).replace(/\s+/g, '')
  assert.ok(/Math\.max\(0,selectedCustomerBalance\+grandMinor-/.test(logic), 'الحد الأدنى للتحصيل لا يُحسب من الرصيد + الفاتورة − حد الائتمان')
  assert.ok(/shortMinor/.test(sales), 'لا حساب لعجز التحصيل')
  R.ok('بوابة التحصيل: عميل نقدي/موقوف ⇒ التحصيل كامل · غيره ⇒ ما يتجاوز حد الائتمان، بنصوص النموذج')
}

/* ③ رمز تعديل الطرف أصغر (8px داخل رقاقة ≤1.1rem) */
{
  for (const [label, src] of [['المبيعات', sales], ['المشتريات', purchase]]) {
    assert.ok(/<Pencil size=\{8\}\/>/.test(src), `${label}: رمز تعديل الطرف لم يُصغَّر إلى 8px`)
  }
  assert.ok(/width: 1\.0\d*rem/.test(ruleOf('.invoice-doc .invoice-pos-edit-party')), 'رقاقة تعديل الطرف ما زالت عريضة')
  R.ok('رمز القلم بجانب اسم العميل رقاقة 1.05rem برسم 8px')
}

/* ④ الحقول حسب النمط: مبسط ⇐ بيع مباشر ⇐ احترافي/متقدم */
{
  assert.ok(/const fullFields\s*=\s*mode==='profit'\|\|mode==='advanced'/.test(sales), 'قاعدة الحقول الكاملة ليست محصورة في الاحترافي/المتقدم')
  assert.ok(/const showStrips\s*=\s*mode!=='simple'/.test(sales), 'الشريطان يجب أن يظهرا في بيع مباشر فما فوق ويختفيا في المبسط')
  for (const field of ['الاستحقاق', 'المرجع', 'المندوب']) {
    const at = sales.indexOf(`<Field label="${field}"`)
    assert.ok(at > 0 && sales.slice(at - 16, at).includes('fullFields&&'), `حقل «${field}» يظهر في النمط المبسط رغم إلغائه`)
  }
  assert.ok(sales.includes('partyMeta={showStrips?') && sales.includes('itemProfile={showStrips?'), 'شريطا الفئة/الملاحظات والمستخدم/الصنف لا يتبعان النمط')
  // المصاريف الداخلية وعمولة الموظف للمتقدم فقط
  const addons = sales.slice(sales.indexOf('invoice-doc-addons'), sales.indexOf('invoice-doc-addons') + 900)
  assert.ok(/mode==='advanced'&&/.test(addons), 'أزرار المصروف الداخلي/العمولة لا تتبع النمط المتقدم')
  R.ok('الحقول حسب النمط: المبسط أربعة حقول · بيع مباشر + الشريطان · الاحترافي/المتقدم كل الحقول')
}

/* ⑤ القوائم المنسدلة تبقى منسدلة بعد الاختيار */
{
  assert.ok(pickers.includes('const openList = ()'), 'لا دالة فتح للقائمة المنسدلة')
  assert.ok(/onFocus=\{openList\}/.test(pickers) && /onMouseDown=\{\(\) => \{ if \(!open\) openList\(\) \}\}/.test(pickers), 'القائمة لا تنفتح بالنقر/التركيز')
  assert.ok(/role="combobox"/.test(pickers) && /aria-expanded=\{open\}/.test(pickers), 'الحقل لا يُعلن نفسه قائمة منسدلة لقارئ الشاشة')
  const body = pickers.slice(pickers.indexOf('const openList = ()'), pickers.indexOf('const openList = ()') + 300)
  assert.ok(body.includes('setQuery(\'\')') && body.includes('setOpen(true)'), 'فتح القائمة لا يعرض كل الخيارات من جديد')
  assert.ok(body.includes('choices.findIndex'), 'العنصر المحدد لا يُظلَّل عند إعادة الفتح')
  R.ok('القوائم المنسدلة: النقر يفتح كل الخيارات والمحدد مظلَّل — لا تتحول إلى حقل كتابة')
}

/* ⑥ خمسة سطور في جدول الأصناف والمساحة المحرَّرة للوحات */
{
  assert.ok(/MIN_VISIBLE_ROWS = 5/.test(table) && /TARGET_VISIBLE_ROWS = 5/.test(table), 'جدول الأصناف لا يعرض خمسة سطور')
  assert.ok(/--doc-rows: 5/.test(css), 'متغير عدد السطور في CSS لم يتبع الخمسة')
  R.ok('جدول الأصناف خمسة سطور والباقي بتمرير داخلي — والمساحة المحرَّرة للوحات الثلاث')
}

/* ⑦ لوحة الشروط: مربع نص + شروط جاهزة + أزرار المصاريف أسفله داخل نفس البوكس */
{
  assert.ok(sales.includes('invoice-doc-termsbox'), 'لا مربع نص للشروط داخل لوحة الملاحظات')
  const terms = sales.slice(sales.indexOf('SALE_TERMS'), sales.indexOf('SALE_TERMS') + 400)
  assert.equal((terms.match(/'/g) ?? []).length >= 6, true, 'الشروط الجاهزة غير معرّفة كنصوص')
  const list = sales.slice(sales.indexOf('const SALE_TERMS'), sales.indexOf(']', sales.indexOf('const SALE_TERMS')))
  assert.equal(list.split('،').length >= 1 && (list.match(/'/g) ?? []).length / 2, 3, 'عدد الشروط الجاهزة ليس ثلاثة')
  const panel = sales.slice(sales.indexOf('data-invoice-terms'), sales.indexOf('data-invoice-terms') + 2600)
  assert.ok(panel.indexOf('invoice-doc-termsbox') < panel.indexOf('invoice-doc-addons'), 'أزرار المصاريف ليست أسفل مربع النص داخل نفس اللوحة')
  assert.ok(panel.includes('مصروف على العميل'), 'زر مصروف العميل خرج من بوكس الشروط')
  R.ok('لوحة الشروط: ثلاثة شروط جاهزة بضغطة + مربع نص + أزرار المصاريف الصغيرة أسفله داخل نفس البوكس')
}

/* ⑧ الشريط العلوي: أزرار نافذة وظيفية فقط */
{
  assert.ok(frame.includes('invoice-doc-winbtns'), 'لا أزرار نافذة وظيفية في الشريط العلوي')
  assert.ok(!frame.includes('invoice-doc-dots'), 'النقاط الملونة الصمّاء عادت')
  for (const gone of ['ArrowRight', 'MoreHorizontal', 'HelpCircle']) {
    assert.ok(!frame.includes(`<${gone} `), `زر ${gone} (رجوع/ثلاث نقاط/استفهام) ما زال في الشريط العلوي`)
  }
  assert.ok(!/مسودة<\/span>/.test(frame), 'كلمة «مسودة» ما زالت في الشريط العلوي')
  assert.ok(!frame.includes('invoice-doc-identity-line'), 'سطر «بيع مباشر · ج.م · التاريخ» ما زال في الشريط العلوي')
  const bar = frame.slice(frame.indexOf('invoice-doc-actionbar'))
  assert.ok(bar.indexOf('invoice-doc-balanced') < bar.indexOf('تخصيص الحقول'), '«القيد متزن» ليست في الشريط السفلي قبل «تخصيص الحقول»')
  R.ok('الشريط العلوي: تصغير/تكبير/إغلاق فقط، بلا رجوع ولا ثلاث نقاط ولا طابعة ولا استفهام، و«القيد متزن» أسفل')
}

/* ⑨ الشارات الملغاة مع بقاء تاريخ الفاتورة قابلاً للتعديل */
{
  const head = sales.slice(sales.indexOf('headerFields={'), sales.indexOf('partyMeta='))
  for (const badge of ['بيع نقدي', 'اليوم', 'فوري', 'مخزون فارغ']) {
    assert.ok(!head.includes(`badge="${badge}"`) && !head.includes(`'${badge}'`), `شارة «${badge}» ما زالت فوق حقول الترويسة`)
  }
  assert.ok(head.includes('type="date"') && head.includes('setInvoiceDate'), 'تاريخ الفاتورة ليس حقلاً قابلاً للتعديل')
  assert.ok(sales.includes('documentDate:invoiceDate'), 'تاريخ الفاتورة المحرَّر لا يُمرَّر إلى الترحيل')
  assert.ok(repo.includes('documentDate?: string') && repo.includes('تاريخ الفاتورة لا يكون في المستقبل'), 'محرك الترحيل لا يقبل تاريخ الفاتورة ولا يحرس المستقبل')
  assert.ok(/const postingDate = chosenDate \|\| systemDate/.test(repo), 'تاريخ القيد لا يتبع تاريخ الفاتورة المحرَّر')
  R.ok('لا شارات زائدة في الترويسة، وتاريخ الفاتورة قابل للتعديل ويصبح تاريخ القيد (بلا تأريخ مستقبلي)')
}

/* ⑩ تسميات الحقول بلا التفاف وبمحاذاة واحدة */
{
  const label = ruleOf('.invoice-doc .invoice-doc-fields .field-head > label')
  assert.ok(/white-space: nowrap/.test(label), 'تسمية الحقل ما زالت تلتف على سطرين')
  const field = ruleOf('.invoice-doc .invoice-doc-fields > .form-field')
  assert.ok(/grid-template-rows/.test(field), 'الحقول ليست على شبكة صفوف واحدة (تسمية ثم مدخل) فتختلف مستوياتها')
  assert.ok(/grid-template-rows: 1\.0\d*rem 1\.9rem/.test(field), 'صفّا الحقل (تسمية ثم مدخل) ليسا بارتفاع ثابت موحد')
  const heights = css.slice(css.indexOf('.invoice-doc .invoice-doc-fields input, .invoice-doc .invoice-doc-fields select,'))
  assert.ok(/\{ height: 1\.9rem !important; min-height: 0 !important; \}/.test(heights.slice(0, 400)), 'مربعات الإدخال ليست بارتفاع موحد')
  assert.ok(heights.slice(0, 700).includes('.party-quick-picker'), 'حقل اختيار الطرف خارج التوحيد فيظهر أعلى/أخفض من جيرانه')
  R.ok('تسميات الحقول سطر واحد بلا التفاف، وكل المدخلات بارتفاع واحد على مستوى محاذاة واحد')
}

/* ⑪ سجل الملاحظات: زر العنوان يفتح السجل، وآخر ملاحظة تبقى ظاهرة بالخارج */
{
  assert.ok(sales.includes('invoice-doc-notebtn') && sales.includes('setNotesLogOpen(true)'), 'اسم حقل الملاحظة ليس زراً يفتح السجل')
  assert.ok(sales.includes('<PartyNotesLog kind="customer"'), 'نافذة سجل الملاحظات غير مربوطة بالفاتورة')
  assert.ok(sales.includes('`آخر ملاحظة: ${'), 'آخر ملاحظة لم تعد ظاهرة خارج السجل')
  assert.ok(notesLog.includes('updatePartyNote') && notesLog.includes('deletePartyNote'), 'سجل الملاحظات بلا تعديل أو حذف')
  assert.ok(repo.includes('updatePartyNote:') || /updatePartyNote\s*:/.test(repo), 'لا إجراء تعديل ملاحظة في المخزن')
  assert.ok(repo.includes('editedBy'), 'تعديل الملاحظة لا يُختم باسم المعدِّل')
  R.ok('اسم الملاحظة زر يفتح سجل كل الملاحظات (تعديل وحذف بختم المعدِّل) وآخر ملاحظة تبقى ظاهرة في الشريط')
}

/* ⑫ شريط «الصنف المحدد» يتبع السطر النشِط في الجدول (شكوى المالك: كان لا يتغيّر) */
{
  assert.ok(table.includes('onActiveItem?: (itemId: number | null) => void'), 'جدول البنود لا يبلّغ الصنف النشِط للأعلى')
  assert.ok(/onFocusCapture=\{\(\) => setSelectedKey\(line\.key\)\}/.test(table), 'التنقل بالأسهم/Tab لا يغيّر السطر النشِط')
  assert.ok(/onClick=\{\(\) => setSelectedKey\(line\.key\)\}/.test(table), 'النقر على السطر لا يحدّده')
  assert.ok(/setSelectedKey\(lines\[lines\.length - 1\]\?\.key \?\? null\)/.test(table), 'السطر المضاف حديثاً لا يصبح النشِط')
  assert.ok(/const activeItemId = \(lines\.find\(\(line\) => line\.key === selectedKey\) \?\? lines\[lines\.length - 1\]\)\?\.itemId/.test(table), 'الصنف النشِط لا يُشتق من السطر المحدد ثم آخر سطر')
  for (const [label, src] of [['المبيعات', sales], ['المشتريات', purchase]]) {
    assert.ok(src.includes('onActiveItem={setActiveItemId}'), `${label}: الصفحة لا تستقبل الصنف النشِط من الجدول`)
    assert.ok(/const focusedItem=\(activeItemId!=null\?items\.find\(item=>item\.id===activeItemId\):null\)\?\?/.test(src), `${label}: شريط الصنف ما زال مربوطاً بآخر سطر فقط`)
  }
  R.ok('شريط «الصنف المحدد» يتبع السطر النشِط: بالنقر · بالأسهم · وعند إضافة سطر جديد')
}

/* ⑬ فاتورة الشراء أخذت نفس دفعة المالك: نمط · شروط · زر مصاريف · بلا شارات */
{
  assert.ok(/const fullFields=mode==='profit'\|\|mode==='advanced'/.test(purchase) && /const showStrips=mode!=='simple'/.test(purchase), 'فاتورة الشراء لا تتبع نمط المحرِّر في رأسها')
  for (const field of ['الاستحقاق', 'المرجع']) {
    const at = purchase.indexOf(`<Field label="${field}"`)
    assert.ok(at > 0 && purchase.slice(at - 16, at).includes('fullFields&&'), `فاتورة الشراء: حقل «${field}» يظهر في النمط المبسط`)
  }
  assert.ok(purchase.includes('partyMeta={showStrips?') && purchase.includes('itemProfile={showStrips?'), 'فاتورة الشراء: الشريطان لا يتبعان النمط')
  for (const badge of ['شراء نقدي', 'اليوم', 'فوري', 'يستلم البضاعة']) {
    const head = purchase.slice(purchase.indexOf('<Field label="المورد"'), purchase.indexOf('partyMeta='))
    assert.ok(!head.includes(`badge={!selectedSupplier?'${badge}'`) && !head.includes(`badge="${badge}"`), `فاتورة الشراء: شارة «${badge}» ما زالت في الترويسة`)
  }
  assert.ok(purchase.includes('invoice-doc-termsbox'), 'فاتورة الشراء بلا مربع شروط')
  const panel = purchase.slice(purchase.indexOf('data-invoice-terms'), purchase.indexOf('data-invoice-terms') + 2600)
  assert.ok(panel.indexOf('invoice-doc-termsbox') < panel.indexOf('invoice-doc-addons'), 'فاتورة الشراء: أزرار المصاريف ليست أسفل مربع الشروط')
  assert.ok(panel.includes('مصاريف الشراء'), 'فاتورة الشراء: لا زر لإضافة المصاريف داخل بوكس الشروط')
  assert.ok(purchase.includes('invoice-doc-notebtn') && purchase.includes('<PartyNotesLog kind="supplier"'), 'فاتورة الشراء: اسم الملاحظة ليس زراً يفتح سجل ملاحظات المورد')
  R.ok('فاتورة الشراء: حقول حسب النمط · بلا شارات · مربع شروط بزر مصاريف داخله · سجل ملاحظات المورد')
}

/* ⑭ ما يتحمله المحل أو المخزون لا يدخل إجمالي فاتورة الطرف */
{
  // البيع: الإجمالي من totals (بنود − خصم + ضريبة + مصروفات العميل) والمصروف الداخلي سطر معلومة
  assert.ok(/totalMinor:base\.totalMinor\+chargeNet\+chargeTax/.test(sales), 'إجمالي فاتورة البيع لا يقتصر على البنود ومصروفات العميل')
  const totalsMemo = sales.slice(sales.indexOf('const totals=useMemo('), sales.indexOf('customerCharges]);'))
  assert.ok(!/internal|expenses|commission/i.test(totalsMemo), 'المصروفات الداخلية/العمولات تسرّبت إلى حساب إجمالي فاتورة العميل')
  assert.ok(sales.includes('مصاريف على المحل — لا تدخل إجمالي العميل'), 'فاتورة البيع: المصروف الداخلي غير معلَّم كخارج الإجمالي')
  assert.ok(/<Row n="مصاريف على المحل — لا تدخل إجمالي العميل" v=\{internalTotal\} info\/>/.test(sales), 'المصروف الداخلي يجب أن يكون سطر معلومة لا مبلغاً يُطرح')
  // الشراء: الإجمالي الكبير = مستحق المورد، والتحميل على المخزون/المحل خارجه
  /* صار الرقم يمر بعدّاد حي (دفعة ⑭) فيُقرأ من AnimatedMinor بدل formatMinor مباشرة */
  assert.ok(/invoice-doc-grand"><span>إجمالي فاتورة المورد<\/span><b><AnimatedMinor value=\{supplierDue\}/.test(purchase),
    'إجمالي فاتورة الشراء ليس مستحق المورد')
  assert.ok(purchase.includes('مصاريف محمَّلة على المخزون (خارج الإجمالي)') && purchase.includes('invoice-doc-suminfo'), 'فاتورة الشراء: التحميل على المخزون ما زال داخل الإجمالي')
  assert.ok(purchase.includes('تكلفة البضاعة بعد التحميل'), 'فاتورة الشراء: اختفت تكلفة البضاعة بعد التحميل (تلزم للتسعير)')
  assert.ok(css.includes('.invoice-doc .invoice-doc-sum-row.is-info'), 'لا نمط لسطور «معلومة فقط» في كشف الإجماليات')
  R.ok('الإجمالي = ما يطالب به الطرف فقط: مصاريف المحل والمخزون سطور معلومة خارج إجمالي الفاتورة')
}

R.done()
