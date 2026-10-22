/**
 * بلاغ المالك: «الباركود الضريبي المطبوع لا يظهر أبداً». السبب: القرار 30
 * كان يطبع رمز QR لزاتكا السعودية فقط — مصر (أغلب قاعدة العملاء) لم يكن
 * لها أي رمز باركود على الإطلاق، فقط تصدير JSON. هذا الفحص يثبت:
 * ① مفتاح الطباعة (einvoice.printZatcaQr) واحد يعيش داخل قسم الفاتورة
 *   الإلكترونية فقط ويتحكم في كلا البلدين.
 * ② مصر الآن تنتج رمز تحقق محلي فعلي (Data URL) عند تفعيل الميزة والمفتاح.
 * ③ السعودية غير متأثرة — نفس سلوك زاتكا TLV القديم تماماً.
 * ④ تعطيل الميزة أو المفتاح أو نقص بيانات الممول ⇒ لا رمز إطلاقاً (بلا طباعة فاسدة).
 * ⑤ لا يشترط اتصالاً بالإنترنت: رمز المرحلة الأولى (Generation) يُولَّد محلياً،
 *   واشتراط الاتصال يخص الربط/الإرسال (المرحلة الثانية) وحدهما — انظر
 *   zatcaLinkPolicy في tests/invoice_edit_policy.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { maybeTaxBarcode, zatcaQrDataUrl, egBarcodeDataUrl, maybeTaxBarcodeSync, zatcaQrSvgDataUrl, egBarcodeSvgDataUrl, withTaxBarcodeSync } from '../src/ui/print/taxBarcode.ts'
import { buildReceiptModel, DEFAULT_RECEIPT_SETTINGS } from '../src/core/receipt.ts'
import { buildZatcaQr, isValidZatcaTimestamp, validateZatcaFields } from '../src/core/einvoice.ts'
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

  it('السعودية: رقم صالح ومفتاح طباعة ⇒ رمز زاتكا فعلي', async () => {
    const url = await maybeTaxBarcode({ ...base, saFeatureActive: true, egFeatureActive: false, taxNumber: '310122393500003' })
    expect(url, 'زاتكا توقفت عن إنتاج رمز بعد توحيد الدالة').toBeTruthy()
    expect(url!.startsWith('data:image/')).toBe(true)
  })

  it('السعودية: الرمز يُولَّد والمتصفح معلن قطع الاتصال — لا قراءة للشبكة إطلاقاً', () => {
    const original = navigator.onLine
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    try {
      const url = maybeTaxBarcodeSync({ ...base, saFeatureActive: true, egFeatureActive: false, taxNumber: '310122393500003' })
      expect(url, 'رمز المرحلة الأولى يجب أن يُطبع أوفلاين — اشتراط الاتصال يخص الربط فقط').toBeTruthy()
      expect(url!.startsWith('data:image/svg+xml')).toBe(true)
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: original })
    }
  })

  it('السعودية: رقم ضريبي بالأرقام العربية يُطبَّع ويُولّد رمزاً (لا يُسقط بصمت)', async () => {
    const url = await maybeTaxBarcode({ ...base, saFeatureActive: true, egFeatureActive: false, taxNumber: '٣١٠١٢٢٣٩٣٥٠٠٠٠٣' })
    expect(url).toBeTruthy()
    expect(url!.startsWith('data:image/')).toBe(true)
  })

  it('مصر: رقم فاتورة يحوي الفاصل | يمنع الرمز بدل بناء بنية مكسورة', async () => {
    const url = await maybeTaxBarcode({ ...base, printEnabled: true, saFeatureActive: false, egFeatureActive: true, taxNumber: '123456789', invoiceNumber: 'INV|42' })
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
  const args = { ...base, saFeatureActive: true, egFeatureActive: false, taxNumber: '310122393500003' }

  it('السعودية: يُنتج SVG صالحاً فوراً (بلا await) ويُفك ترميزه إلى <svg> حقيقي', () => {
    const url = maybeTaxBarcodeSync(args)
    expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    const svg = decodeURIComponent(url!.split(',').slice(1).join(','))
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('shape-rendering="crispEdges"')
    expect(svg).toMatch(/<path d="M\d+ \d+h1v1h-1z/)
  })

  it('نفس الشروط السلبية: بلا رقم صالح / المفتاح موقوف / الاسم فارغ ⇒ لا رمز', () => {
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
    expect(withTaxBarcodeSync(plain, { ...args, printEnabled: false })).toBe(false)
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
    totalMinor: 11500, taxMinor: 1500, decimals: 2,
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

/**
 * تحصين المدخلات (مراجعة برمجية/أمنية/محاسبية 2026-10-22):
 * ① الأرقام الضريبية تُلصق غالباً بمسافات/شرطات — تُنظَّف قبل التحقق والترميز
 *   بدل إسقاط الرمز بصمت.
 * ② الرمز مصفوفة نقاط فقط: اسم بائع يحوي وسوماً لا يدخل SVG بأي شكل.
 * ③ النموذج المُعاد استخدامه لا يحتفظ برمز قديم بعد توقف السياسة.
 * ④ طابع زاتكا الزمني صارم: تاريخ تقويمي حقيقي + وقت + منطقة زمنية.
 */
