#!/usr/bin/env node
/**
 * verify_receipt — فحص نموذج الإيصال الحراري وقالب HTML
 * node --experimental-strip-types scripts/verify_receipt.mjs
 */
import { strict as assert } from 'node:assert'
import { buildReceiptModel, DEFAULT_RECEIPT_SETTINGS } from '../src/core/receipt.ts'
import { renderReceiptHtml } from '../src/ui/print/printReceipt.ts'
import { renderInvoiceA4Html, numberToArabicWords, amountInWords } from '../src/ui/print/printInvoiceA4.ts'
import { computeTotals } from '../src/core/pos.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

const cur = { code: 'EGP', symbol: 'ج.م', decimals: 2, name: 'جنيه' }
const lines = [
  { itemId: 1, nameAr: 'لبن', qty: 2, unitPriceMinor: 3500, unitCostMinor: 2800, discountPercent: 0, soldByWeight: false },
  { itemId: 2, nameAr: 'جبنة رومي', qty: 0.75, unitPriceMinor: 26000, unitCostMinor: 21000, discountPercent: 10, soldByWeight: true },
]
const totals = computeTotals(lines, 0, 14, true)
const settings = { ...DEFAULT_RECEIPT_SETTINGS, shopName: 'بقالة النور', headerLines: ['المنصورة', 'ت: 0501234567'] }

const model = buildReceiptModel({
  invoiceNumber: 'S-0042',
  dateIso: '2026-09-14T22:30:00.000Z',
  lines, totals,
  payment: 'cash',
  customerName: null,
  taxPercent: 14,
  taxInclusive: true,
  settings,
})

console.log('🔍 نموذج الإيصال')

ok('البيانات الأساسية: رقم وتاريخ وعميل نقدي', () => {
  assert.equal(model.invoiceNumber, 'S-0042')
  assert.equal(model.dateLabel, '2026-09-14 22:30')
  assert.equal(model.customerName, 'عميل نقدي')
  assert.equal(model.paymentLabel, 'نقدي')
})

ok('الصنف الوزني يظهر «0.75 كجم» والعادي رقماً', () => {
  assert.equal(model.rows[0].qtyLabel, '2')
  assert.equal(model.rows[1].qtyLabel, '0.75 كجم')
})

ok('إجمالي السطر بعد خصمه (جبنة 10٪)', () => {
  assert.equal(model.rows[1].totalMinor, Math.round(26000 * 0.75 * 0.9)) // 17550
})

ok('الإجماليات من totals المحفوظة لا من إعادة حساب', () => {
  assert.equal(model.totalMinor, totals.totalMinor)
  assert.equal(model.discountMinor, totals.discountMinor)
  assert.equal(model.taxMinor, totals.taxMinor)
})

ok('عدد الأصناف والقطع (الوزني بقيمته)', () => {
  assert.equal(model.itemCount, 2)
  assert.equal(model.totalQty, 2.75)
})

ok('ملخص الضريبة: 14٪ مشمولة', () => {
  assert.ok(model.taxLabel.includes('14٪'))
  assert.ok(model.taxLabel.includes('مشمولة'))
})

ok('إخفاء الضريبة عند تعطيل الملخص أو ضريبة صفرية', () => {
  const noTax = buildReceiptModel({
    invoiceNumber: 'S-1', dateIso: '2026-01-01T00:00:00Z', lines,
    totals: computeTotals(lines, 0, 0, true),
    payment: 'cash', customerName: null, taxPercent: 0, taxInclusive: true, settings,
  })
  assert.equal(noTax.taxLabel, null)
  const hidden = buildReceiptModel({
    invoiceNumber: 'S-2', dateIso: '2026-01-01T00:00:00Z', lines, totals,
    payment: 'cash', customerName: null, taxPercent: 14, taxInclusive: true,
    settings: { ...settings, showTaxSummary: false },
  })
  assert.equal(hidden.taxLabel, null)
})

ok('اسم العميل الآجل يظهر', () => {
  const m = buildReceiptModel({
    invoiceNumber: 'S-3', dateIso: '2026-01-01T00:00:00Z', lines, totals,
    payment: 'credit', customerName: 'أحمد سعد', taxPercent: 14, taxInclusive: true, settings,
  })
  assert.equal(m.customerName, 'أحمد سعد')
  assert.equal(m.paymentLabel, 'آجل')
})

console.log('🔍 قالب HTML الحراري')

