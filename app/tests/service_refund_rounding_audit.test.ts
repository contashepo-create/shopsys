import { describe, expect, it } from 'vitest'
import { buildServiceRefundEntry } from '../src/core/serviceRefund.ts'

describe('ضريبة مرتجع الخدمة التراكمي', () => {
  it('يعكس الضريبة كاملة عند رد المستند بأجزاء صغيرة', () => {
    let refunded = 0, tax = 0
    for (let i = 0; i < 115; i++) {
      const result = buildServiceRefundEntry({ refundValueMinor: 1, deliveredGrandMinor: 115, deliveredTaxMinor: 15, priorRefundedMinor: refunded, priorRefundedTaxMinor: tax, mode: 'cash', note: 'اختبار' })
      refunded += 1
      tax += result.taxShareMinor
    }
    expect(tax).toBe(15)
  })
  it('يرفض سجلاً تراكمياً تالفاً دون توليد قيد', () => {
    expect(() => buildServiceRefundEntry({ refundValueMinor: 1, deliveredGrandMinor: 100, deliveredTaxMinor: 10, priorRefundedMinor: 10, priorRefundedTaxMinor: 11, mode: 'cash', note: 'اختبار' })).toThrow(/غير صالح/)
  })
})

it('يمنع تحميل فرق ضريبة قديمة على مرتجع صغير دون مراجعة', () => {
  expect(() => buildServiceRefundEntry({ refundValueMinor: 1, deliveredGrandMinor: 115, deliveredTaxMinor: 15, priorRefundedMinor: 70, priorRefundedTaxMinor: 0, mode: 'cash', note: 'سجل قديم' })).toThrow(/مراجعة.*ضريب/)
})

it('يرفض سجلاً قديماً لا يكفي فيه المتبقي لعكس الضريبة غير المعكوسة', () => {
  expect(() => buildServiceRefundEntry({ refundValueMinor: 1, deliveredGrandMinor: 115, deliveredTaxMinor: 15, priorRefundedMinor: 114, priorRefundedTaxMinor: 0, mode: 'cash', note: 'سجل قديم' })).toThrow(/مراجعة.*ضريب/)
})
