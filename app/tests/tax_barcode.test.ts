/**
 * بلاغ المالك: «الباركود الضريبي المطبوع لا يظهر أبداً». السبب: القرار 30
 * كان يطبع رمز QR لزاتكا السعودية فقط — مصر (أغلب قاعدة العملاء) لم يكن
 * لها أي رمز باركود على الإطلاق، فقط تصدير JSON. هذا الفحص يثبت:
 * ① مفتاح الطباعة (einvoice.printZatcaQr) واحد يعيش داخل قسم الفاتورة
 *   الإلكترونية فقط ويتحكم في كلا البلدين.
 * ② مصر الآن تنتج رمز تحقق محلي فعلي (Data URL) عند تفعيل الميزة والمفتاح.
 * ③ السعودية غير متأثرة — نفس سلوك زاتكا TLV القديم تماماً.
 * ④ تعطيل الميزة أو المفتاح أو نقص بيانات الممول ⇒ لا رمز إطلاقاً (بلا طباعة فاسدة).
 */
import { describe, it, expect } from 'vitest'
import { maybeTaxBarcode, zatcaQrDataUrl, egBarcodeDataUrl, maybeTaxBarcodeSync, zatcaQrSvgDataUrl, egBarcodeSvgDataUrl, withTaxBarcodeSync } from '../src/ui/print/taxBarcode.ts'
import { buildReceiptModel, DEFAULT_RECEIPT_SETTINGS } from '../src/core/receipt.ts'
import { renderReceiptHtml } from '../src/ui/print/printReceipt.ts'
import { renderInvoiceA4Html } from '../src/ui/print/printInvoiceA4.ts'
import type { CurrencyConfig } from '../src/core/money.ts'

const base = {
  printEnabled: true,
  sellerName: 'محل تَحَكَّم',
  invoiceNumber: 'INV-0001',
  dateIso: '2026-10-20T12:00:00Z',
  totalMinor: 115000,
  taxMinor: 15000,
  decimals: 2 as const,
}

describe('الرمز الضريبي الموحَّد — مصر والسعودية', () => {
  it('مصر: ميزة einvoice_eg + مفتاح الطباعة + رقم تسجيل صالح ⇒ رمز فعلي يُطبع', async () => {
    const url = await maybeTaxBarcode({ ...base, saFeatureActive: false, egFeatureActive: true, taxNumber: '123456789' })
    expect(url, 'لم يُنتج أي رمز رغم اكتمال كل شروط مصر').toBeTruthy()
    expect(url!.startsWith('data:image/')).toBe(true)
  })

  it('مصر: رقم تسجيل غير صالح ⇒ لا رمز (لا طباعة فاسدة)', async () => {
    const url = await maybeTaxBarcode({ ...base, saFeatureActive: false, egFeatureActive: true, taxNumber: '123' })
    expect(url).toBeUndefined()
  })

  it('مصر: الميزة موقوفة ⇒ لا رمز رغم رقم تسجيل صالح', async () => {
    const url = await maybeTaxBarcode({ ...base, saFeatureActive: false, egFeatureActive: false, taxNumber: '123456789' })
    expect(url).toBeUndefined()
  })

  it('مصر: مفتاح الطباعة موقوف من قسم الفاتورة الإلكترونية ⇒ لا رمز', async () => {
    const url = await maybeTaxBarcode({ ...base, printEnabled: false, saFeatureActive: false, egFeatureActive: true, taxNumber: '123456789' })
    expect(url).toBeUndefined()
  })

  it('السعودية: لم يتأثر سلوكها القديم — رقم صالح + اتصال ⇒ رمز زاتكا فعلي', async () => {
    const url = await maybeTaxBarcode({ ...base, saFeatureActive: true, egFeatureActive: false, taxNumber: '310122393500003', online: true })
    expect(url, 'زاتكا توقفت عن إنتاج رمز بعد توحيد الدالة').toBeTruthy()
    expect(url!.startsWith('data:image/')).toBe(true)
  })

  it('السعودية: بلا اتصال (مرحلة ثانية) ⇒ لا رمز رغم بيانات صالحة', async () => {
    const url = await maybeTaxBarcode({ ...base, saFeatureActive: true, egFeatureActive: false, taxNumber: '310122393500003', online: false })
    expect(url).toBeUndefined()
  })

  it('لا ميزة مفعّلة على الإطلاق ⇒ لا رمز أبداً', async () => {
    const url = await maybeTaxBarcode({ ...base, saFeatureActive: false, egFeatureActive: false, taxNumber: '123456789' })
    expect(url).toBeUndefined()
  })

  it('zatcaQrDataUrl وegBarcodeDataUrl ينتجان Data URL حقيقياً بصيغة PNG', async () => {
    const sa = await zatcaQrDataUrl({ sellerName: 'محل', vatNumber: '310122393500003', timestampIso: base.dateIso, totalWithVatMinor: 115000, vatMinor: 15000, decimals: 2 })
    expect(sa).toMatch(/^data:image\/png;base64,/)
    const eg = await egBarcodeDataUrl({ sellerName: 'محل', taxNumber: '123456789', invoiceNumber: 'INV-1', dateIso: base.dateIso, totalMinor: 115000, decimals: 2 })
    expect(eg).toMatch(/^data:image\/png;base64,/)
  })
})

/**
 * النسخة المتزامنة (SVG) — هي التي تستخدمها شاشات الطباعة الفورية:
 * المرتجع · مراكز فواتير الأنشطة · المقاولات · الإيجار · النقل · إيصال المطعم.
 * نفس شروط النسخة غير المتزامنة (نفس resolveTaxBarcodeKind) فلا تتباعد السياسة.
 */