describe('تحصين المدخلات والطابع الزمني', () => {
  it('الرقم السعودي بمسافات/شرطات يُقبل ويُرمَّز 15 رقماً فقط', () => {
    const url = maybeTaxBarcodeSync({ ...base, saFeatureActive: true, egFeatureActive: false, taxNumber: '310-122-393-500-003' })
    expect(url, 'الرقم المنسّق يجب ألا يُسقط الرمز').toMatch(/^data:image\/svg\+xml/)
  })

  it('الرقم المصري بمسافات/شرطات يُقبل', () => {
    const url = maybeTaxBarcodeSync({ ...base, saFeatureActive: false, egFeatureActive: true, taxNumber: '123 456-789' })
    expect(url).toMatch(/^data:image\/svg\+xml/)
  })

  it('اسم بائع يحوي وسوم HTML لا يدخل في SVG (الرمز نقاط فقط)', () => {
    const url = zatcaQrSvgDataUrl({
      sellerName: '<script>alert(1)</script>', vatNumber: '310122393500003',
      timestampIso: '2026-10-20T12:00:00Z', totalWithVatMinor: 1150, vatMinor: 150, decimals: 2,
    })
    expect(url).toBeTruthy()
    const svg = decodeURIComponent(url!.split(',').slice(1).join(','))
    expect(svg).not.toContain('<script')
    expect(svg).toContain('shape-rendering="crispEdges"')
  })

  it('withTaxBarcodeSync يمسح رمزاً قديماً حين تمنع السياسة الطباعة', () => {
    const model: { qrDataUrl?: string } = { qrDataUrl: 'data:image/png;base64,OLD' }
    const stamped = withTaxBarcodeSync(model, { ...base, saFeatureActive: true, egFeatureActive: false, printEnabled: false, taxNumber: '310122393500003' })
    expect(stamped).toBe(false)
    expect(model.qrDataUrl, 'رمز قديم بلا سياسة = طباعة مضللة').toBeUndefined()
  })

  it('اسم بائع أطول من 255 بايت ⇒ رسالة عربية واضحة لا RangeError صامت', () => {
    const longName = 'م'.repeat(300)
    const errors = validateZatcaFields({ sellerName: longName, vatNumber: '300000000000003', timestampIso: '2026-09-14T20:30:00Z', totalWithVatMinor: 11500, vatMinor: 1500, decimals: 2 })
    expect(errors.some((e) => e.includes('255'))).toBe(true)
    expect(() => buildZatcaQr({ sellerName: longName, vatNumber: '300000000000003', timestampIso: '2026-09-14T20:30:00Z', totalWithVatMinor: 11500, vatMinor: 1500, decimals: 2 })).toThrow(/255/)
  })
  it('طابع زاتكا: تاريخ مستحيل يُرفض، والمنطقة الزمنية والوقت مطلوبان', () => {
    expect(isValidZatcaTimestamp('2026-09-14T20:30:00Z')).toBe(true)
    expect(isValidZatcaTimestamp('2026-09-14T20:30:00.000Z')).toBe(true)
    expect(isValidZatcaTimestamp('2026-09-14T20:30:00+03:00')).toBe(true)
    expect(isValidZatcaTimestamp('2026-02-30T00:00:00Z')).toBe(false)
    expect(isValidZatcaTimestamp('2026-09-14T20:30:00')).toBe(false)
    expect(isValidZatcaTimestamp('2026-09-14')).toBe(false)
    expect(isValidZatcaTimestamp('ليس تاريخاً')).toBe(false)
  })
})
