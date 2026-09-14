#!/usr/bin/env node
/**
 * verify_receipt — فحص نموذج الإيصال الحراري وقالب HTML
 * node --experimental-strip-types scripts/verify_receipt.mjs
 */
import { strict as assert } from 'node:assert'
import { buildReceiptModel, DEFAULT_RECEIPT_SETTINGS } from '../src/core/receipt.ts'
import { renderReceiptHtml } from '../src/ui/print/printReceipt.ts'
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
  const html = renderReceiptHtml(model, cur, '80')
  assert.ok(html.includes('dir="rtl"'))
  assert.ok(html.includes('size: 72mm auto'))
  assert.ok(html.includes('بقالة النور'))
  assert.ok(html.includes('S-0042'))
})

ok('مقاس 48مم للورق 58', () => {
  assert.ok(renderReceiptHtml(model, cur, '58').includes('size: 48mm auto'))
})

ok('كل الأصناف وسطور الترويسة والتذييل موجودة', () => {
  const html = renderReceiptHtml(model, cur, '80')
  assert.ok(html.includes('لبن'))
  assert.ok(html.includes('جبنة رومي'))
  assert.ok(html.includes('المنصورة'))
  assert.ok(html.includes('شكراً لزيارتكم'))
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

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
