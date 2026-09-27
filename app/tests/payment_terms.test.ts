import { describe, expect, it } from 'vitest'
import { buildPaymentSchedule, validatePaymentTerm } from '../src/core/paymentTerms.ts'

const term = { code: 'NET_SPLIT', nameAr: 'نصف الآن ونصف بعد شهر', installments: [{ dueDays: 0, percent: 50 }, { dueDays: 30, percent: 50 }] }
describe('شروط وجدولة السداد', () => {
  it('يبني أقساطاً تطابق الإجمالي مع التقريب', () => {
    const rows = buildPaymentSchedule('2026-09-22', 101, term)
    expect(rows.map((row) => row.amountMinor)).toEqual([51, 50])
    expect(rows[1].dueDate).toBe('2026-10-22')
  })
  it('يرفض نسباً لا تساوي مئة أو ترتيباً زمنياً خاطئاً', () => {
    expect(validatePaymentTerm({ ...term, installments: [{ dueDays: 30, percent: 40 }, { dueDays: 10, percent: 40 }] })).toHaveLength(2)
  })
  it('يدعم صافي ثلاثين يوماً', () => {
    expect(buildPaymentSchedule('2026-01-31', 500, { code: 'NET30', nameAr: '30 يوم', installments: [{ dueDays: 30, percent: 100 }] })[0]).toMatchObject({ dueDate: '2026-03-02', amountMinor: 500 })
  })
})
