/**
 * تجربة مستند الفاتورة — دفعة بلاغات المالك (٢٠٢٦-٠٩-٢٨):
 *
 *   ① «أي فاتورة أو معاملة تُفتح بضغطتين».
 *   ② «رأس الجدول ما زال يغطي رسالة تأكيد إغلاق الفاتورة».
 *   ③ «أريد زراً لمعاينة كل المسودات واختيار واحدة، وباسم العميل».
 *   ④ «لو اخترت تراجع عن التعديل فأغلقها ما لم أحفظها كمسودة».
 *   ⑤ «نبّهني أن المسودة ستُحذف».
 *   ⑥ «تقسيم حقول جدول الأصناف غير متناسق».
 *   ⑦ «حجم العناصر أعلى الفاتورة كبير جداً والجدول يختفي لأسفل».
 *
 * تشغيل: node --experimental-strip-types scripts/verify_invoice_document_ux.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reporter } from './auditKit.mjs'

const R = reporter('مستند الفاتورة — فتح بضغطتين · تأكيد إغلاق يعلو كل شيء · مسودات باسم العميل')
const ROOT = '/home/user/shopsys/app/src'
const read = (rel) => readFileSync(`${ROOT}/${rel}`, 'utf8')
const css = read('index.css')
const frame = read('ui/components/InvoicePOSFrame.tsx')
const table = read('ui/components/InvoiceLinesTable.tsx')
const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')
const purchase = read('ui/pages/AdvancedPurchaseInvoicePage.tsx')
const store = read('ui/windows/windowStore.ts')

/** جسم قاعدة CSS لمحدِّد بعينه */
const ruleOf = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`(^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`))
  assert.ok(m, `قاعدة مفقودة في index.css: ${selector}`)
  return m[2]
}
const remOf = (body, prop) => {
  const m = body.match(new RegExp(`${prop}:\\s*([\\d.]+)rem`))
  if (m) return Number(m[1])
  return new RegExp(`${prop}:\\s*0\\s*[;}]`).test(body) ? 0 : null
}

