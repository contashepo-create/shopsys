import { describe, expect, it } from 'vitest'
import { calculateInvoiceCommissionMinor, proportionalCommissionReturnMinor } from '../src/core/invoiceCommissions.ts'

describe('عمولة الفاتورة المتقدمة', () => {
  it('تحسب مبلغاً ثابتاً', () => expect(calculateInvoiceCommissionMinor({ basis: 'fixed', value: 1250, grossMinor: 0, netMinor: 0, profitMinor: 0 })).toBe(1250))
  it('تحسب نسبة من الإجمالي أو الصافي', () => {
    expect(calculateInvoiceCommissionMinor({ basis: 'gross', value: 2.5, grossMinor: 100_000, netMinor: 80_000, profitMinor: 20_000 })).toBe(2500)
    expect(calculateInvoiceCommissionMinor({ basis: 'net', value: 2.5, grossMinor: 100_000, netMinor: 80_000, profitMinor: 20_000 })).toBe(2000)
  })
  it('لا تنتج عمولة سالبة من خسارة', () => expect(calculateInvoiceCommissionMinor({ basis: 'profit', value: 10, grossMinor: 1000, netMinor: 900, profitMinor: -100 })).toBe(0))
  it('ترفض النسبة السالبة', () => expect(() => calculateInvoiceCommissionMinor({ basis: 'net', value: -1, grossMinor: 0, netMinor: 0, profitMinor: 0 })).toThrow())
  it('تعكس العمولة بنسبة المرتجع ولا تتجاوز المتبقي', () => {
    expect(proportionalCommissionReturnMinor(1000, 0, 2500, 10_000)).toBe(250)
    expect(proportionalCommissionReturnMinor(1000, 900, 5000, 10_000)).toBe(100)
  })
})