ok('HTML عربي RTL بمقاس 72مم للورق 80', () => {
  const html = renderReceiptHtml(model, cur, settings)
  assert.ok(html.includes('dir="rtl"'))
  assert.ok(html.includes('size: 72mm auto'))
  assert.ok(html.includes('بقالة النور'))
  assert.ok(html.includes('S-0042'))
})

ok('مقاس 48مم للورق 58', () => {
  assert.ok(renderReceiptHtml(model, cur, { ...settings, paperWidth: '58' }).includes('size: 48mm auto'))
})

ok('كل الأصناف وسطور الترويسة والتذييل موجودة', () => {
  const html = renderReceiptHtml(model, cur, settings)
  assert.ok(html.includes('لبن'))
  assert.ok(html.includes('جبنة رومي'))
  assert.ok(html.includes('المنصورة'))
  assert.ok(html.includes('شكراً لزيارتكم'))
})

ok('مفاتيح الإخفاء تعمل على الحراري: عميل/تاريخ/عدّادات/تذييل', () => {
  const hidden = renderReceiptHtml(model, cur, {
    ...settings, showCustomer: false, showDate: false, showItemCounts: false, showFooter: false,
  })
  assert.ok(!hidden.includes('العميل:'))
  assert.ok(!hidden.includes('2026-09-14'))
  assert.ok(!hidden.includes('عدد الأصناف'))
  assert.ok(!hidden.includes('شكراً لزيارتكم'))
  assert.ok(hidden.includes('S-0042')) // رقم الفاتورة لا يُخفى أبداً
})

ok('الشعار يظهر على الحراري عند تفعيله فقط', () => {
  const logo = 'data:image/png;base64,AAA'
  const withLogo = renderReceiptHtml(model, cur, { ...settings, logoDataUrl: logo, showLogo: true })
  assert.ok(withLogo.includes(logo))
  const noLogo = renderReceiptHtml(model, cur, { ...settings, logoDataUrl: logo, showLogo: false })
  assert.ok(!noLogo.includes(logo))
})

ok('تهريب HTML: اسم خبيث لا يُحقن', () => {
  const evil = buildReceiptModel({
    invoiceNumber: 'S-9', dateIso: '2026-01-01T00:00:00Z',
    lines: [{ itemId: 1, nameAr: '<script>alert(1)</script>', qty: 1, unitPriceMinor: 100, unitCostMinor: 50, discountPercent: 0, soldByWeight: false }],
    totals: computeTotals([{ itemId: 1, nameAr: 'x', qty: 1, unitPriceMinor: 100, unitCostMinor: 50, discountPercent: 0, soldByWeight: false }], 0, 0, true),
    payment: 'cash', customerName: null, taxPercent: 0, taxInclusive: true, settings,
  })
  const html = renderReceiptHtml(evil, cur, '80')
  assert.ok(!html.includes('<script>alert'))
  assert.ok(html.includes('&lt;script&gt;'))
})

console.log('🔍 قالب فاتورة A4 والتفقيط')

ok('الإعداد الافتراضي: القالب حراري', () => {
  assert.equal(DEFAULT_RECEIPT_SETTINGS.defaultTemplate, 'thermal')
})

ok('تفقيط الأعداد: صفر ومفرد ومثنى وعقود', () => {
  assert.equal(numberToArabicWords(0), 'صفر')
  assert.equal(numberToArabicWords(1), 'واحد')
  assert.equal(numberToArabicWords(2), 'اثنان')
  assert.equal(numberToArabicWords(25), 'خمسة وعشرون')
  assert.equal(numberToArabicWords(130), 'مائة وثلاثون')
})

ok('تفقيط المئات والآلاف والملايين', () => {
  assert.equal(numberToArabicWords(200), 'مائتان')
  assert.equal(numberToArabicWords(2000), 'ألفان')
  assert.equal(numberToArabicWords(3500), 'ثلاثة آلاف وخمسمائة')
  assert.equal(numberToArabicWords(1000000), 'مليون')
  assert.equal(numberToArabicWords(2000000), 'مليونان')
})

ok('المبلغ كتابةً: كسور وعملة و"فقط لا غير"', () => {
  const w = amountInWords(13050, cur) // 130.50 ج.م
  assert.ok(w.includes('مائة وثلاثون'))
  assert.ok(w.includes('جنيه'))
  assert.ok(w.includes('خمسون'))
  assert.ok(w.endsWith('فقط لا غير'))
  const whole = amountInWords(20000, cur) // 200.00
  assert.ok(whole.includes('مائتان'))
  assert.ok(!whole.includes('من المائة'))
})

