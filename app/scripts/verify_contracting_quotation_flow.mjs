#!/usr/bin/env node
/**
 * بوابة دورة عروض الأسعار والمقاولات (بلاغات المالك 2026-10-17):
 *   ① إجماليات عرض السعر: الإجمالي ← الضريبة ← الإجمالي بالضريبة، وبلا «المحصل/المتبقي»
 *      في المحرر والمطبوعة (عرض السعر ليس مستند تحصيل).
 *   ② تنقل خلايا عرض السعر مثل الفاتورة (أسهم + Enter متسلسل) بلا قوائم منبثقة.
 *   ③ عرض السعر دائماً لعميل مسجَّل + زر إرسال PDF واتساب لكل عرض.
 *   ④ فاتورة المقاولات ببنود حرة تُكتب يدوياً وتُرحَّل بمحرك فاتورة البيع (postSale).
 *   ⑤ «فاتورة بيع لهذا المشروع» تُعبّئ بنود المشروع (BOQ) تلقائياً — لا مشروعاً فقط،
 *      ومعاينة بنود المشروع حرة في نافذة العرض بعد إنشائه.
 *   ⑥ البند الحر ⇒ صنف خدمة مضمون (لا سطر بـ itemId=0 يتعطل اعتماده).
 *   ⑦ صرف المواد للمشروع: خصم المخزون بالوحدة الأساسية + قيد 5110/1103 + تكلفة
 *      مشروع «مواد» + سجل حركة (حيّاً)، والسندات تحمل projectId (§95).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(appRoot, rel), 'utf8')
let pass = 0
const fails = []
const ok = (name, cond) => (cond ? (pass++, console.log('  ✓ ' + name)) : fails.push(name))

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
}
globalThis.window = globalThis

/* ── ① إجماليات العرض: الترتيب وبلا تحصيل ─────────────────────────────────── */
const quotSrc = read('src/ui/pages/QuotationsPage.tsx')
const netIdx = quotSrc.indexOf('data-quotation-sum-net')
const taxIdx = quotSrc.indexOf('data-quotation-sum-tax')
const grossIdx = quotSrc.indexOf('data-quotation-sum-gross')
ok('① لوحة إجماليات العرض: الإجمالي ثم الضريبة ثم الإجمالي بالضريبة', netIdx > 0 && taxIdx > netIdx && grossIdx > taxIdx)
ok('① لا كلمة «المحصل» في شاشة عرض السعر إطلاقاً', !quotSrc.includes('المحصل'))
ok('① نموذج الطباعة بلا مدفوع/متبقي (paidMinor = الإجمالي)', quotSrc.includes('paidMinor: draftTax.grossMinor') && quotSrc.includes('paidMinor: t.grossMinor'))
ok('① الضريبة تُمرَّر لنموذج الطباعة (سطر الضريبة يظهر)', quotSrc.includes("tax: { label: 'الضريبة'"))
const receiptSrc = read('src/core/receipt.ts')
ok('① buildSimpleDocModel يدعم ضريبة المستند (tax option)', /tax\?: \{ label: string; minor: Minor; baseMinor: Minor \}/.test(receiptSrc))

/* ── ② تنقل مثل الفاتورة ──────────────────────────────────────────────────── */
ok('② عرض السعر يستعمل مساعد تنقل الفاتورة', quotSrc.includes("import { gridArrowNavigation } from '../components/gridArrowNavigation.ts'") && quotSrc.includes('<tbody onKeyDown={gridArrowNavigation}>'))
const navSrc = read('src/ui/components/gridArrowNavigation.ts')
ok('② مساعد التنقل بملف مستقل مُصدَّر (أسهم بين الخلايا والسطور)', navSrc.includes('export function gridArrowNavigation') && navSrc.includes('ArrowDown'))
ok('② Enter متسلسل: كمية ← سعر ← سطر جديد', quotSrc.includes("if (e.key !== 'Enter') return") && quotSrc.includes('setQLines((arr) => [...arr,'))
ok('② البنود تبقى جدولاً حراً بلا قوائم منبثقة (لا ItemQuickPicker في العرض)', !quotSrc.includes('ItemQuickPicker'))

