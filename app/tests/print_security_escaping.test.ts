/**
 * أمن الطباعة: كل حقل يكتبه المستخدم يجب أن يصل إلى HTML مهرَّباً — في كل
 * قالب (5 أنماط A4 + A5 + حراري). اختبار حقن شامل: لو أضاف مطوّر لاحقاً
 * حقلاً غير مهرَّب إلى أي قالب، يسقط هذا الملف فوراً.
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_RECEIPT_SETTINGS, type A4Style, type ReceiptModel } from '../src/core/receipt.ts'
import { renderInvoiceA4Html } from '../src/ui/print/printInvoiceA4.ts'
import { renderReceiptHtml } from '../src/ui/print/printReceipt.ts'

const EVIL = '<img src=x onerror=alert(1)>'
const EVIL_ATTR = '" onmouseover="alert(1)'
const EVIL2 = '&lt;script&gt;alert(1)&lt;/script&gt;'
const cur = { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: 'جنيه' }

const evilModel: ReceiptModel = {
  shopName: EVIL_ATTR,
  headerLines: [EVIL, EVIL2],
  docTitle: EVIL,
  operatorName: EVIL,
  invoiceNumber: EVIL,
  refCode: EVIL,
  dateLabel: EVIL,
  customerName: EVIL,
  paymentLabel: EVIL,
  rows: [
    { nameAr: EVIL, qtyLabel: '2', unitPriceMinor: 1000, totalMinor: 2000, discountPercent: 0, vatPercent: 14, serials: [EVIL], notes: EVIL },
    { nameAr: EVIL2, qtyLabel: '1', unitPriceMinor: 500, totalMinor: 500, discountPercent: 10, vatPercent: 0, serials: [], notes: '' },
  ],
  itemCount: 2, totalQty: 3, grossMinor: 2500, discountMinor: 50, taxBaseMinor: 2450, taxMinor: 245,
  taxLabel: `ض.ق.م 14٪ ${EVIL}`,
  totalMinor: 2695, paidMinor: 695, remainingMinor: 2000,
  footerText: EVIL,
  qrDataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"></svg>')}`,
}

/* نبحث عن وسوم/سمات حيّة لا عن كلمة onerror داخل نص مهرَّب (التهريب يحوّل
   < إلى &lt; فتصير «onerror=alert» نصاً خاملاً). */
const RAW_PATTERNS = ['<img src=x', '<script', '" onmouseover=', "' onmouseover="]
const assertNoRawInjection = (html: string, label: string) => {
  for (const raw of RAW_PATTERNS) expect(html.includes(raw), `${label}: تسرّب ${raw}`).toBe(false)
}

describe('أمن قوالب الطباعة — حقن HTML في كل الحقول', () => {
  const styles: A4Style[] = ['modern', 'classic', 'compact', 'elegant', 'royal']
  for (const a4Style of styles) {
    it(`A4 ${a4Style}: كل الحقول مهرَّبة`, () => {
      const html = renderInvoiceA4Html(evilModel, cur, { ...DEFAULT_RECEIPT_SETTINGS, a4Style }, 'a4')
      assertNoRawInjection(html, `a4/${a4Style}`)
      expect(html).toContain('&lt;img')
    })
    it(`A5 ${a4Style}: كل الحقول مهرَّبة`, () => {
      assertNoRawInjection(renderInvoiceA4Html(evilModel, cur, { ...DEFAULT_RECEIPT_SETTINGS, a4Style }, 'a5'), `a5/${a4Style}`)
    })
  }
  it('حراري: كل الحقول مهرَّبة', () => {
    const html = renderReceiptHtml(evilModel, cur, DEFAULT_RECEIPT_SETTINGS)
    assertNoRawInjection(html, 'thermal')
    expect(html).toContain('&lt;img')
  })
  it('الخلفية/اللون لا يسمحان بحقن CSS خارج المسموح', () => {
    const html = renderInvoiceA4Html(evilModel, cur, { ...DEFAULT_RECEIPT_SETTINGS, accentColor: 'red;background:url(javascript:alert(1))' }, 'a4')
    expect(html).not.toContain('javascript:alert')
  })
})
