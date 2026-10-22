/**
 * تجميد الرمز الضريبي على المستند:
 *  - الحمولة تُولَّد مرة واحدة وتُحفظ على الفاتورة/الإشعار.
 *  - إعادة الطباعة ترسم من الحمولة المحفوظة — فتبقى أرقام الرمز واسم المنشأة
 *    والرقم الضريبي كما كانت لحظة الإصدار ولو تغيّرت الإعدادات بعدها.
 *  - لا تجميد ولا رمز على المسودات.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { taxBarcodePayload, qrDataUrlFromPayload } from '../src/ui/print/taxBarcode.ts'
import { decodeZatcaQr } from '../src/core/einvoice.ts'
import { useDataStore, type SaleInvoice, type SaleReturn } from '../src/data/repo.ts'

const baseArgs = {
  saFeatureActive: true, egFeatureActive: false, printEnabled: true,
  sellerName: 'مؤسسة الإصدار الأصلية', taxNumber: '310122393500003',
  invoiceNumber: 'INV-100', dateIso: '2025-03-04', totalMinor: 11400, taxMinor: 1400, decimals: 2,
}

describe('حمولة الرمز', () => {
  it('تولّد TLV صالحاً بتاريخ الفاتورة لا لحظة الطباعة', () => {
    const payload = taxBarcodePayload(baseArgs)!
    const d = decodeZatcaQr(payload)
    expect(d.get(4)).toBe('114.00')
    expect(d.get(5)).toBe('14.00')
    expect(d.get(3)).toBe('2025-03-04T00:00:00Z')
    expect(d.get(1)).toBe('مؤسسة الإصدار الأصلية')
  })
  it('الرسم من حمولة محفوظة لا يقرأ إعدادات اليوم إطلاقاً', () => {
    const payload = taxBarcodePayload(baseArgs)!
    const url = qrDataUrlFromPayload(payload)
    expect(url.startsWith('data:image/svg+xml')).toBe(true)
    const svg = decodeURIComponent(url.split(',').slice(1).join(','))
    expect(svg).toContain('<svg')
    expect(svg).not.toContain('مؤسسة') // الرمز نقاط لا نص
  })
  it('الحمولة null-safe: بلا سياسة أو بلا رقم صالح ⇒ undefined بلا رمي', () => {
    expect(taxBarcodePayload({ ...baseArgs, printEnabled: false })).toBeUndefined()
    expect(taxBarcodePayload({ ...baseArgs, taxNumber: '123' })).toBeUndefined()
  })
})

describe('التجميد في المتجر', () => {
  const sale = {
    id: 901, invoiceNumber: 'INV-901', refCode: 'SAL-1', date: '2025-03-04T00:00:00.000+02:00',
    customerId: null, payment: 'cash', lines: [], invoiceDiscountPercent: 0,
    totals: { grossMinor: 0, discountMinor: 0, netMinor: 0, taxBaseMinor: 0, taxMinor: 0, totalMinor: 0, cogsMinor: 0 },
    journalEntryId: 1, expiryOverrideBy: null, shiftId: null,
  } as unknown as SaleInvoice
  const ret = {
    id: 902, returnNumber: 'R-902', refCode: 'SRT-1', date: '2025-03-04T00:00:00.000+02:00', saleId: 901,
    refund: 'cash', lines: [], totals: { grossMinor: 0, discountMinor: 0, netMinor: 0, taxBaseMinor: 0, taxMinor: 0, totalMinor: 0, cogsMinor: 0 },
    journalEntryId: 1, reason: 'اختبار', shiftId: null,
  } as unknown as SaleReturn

  beforeEach(() => {
    useDataStore.setState({ sales: [sale], saleReturns: [ret] } as never)
  })

  it('تجميد الرمز على الفاتورة لا يُستبدل بعد ذلك (ثبات إعادة الطباعة)', () => {
    const { attachSaleTaxQr } = useDataStore.getState()
    attachSaleTaxQr(901, 'PAYLOAD-A')
    attachSaleTaxQr(901, 'PAYLOAD-B')
    const stored = useDataStore.getState().sales.find((s) => s.id === 901)!
    expect(stored.taxQrPayload).toBe('PAYLOAD-A')
  })
  it('تجميد الرمز على إشعار المرتجع', () => {
    const { attachSaleReturnTaxQr } = useDataStore.getState()
    attachSaleReturnTaxQr(902, 'PAYLOAD-R')
    expect(useDataStore.getState().saleReturns.find((r) => r.id === 902)!.taxQrPayload).toBe('PAYLOAD-R')
  })
})
