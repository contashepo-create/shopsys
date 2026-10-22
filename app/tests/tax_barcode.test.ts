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
import { maybeTaxBarcode, zatcaQrDataUrl, egBarcodeDataUrl, withTaxBarcode } from '../src/ui/print/taxBarcode.ts'

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

  it('withTaxBarcode يُلحق الرمز بنموذج المستند (طريق الطباعة من المحرر) ولا يغيّر النموذج عند غياب الشروط', async () => {
    const printed: { qrDataUrl?: string } = {}
    const same = await withTaxBarcode(printed, { ...base, saFeatureActive: true, egFeatureActive: false, taxNumber: '310122393500003', online: true })
    expect(same).toBe(printed)
    expect(printed.qrDataUrl).toMatch(/^data:image\/png;base64,/)

    const plain: { qrDataUrl?: string } = {}
    await withTaxBarcode(plain, { ...base, saFeatureActive: false, egFeatureActive: false, taxNumber: '310122393500003' })
    expect(plain.qrDataUrl).toBeUndefined()
  })

  it('zatcaQrDataUrl وegBarcodeDataUrl ينتجان Data URL حقيقياً بصيغة PNG', async () => {
    const sa = await zatcaQrDataUrl({ sellerName: 'محل', vatNumber: '310122393500003', timestampIso: base.dateIso, totalWithVatMinor: 115000, vatMinor: 15000, decimals: 2 })
    expect(sa).toMatch(/^data:image\/png;base64,/)
    const eg = await egBarcodeDataUrl({ sellerName: 'محل', taxNumber: '123456789', invoiceNumber: 'INV-1', dateIso: base.dateIso, totalMinor: 115000, decimals: 2 })
    expect(eg).toMatch(/^data:image\/png;base64,/)
  })
})