ok('نموذج الإيصال يحمل الوعاء الضريبي taxBaseMinor', () => {
  assert.equal(model.taxBaseMinor, totals.taxBaseMinor)
  assert.ok(model.taxBaseMinor > 0)
})

ok('HTML للـ A4: مقاس A4 واتجاه RTL ورقم الفاتورة', () => {
  const html = renderInvoiceA4Html(model, cur, settings)
  assert.ok(html.includes('size: A4'))
  assert.ok(html.includes('dir="rtl"'))
  assert.ok(html.includes('S-0042'))
  assert.ok(html.includes('بقالة النور'))
  assert.ok(html.includes('فاتورة مبيعات'))
})

ok('A4 يتضمن التفقيط والأصناف والتذييل', () => {
  const html = renderInvoiceA4Html(model, cur, settings)
  assert.ok(html.includes('فقط لا غير'))
  assert.ok(html.includes('جبنة رومي'))
  assert.ok(html.includes('شكراً لزيارتكم'))
})

ok('الأنماط الأربعة تُنتج قوالب مختلفة صحيحة', () => {
  for (const style of ['modern', 'classic', 'compact', 'elegant']) {
    const html = renderInvoiceA4Html(model, cur, { ...settings, a4Style: style })
    assert.ok(html.includes(`class="sheet ${style}"`), `النمط ${style} غائب`)
    assert.ok(html.includes('S-0042'))
  }
})

ok('العلامة المائية: تظهر مفعّلة وتختفي معطّلة وتُهرَّب', () => {
  const on = renderInvoiceA4Html(model, cur, { ...settings, watermarkEnabled: true, watermarkText: 'بقالة <النور>' })
  assert.ok(on.includes('class="wm"'))
  assert.ok(on.includes('بقالة &lt;النور&gt;'))
  const off = renderInvoiceA4Html(model, cur, { ...settings, watermarkEnabled: false, watermarkText: 'بقالة النور' })
  assert.ok(!off.includes('class="wm"'))
  const empty = renderInvoiceA4Html(model, cur, { ...settings, watermarkEnabled: true, watermarkText: '  ' })
  assert.ok(!empty.includes('class="wm"'))
})

ok('الشعار على A4 عند التفعيل فقط', () => {
  const logo = 'data:image/png;base64,BBB'
  assert.ok(renderInvoiceA4Html(model, cur, { ...settings, logoDataUrl: logo, showLogo: true }).includes(logo))
  assert.ok(!renderInvoiceA4Html(model, cur, { ...settings, logoDataUrl: logo, showLogo: false }).includes(logo))
})

ok('إخفاء التفقيط والتوقيعات من A4 يعمل', () => {
  const html = renderInvoiceA4Html(model, cur, { ...settings, showWords: false, showSignatures: false })
  assert.ok(!html.includes('فقط لا غير'))
  assert.ok(!html.includes('توقيع البائع'))
})

ok('اللون الرئيسي يُطبَّق والقيم الخبيثة تُرفض', () => {
  const html = renderInvoiceA4Html(model, cur, { ...settings, accentColor: '#e11d48' })
  assert.ok(html.includes('#e11d48'))
  const bad = renderInvoiceA4Html(model, cur, { ...settings, accentColor: 'red;}</style><script>' })
  assert.ok(!bad.includes('<script>'))
})

ok('تهريب HTML في قالب A4 أيضاً', () => {
  const evil = buildReceiptModel({
    invoiceNumber: 'S-9', dateIso: '2026-01-01T00:00:00Z',
    lines: [{ itemId: 1, nameAr: '<img src=x onerror=1>', qty: 1, unitPriceMinor: 100, unitCostMinor: 50, discountPercent: 0, soldByWeight: false }],
    totals: computeTotals([{ itemId: 1, nameAr: 'x', qty: 1, unitPriceMinor: 100, unitCostMinor: 50, discountPercent: 0, soldByWeight: false }], 0, 0, true),
    payment: 'cash', customerName: null, taxPercent: 0, taxInclusive: true, settings,
  })
  const html = renderInvoiceA4Html(evil, cur, settings)
  assert.ok(!html.includes('<img src=x'))
  assert.ok(html.includes('&lt;img'))
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