describe('النسخة المتزامنة SVG — كل مستندات المبيعات', () => {
  const args = { ...base, saFeatureActive: true, egFeatureActive: false, taxNumber: '310122393500003', online: true }

  it('السعودية: يُنتج SVG صالحاً فوراً (بلا await) ويُفك ترميزه إلى <svg> حقيقي', () => {
    const url = maybeTaxBarcodeSync(args)
    expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    const svg = decodeURIComponent(url!.split(',').slice(1).join(','))
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('shape-rendering="crispEdges"')
    expect(svg).toMatch(/<path d="M\d+ \d+h1v1h-1z/)
  })

  it('نفس الشروط السلبية: بلا اتصال / بلا رقم صالح / المفتاح موقوف / الاسم فارغ ⇒ لا رمز', () => {
    expect(maybeTaxBarcodeSync({ ...args, online: false })).toBeUndefined()
    expect(maybeTaxBarcodeSync({ ...args, taxNumber: '123' })).toBeUndefined()
    expect(maybeTaxBarcodeSync({ ...args, printEnabled: false })).toBeUndefined()
    expect(maybeTaxBarcodeSync({ ...args, sellerName: '  ' })).toBeUndefined()
    expect(maybeTaxBarcodeSync({ ...args, saFeatureActive: false, egFeatureActive: false })).toBeUndefined()
  })

  it('مصر: SVG محلي بلا اشتراط اتصال', () => {
    const url = maybeTaxBarcodeSync({ ...base, saFeatureActive: false, egFeatureActive: true, taxNumber: '123456789' })
    expect(url).toMatch(/^data:image\/svg\+xml/)
  })

  it('withTaxBarcodeSync يُرجع true ويُلحق الرمز، وfalse مع غياب الشروط', () => {
    const printed: { qrDataUrl?: string } = {}
    expect(withTaxBarcodeSync(printed, args)).toBe(true)
    expect(printed.qrDataUrl).toMatch(/^data:image\/svg\+xml/)
    const plain: { qrDataUrl?: string } = {}
    expect(withTaxBarcodeSync(plain, { ...args, online: false })).toBe(false)
    expect(plain.qrDataUrl).toBeUndefined()
  })

  it('zatcaQrSvgDataUrl وegBarcodeSvgDataUrl يرفضان البيانات الناقصة بلا رمي', () => {
    expect(zatcaQrSvgDataUrl({ sellerName: '', vatNumber: '310122393500003', timestampIso: base.dateIso, totalWithVatMinor: 100, vatMinor: 0, decimals: 2 })).toBeNull()
    expect(egBarcodeSvgDataUrl({ sellerName: 'محل', taxNumber: '12', invoiceNumber: 'INV', dateIso: base.dateIso, totalMinor: 100, decimals: 2 })).toBeNull()
  })
})

/**
 * إثبات النتيجة المرئية: بعد الختم يظهر <img> الرمز فعلاً في HTML المطبوع
 * (حراري وA4) — لا يكفي أن يُبنى الرمز في الذاكرة ثم ينسى القالب طباعته.
 */
describe('الرمز يصل إلى الورق — HTML الحراري وA4', () => {
  const cur: CurrencyConfig = { code: 'SAR', symbol: 'ر.س', decimals: 2, name: 'ريال' }
  const buildModel = () => buildReceiptModel({
    invoiceNumber: 'SAL-261022-0001',
    refCode: 'SAL-261022-0001',
    dateIso: '2026-10-22T09:30:00Z',
    lines: [{ itemId: 1, nameAr: 'صنف تجريبي', qty: 1, unitPriceMinor: 11500, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
    totals: { grossMinor: 11500, discountMinor: 0, netMinor: 10000, taxBaseMinor: 10000, taxMinor: 1500, totalMinor: 11500, cogsMinor: 0 },
    payment: 'cash',
    paidMinor: 11500,
    customerName: null,
    taxPercent: 15,
    taxInclusive: false,
    settings: { ...DEFAULT_RECEIPT_SETTINGS, showFooter: true, showWords: false },
  })

  const args = {
    saFeatureActive: true, egFeatureActive: false, printEnabled: true,
    sellerName: 'مؤسسة تَحَكَّم التجارية', taxNumber: '310122393500003',
    invoiceNumber: 'SAL-261022-0001', dateIso: '2026-10-22T09:30:00Z',
    totalMinor: 11500, taxMinor: 1500, decimals: 2, online: true,
  }

  it('الإيصال الحراري يحتوي صورة الرمز الضريبي', () => {
    const model = buildModel()
    expect(withTaxBarcodeSync(model, args)).toBe(true)
    const html = renderReceiptHtml(model, cur, { ...DEFAULT_RECEIPT_SETTINGS, showFooter: true })
    expect(html).toContain('data:image/svg+xml')
    expect(html).toContain('alt="الرمز الضريبي"')
  })

  it('فاتورة A4 تحتوي صورة الرمز تحت الإجماليات', () => {
    const model = buildModel()
    withTaxBarcodeSync(model, args)
    const html = renderInvoiceA4Html(model, cur, { ...DEFAULT_RECEIPT_SETTINGS, showFooter: true }, 'a4')
    expect(html).toContain('data:image/svg+xml')
    expect(html).toContain('رمز الفاتورة الضريبية')
  })

  it('بلا شروط (زاتكا غير مفعّلة) لا صورة رمز في المطبوع', () => {
    const model = buildModel()
    expect(withTaxBarcodeSync(model, { ...args, saFeatureActive: false, egFeatureActive: false })).toBe(false)
    expect(renderReceiptHtml(model, cur, DEFAULT_RECEIPT_SETTINGS)).not.toContain('data:image/svg+xml')
  })
})