/* ① فتح أي مستند/معاملة بالنقر المزدوج */
{
  const helper = read('ui/components/rowOpen.ts')
  assert.ok(/onDoubleClick/.test(helper) && /Enter/.test(helper), 'مساعد الفتح لا يدعم النقر المزدوج وEnter')
  assert.ok(/closest\(INTERACTIVE\)/.test(helper), 'النقر المزدوج فوق زر داخل السطر سيفتح المستند بالخطأ')
  const pages = [
    ['SalesInvoicesPage', 'فواتير البيع'],
    ['PurchasesPage', 'فواتير الشراء'],
    ['SaleReturnsPage', 'مرتجعات البيع'],
    ['PurchaseReturnsPage', 'مرتجعات الشراء'],
    ['InstallmentsPage', 'خطط التقسيط'],
    ['ItemsPage', 'بطاقات الأصناف'],
  ]
  for (const [file, label] of pages) {
    const src = read(`ui/pages/${file}.tsx`)
    assert.ok(src.includes('rowOpenProps('), `${label}: السطر لا يُفتح بالنقر المزدوج`)
  }
  // القوائم التي تفتح بنقرة واحدة أصلاً (سندات/شيكات) تبقى كما هي
  for (const file of ['VouchersPage', 'ChequesPage']) {
    const src = read(`ui/pages/${file}.tsx`)
    assert.ok(/onClick=\{\(\) => setViewing\(/.test(src), `${file}: فقد فتح السطر بالنقر`)
  }
  assert.ok(/tr\[data-row-open\]\s*\{[^}]*cursor:\s*pointer/.test(css), 'لا مؤشّر يدل على أن السطر يُفتح')
  R.ok(`${pages.length} قوائم مستندات تُفتح بالنقر المزدوج (وEnter)، والأزرار داخل السطر محميّة من الفتح بالخطأ`)
}

/* ② تأكيد إغلاق النافذة ببورتال فوق كل شيء — لا رأس جدول يغطيه */
{
  const floating = read('ui/windows/FloatingWindow.tsx')
  const block = floating.slice(floating.indexOf('win.askingClose'), floating.indexOf('app-window-resize'))
  assert.ok(/<OverlayPortal>/.test(block), 'حوار التأكيد ما زال داخل شجرة النافذة')
  const askZ = Number(css.match(/--z-window-ask:\s*(\d+)/)?.[1])
  const stickyMax = Math.max(...[...css.matchAll(/position:\s*sticky[^}]*z-index:\s*(\d+)/g)].map((m) => Number(m[1])), 0)
  assert.ok(askZ > stickyMax + 100, `طبقة التأكيد ${askZ} قريبة من أعلى رأس لاصق ${stickyMax}`)
  R.ok(`حوار تأكيد الإغلاق يخرج إلى body بطبقة ${askZ} — أعلى رأس لاصق في المشروع ${stickyMax}`)
}

/* ③ + ④ + ⑤ خيارات الإغلاق: حفظ كمسودة · حذف صريح · تحذير مكتوب */
{
  assert.ok(/WindowClosePrompt/.test(store), 'المتجر لا يعرف محتوى حوار الإغلاق')
  assert.ok(/discardAndCloseWindow/.test(store), 'لا يوجد مسار «إغلاق مع تنظيف المسودة»')
  const floating = read('ui/windows/FloatingWindow.tsx')
  assert.ok(/data-window-close-save/.test(floating), 'زر «حفظ ثم إغلاق» غير موجود في حوار التأكيد')
  assert.ok(/discardAndCloseWindow\(win\.id\)/.test(floating), 'زر الإغلاق لا يمرّ بمسار التنظيف')
  for (const [src, label] of [[sales, 'فاتورة البيع'], [purchase, 'فاتورة الشراء']]) {
    assert.ok(src.includes('setClosePrompt'), `${label}: لا تسجّل محتوى حوار الإغلاق`)
    assert.ok(/يمسح ما كتبته نهائياً/.test(src), `${label}: لا تحذير صريح بأن المسودة ستُحذف`)
    assert.ok(/saveLabel:'حفظ كمسودة ثم الإغلاق'/.test(src), `${label}: لا زر حفظ كمسودة في حوار الإغلاق`)
    assert.ok(/onDiscard:\(\)=>closeActionsRef\.current\.discard\(\)/.test(src), `${label}: الإغلاق بلا حفظ لا يحذف المسودة`)
  }
  R.ok('حوار الإغلاق يعرض: متابعة العمل · حفظ كمسودة ثم الإغلاق · إغلاق وحذف المسودة — مع تحذير مكتوب بما يُفقد')
}

/* ⑥ متصفّح المسودات: كل المسودات باسم الطرف لا «آخر مسودة» صامتة */
{
  const modal = read('ui/components/InvoiceDraftsModal.tsx')
  assert.ok(/InvoiceDraftsModal/.test(sales) && /InvoiceDraftsModal/.test(purchase), 'صفحتا الفاتورة لا تفتحان متصفّح المسودات')
  for (const [src, label] of [[sales, 'البيع'], [purchase, 'الشراء']]) {
    assert.ok(/const restoreDraft=\(\)=>setDraftsOpen\(true\)/.test(src), `${label}: الزر ما زال يستعيد آخر مسودة بلا اختيار`)
    assert.ok(/const applyDraft=\(draft:AdvancedInvoiceDraft\)/.test(src), `${label}: لا دالة لتطبيق مسودة مختارة`)
  }
  assert.ok(/summarizeDraft/.test(modal), 'متصفّح المسودات لا يعرض ملخّص كل مسودة')
  assert.ok(/onDelete/.test(modal) && /currentDraftId/.test(modal), 'متصفّح المسودات بلا حذف أو تمييز للمسودة المفتوحة')
  assert.ok(/draftCount/.test(frame), 'إطار الفاتورة لا يعرض عدد المسودات على الزر')
  R.ok('زر «المسودات» يفتح كل المسودات باسم العميل/المورد مع عدد البنود والقيمة ووقت الحفظ — وتُفتح أو تُحذف بضغطة')
}

/* ⑦ ملخّص المسودة يقرأ اسم الطرف والإجمالي من حمولة حقيقية */
{
  const { summarizeDraft } = await import('../src/ui/components/draftSummary.ts')
  const draft = {
    id: 'd1', kind: 'sale', name: 'مسودة مبيعات — شركة النور للتجارة',
    payload: JSON.stringify({ lines: [{ qty: 10, unitPriceMinor: 300000, discountPercent: 5 }, { qty: 1, unitPriceMinor: 200000 }] }),
    createdAt: '2026-09-28T09:00:00.000Z', updatedAt: '2026-09-28T09:30:00.000Z',
  }
  const summary = summarizeDraft(draft)
  assert.equal(summary.partyLabel, 'شركة النور للتجارة')
  assert.equal(summary.lineCount, 2)
  assert.equal(summary.totalMinor, 10 * 300000 * 0.95 + 200000)
  const broken = summarizeDraft({ ...draft, payload: '{oops' })
  assert.equal(broken.lineCount, 0, 'مسودة تالفة يجب ألا تُسقط الشاشة')
  R.ok(`ملخّص المسودة: «${summary.partyLabel}» · ${summary.lineCount} بنود · ${summary.totalMinor} قرشاً — والمسودة التالفة لا تكسر الشاشة`)
}

/* ⑧ سلوك متجر النوافذ فعلياً: الإغلاق بلا حفظ ينظّف ثم يغلق */
{
  const { useWindowStore } = await import('../src/ui/windows/windowStore.ts')
  const api = useWindowStore.getState()
  const id = api.openWindow({ kind: 'sales-invoice', title: 'فاتورة اختبار' })
  useWindowStore.getState().setWindowDirty(id, true)
  let cleaned = 0
  useWindowStore.getState().setWindowClosePrompt(id, {
    hint: 'ستُحذف المسودة', saveLabel: 'حفظ كمسودة ثم الإغلاق', discardLabel: 'إغلاق وحذف المسودة',
    onDiscard: () => { cleaned += 1 },
  })
  useWindowStore.getState().requestCloseWindow(id)
  assert.equal(useWindowStore.getState().windows.find((w) => w.id === id)?.askingClose, true, 'الإغلاق لم يسأل رغم وجود تعديلات')
  useWindowStore.getState().discardAndCloseWindow(id)
  assert.equal(cleaned, 1, 'الإغلاق بلا حفظ لم يحذف المسودة')
  assert.equal(useWindowStore.getState().windows.some((w) => w.id === id), false, 'النافذة لم تُغلق بعد اختيار الإغلاق')

  // نافذة نظيفة تُغلق مباشرة بلا سؤال
  const clean = useWindowStore.getState().openWindow({ kind: 'purchase-invoice', title: 'نظيفة' })
  useWindowStore.getState().requestCloseWindow(clean)
  assert.equal(useWindowStore.getState().windows.some((w) => w.id === clean), false, 'نافذة بلا تعديلات يجب أن تُغلق بلا سؤال')
  R.ok('متجر النوافذ: السؤال يظهر عند وجود تعديلات فقط، و«إغلاق وحذف المسودة» ينفّذ التنظيف ثم يغلق فعلاً')
}

/* ⑨ أعمدة جدول البنود: مقاس ومحاذاة واحدة للرأس والخلية */
{
  assert.ok(/const COL = \{/.test(table), 'لا خريطة أعمدة موحّدة في جدول البنود')
  const keys = [...table.matchAll(/^\s{2}(\w+):\s*'/gm)].map((m) => m[1])
  assert.ok(keys.length >= 8, `خريطة الأعمدة ناقصة (${keys.length})`)
  const heads = [...table.matchAll(/<th className=\{`[^`]*\$\{COL\.(\w+)\}`\}/g)].length
  const cells = [...table.matchAll(/<td[^>]*className=\{`[^`]*\$\{COL\.(\w+)\}`\}/g)].length
  assert.ok(heads >= 9 && cells >= 9, `أعمدة لا تقرأ المقاس من الخريطة (رؤوس ${heads} · خلايا ${cells})`)
  assert.ok(!/<t[hd] className="w-\[/.test(table), 'ما زالت هناك خلية تكتب عرضها يدوياً خارج الخريطة')
  assert.ok(/table-fixed/.test(table), 'الجدول ليس ثابت الأعمدة — ستتراقص الحدود مع المحتوى')
  /* قرار المالك ⑩ي: **كل** بيانات الجدول في منتصف الخلية — لا يمين ولا يسار. */
  assert.ok(/\.money-cell\s*\{[^}]*text-align:\s*center/.test(css) && /\.invoice-table-total\s*\{[^}]*text-align:\s*center/.test(css),
    'المبالغ غير موسَّطة في index.css')
  assert.ok(/tbody td,\s*\n\.invoice-doc \.invoice-lines-table thead th \{ text-align: center; \}/.test(css),
    'خلايا الجدول (رأساً وجسماً) غير موسَّطة')
  R.ok(`أعمدة الجدول موحّدة: ${heads} رأساً و${cells} خلية تقرأ من خريطة واحدة، والجدول ثابت الأعمدة`)
}

/* ⑩ ضغط أعلى المستند: شريط واحد، بلا هوامش صفحة، وبمقاسات صغيرة */
{
  assert.ok(/invoice-doc-topbar/.test(frame), 'الشريط العلوي الموحّد غير مستعمل في إطار الفاتورة')
  assert.ok(!/className="invoice-doc-utility"/.test(frame), 'ما زال هناك شريطان علويان متراكمان')
  const reset = ruleOf('.invoice-doc.invoice-pos-root')
  const rootPad = Number(reset.match(/padding:\s*([\d.]+)rem/)?.[1] ?? (/padding:\s*0/.test(reset) ? 0 : 9))
  assert.ok(/margin:\s*0/.test(reset) && rootPad <= 0.5,
    `هوامش «صفحة الفاتورة» القديمة ما زالت تسري داخل النافذة فتدفع الجدول لأسفل (padding ${rootPad}rem)`)
  const body = ruleOf('.invoice-doc-body')
  assert.ok((remOf(body, 'padding') ?? 1) <= 0.5, 'حشوة جسم المستند كبيرة')
  assert.ok((remOf(body, 'gap') ?? 1) <= 0.45, 'الفراغ بين بطاقات المستند كبير')
  const topbar = ruleOf('.invoice-doc-topbar')
  assert.ok((remOf(topbar, 'padding') ?? 1) <= 0.35, 'حشوة الشريط العلوي كبيرة')
  const actions = css.match(/\.invoice-doc-head-actions button \{([^}]*)\}/)?.[1] ?? ''
  const btnHeight = remOf(actions, 'min-height')
  assert.ok(btnHeight !== null && btnHeight <= 1.8, `أزرار أعلى الفاتورة مرتفعة (${btnHeight}rem)`)
  const fields = css.match(/\.invoice-doc input:not\(\[type=checkbox\]\):not\(\[type=radio\]\),\s*\n\.invoice-doc select \{([^}]*)\}/)?.[1] ?? ''
  assert.ok((remOf(fields, 'min-height') ?? 9) <= 1.9, 'حقول الرأس مرتفعة — تدفع الجدول خارج الشاشة')
  /* التصميم المعتمد (2026-09-28): الجدول لم يعد بسقف vh ثابت — يأخذ كل المساحة المتبقية
     داخل شبكة المستند (flex: 1) ويُمرَّر داخلياً، فلا يختفي ولا يدفع اللوحات خارج الشاشة. */
  const tableArea = css.match(/\.invoice-editor \.invoice-lines-panel \.overflow-x-auto \{([^}]*)\}/)?.[1] ?? ''
  assert.ok(/flex:\s*1/.test(tableArea) && /max-height:\s*none/.test(tableArea) && /overflow:\s*auto/.test(tableArea),
    `مساحة الجدول ليست ممتدة داخل شبكة المستند: ${tableArea}`)
  assert.ok(/grid-template-rows:\s*auto minmax\(0, 1fr\) auto/.test(ruleOf('.invoice-doc.invoice-pos-root')),
    'سطح الفاتورة ليس شبكة ثلاث مناطق تمنح الجدول ما تبقّى من الارتفاع')
  R.ok(`أعلى المستند مضغوط: شريط واحد بحشوة ${remOf(topbar, 'padding')}rem وأزرار ${btnHeight}rem، والجدول يأخذ كل المساحة المتبقية ويُمرَّر داخلياً`)
}

/* ⑪ لا سؤال بلا سبب: ما يملؤه النظام تلقائياً لا يُحسب تعديلاً من المستخدم */
{
  // ملء «المدفوع» تلقائياً في البيع النقدي كان يجعل فاتورة فارغة «فيها تعديلات»،
  // فيسأل حوار الإغلاق بلا أن يكتب المستخدم حرفاً — والمالك اشتكى من ذلك صراحة.
  for (const [label, src] of [['المبيعات', sales], ['المشتريات', purchase]]) {
    const sig = src.match(/const invoiceSignature=JSON\.stringify\(\{([^}]*)\}/)?.[1] ?? ''
    assert.ok(sig, `بصمة فاتورة ${label} غير موجودة`)
    assert.ok(/paid:paidTouched\.current\?paid:''/.test(sig),
      `فاتورة ${label}: المدفوع المملوء تلقائياً يدخل بصمة التعديلات فتسأل الفاتورة الفارغة عند الإغلاق`)
    assert.ok(/paidTouched\.current=true/.test(src), `فاتورة ${label}: لا شيء يعلّم أن المستخدم لمس المدفوع`)
  }
  R.ok('الفاتورة الفارغة تُغلق بلا سؤال: المدفوع المملوء تلقائياً خارج بصمة التعديلات حتى يلمسه المستخدم')
}

R.done()