/* ── ③ عميل مسجَّل + واتساب ───────────────────────────────────────────────── */
const coreSrc = read('src/core/contracting.ts')
ok('③ النواة تفرض عميلاً مسجلاً لعرض السعر', coreSrc.includes('عرض السعر دائماً لعميل مسجَّل'))
ok('③ الواجهة تمرر clientId للنواة وتعرض مانعاً', quotSrc.includes('clientId: clientId ? Number(clientId) : null') && quotSrc.includes('اختر عميلاً مسجلاً قبل الاعتماد'))
ok('③ زر واتساب PDF لكل عرض في القائمة', quotSrc.includes('data-quotation-whatsapp') && quotSrc.includes('shareDocPdfViaWhatsapp'))
ok('③ واتساب العرض يمرر هاتف العميل المسجَّل', quotSrc.includes("customers.find((c) => c.id === q.clientId)?.phone"))

/* ── ④ فاتورة المقاولات الحرة ─────────────────────────────────────────────── */
const ciSrc = read('src/ui/pages/ContractingInvoicesPage.tsx')
ok('④ محرر فاتورة مقاولات ببنود حرة موجود', ciSrc.includes('data-contracting-free-editor'))
ok('④ تُرحَّل بمحرك فاتورة البيع (postSale)', ciSrc.includes('const sale = postSale({'))
ok('④ بنودها أصناف خدمة مضمونة (بلا مخزون)', ciSrc.includes('ensureServiceItemForFreeLine({ nameAr: l.nameAr'))
ok('④ إجمالياتها بنفس الترتيب المطلوب', ciSrc.includes('<span>الإجمالي</span>') && ciSrc.includes('<span>الضريبة') && ciSrc.includes('<span>الإجمالي بالضريبة</span>'))
ok('④ تنقل خلاياها مثل الفاتورة', ciSrc.includes('<tbody onKeyDown={gridArrowNavigation}>'))
ok('④ تعبئة من بنود المشروع (BOQ) بضغطة', ciSrc.includes('fillFromBoq') && ciSrc.includes('تعبئة من بنود المشروع'))
ok('④ واتساب PDF لكل فاتورة مقاولات في الجدول', ciSrc.includes('data-contracting-invoice-whatsapp'))

/* ──  الفاتورة من المشروع + المعاينة الحرة ───────────────────────────────── */
const cpSrc = read('src/ui/pages/ContractingPages.tsx')
ok('⑤ «فاتورة بيع لهذا المشروع» تعبّئ بنود BOQ تلقائياً', cpSrc.includes('lines: boq.map((b) => ({') && cpSrc.includes('ensureServiceItemForFreeLine({ nameAr: b.descriptionAr'))
ok('⑤ معاينة بنود المشروع حرة في نافذة العرض', cpSrc.includes('data-project-boq-preview') && cpSrc.includes('جدول الكميات (BOQ)'))
const saleSrc = read('src/ui/pages/AdvancedSalesInvoicePage.tsx')
ok('⑥ لا سطر حر بـ itemId=0 في الفاتورة المتقدمة', !saleSrc.includes('itemId:match?.id??0') && saleSrc.includes('ensureServiceItemForFreeLine({nameAr'))

/* ── ⑦ السندات والصرف ────────────────────────────────────────────────────── */
const repoSrc = read('src/data/repo.ts')
ok('⑦ السندات (قبض/صرف) تحمل مشروع مقاولات (§95)', /postVoucher: \(args/.test(repoSrc) && repoSrc.includes('§95: مشروع مقاولات اختياري على السند'))
const opsSrc = read('src/core/projectOps.ts')
ok('⑦ قيد صرف المواد 5110 تكاليف مشروعات / 1103 مخزون', opsSrc.includes("'5110'") && opsSrc.includes("'1103'"))
ok('⑦ الصرف يحوّل للوحدة الأساسية ويرفض تجاوز المتاح', opsSrc.includes('baseQty > available'))

/* ── فحوص حيّة: صنف الخدمة المضمون + فرض العميل + حساب صرف المواد ─────────── */
const { validateQuotation } = await import(pathToFileURL(join(appRoot, 'src/core/contracting.ts')).href)
const line = { nameAr: 'بند', descriptionAr: 'وصف بند', qty: 2, unitAr: 'م2', unitPriceMinor: 1000, estCostMinor: 500, vatPercent: 0, taxIncluded: false }
const errsNoClient = validateQuotation({ titleAr: 'عرض', clientName: 'جهة', clientId: null, lines: [line] })
ok('③ حيّاً: عرض بلا عميل مسجَّل مرفوض', errsNoClient.some((e) => e.includes('عميل مسجَّل')))
const errsWithClient = validateQuotation({ titleAr: 'عرض', clientName: 'جهة', clientId: 5, lines: [line] })
ok('③ حيّاً: عرض بعميل مسجَّل مقبول', errsWithClient.length === 0)

const { useDataStore } = await import(pathToFileURL(join(appRoot, 'src/data/repo.ts')).href)
const id1 = useDataStore.getState().ensureServiceItemForFreeLine({ nameAr: 'بند حر تجريبي', unitAr: 'م2', priceMinor: 50000 })
const id2 = useDataStore.getState().ensureServiceItemForFreeLine({ nameAr: 'بند حر تجريبي', unitAr: 'م2', priceMinor: 50000 })
ok('⑥ حيّاً: البند الحر يعيد نفس صنف الخدمة (لا تكرار)', id1 === id2 && id1 > 0)
const svc = useDataStore.getState().items.find((it) => it.id === id1)
ok('⑥ حيّاً: الصنف المضمون خدمة بلا مخزون', svc?.isService === true && svc.stockQty === 0)

useDataStore.setState({
  employees: [
    { id: 1, nameAr: 'أمين المخزن', active: true },
    { id: 2, nameAr: 'مهندس الموقع', active: true },
  ],
  projects: [{ id: 700, code: 'PRJ-9', nameAr: 'مشروع تجريبي', clientName: 'جهة', clientId: null, contractValueMinor: 1_000_000, retentionPercent: 5, startDate: '2026-01-01', status: 'active', notes: '' }],
})
useDataStore.setState({
  items: [...useDataStore.getState().items, {
    id: 9001, nameAr: 'أسمنت', sku: 'ITM-9001', barcodes: [], categoryId: 0, baseUnit: 'طن', extraUnits: [],
    costMinor: 100_000, stockQty: 10, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
    soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
  }],
})
const req = useDataStore.getState().issueMaterials({ projectId: 700, issuedByEmployeeId: 1, receivedByEmployeeId: 2, lines: [{ itemId: 9001, qty: 4, unitAr: '' }], notes: 'صرف تجريبي' })
const after = useDataStore.getState().items.find((it) => it.id === 9001)
ok('⑦ حيّاً: المخزون خُصم بالوحدة الأساسية (10 ← 6)', after?.stockQty === 6)
ok('⑦ حيّاً: تكلفة الصرف = كمية × متوسط (4 × 100000)', req.totalCostMinor === 400_000)
const entry = useDataStore.getState().journal.find((j) => j.id === req.journalEntryId)
ok('⑦ حيّاً: القيد 5110 مدين / 1103 دائن', !!entry && entry.lines.some((l) => l.accountCode === '5110' && l.debit === 400_000) && entry.lines.some((l) => l.accountCode === '1103' && l.credit === 400_000))
const cost = useDataStore.getState().projectCosts.find((c) => c.source === 'material_issue' && c.projectId === 700)
ok('⑦ حيّاً: التكلفة دخلت تكاليف المشروع «مواد»', cost?.kind === 'materials' && cost.amountMinor === 400_000)
const move = useDataStore.getState().stockMoves.find((m) => m.docType === 'material_issue' && m.docId === req.id)
ok('⑦ حيّاً: سجل حركة المخزون سالب بالكمية الأساسية', move?.qtyDelta === -4 && move.balanceAfter === 6)
let overBlocked = false
try { useDataStore.getState().issueMaterials({ projectId: 700, issuedByEmployeeId: 1, receivedByEmployeeId: 2, lines: [{ itemId: 9001, qty: 100, unitAr: '' }], notes: '' }) } catch { overBlocked = true }
ok('⑦ حيّاً: الصرف فوق المتاح مرفوض (لا مخزون سالب)', overBlocked)

console.log(`\nPASS=${pass} FAIL=${fails.length}${fails.length ? '\n' + fails.join('\n') : ''}`)
if (fails.length) process.exit(1)
