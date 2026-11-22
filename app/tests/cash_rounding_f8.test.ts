import { describe, expect, it } from 'vitest'
import { roundCashAmount, normalizeRoundingStep, CASH_ROUNDING_STEPS, CASH_ROUNDING_ACCOUNT } from '../src/core/cashRounding.ts'
import { buildSaleEntry } from '../src/core/pos.ts'
import { assertBalanced } from '../src/core/ledger.ts'

/**
 * F8 — التقريب النقدي للفئات.
 *
 * العيب قبل الإصلاح: إجمالي الفاتورة كان يجب أن يساوي النقد المستلم بالقرش، وعملياً
 * في مصر لا توجد فئات أقل من 25 قرشاً؛ فيدفع الكاشير مبلغاً مختلفاً ويُسجَّل الفرق
 * يدوياً (أو يُلغى البيع). الحل: تقريب النقد المستلم فقط + قيد فرق في 5112.
 */

const totals = (totalMinor: number) => ({
  grossMinor: totalMinor, discountMinor: 0, netMinor: totalMinor,
  taxBaseMinor: totalMinor, taxMinor: 0, totalMinor, cogsMinor: 0,
})

describe('تقريب الفئات — دالة واحدة', () => {
  it('صفر = معطّل (سلوك السعودية لا يتغيّر)', () => {
    expect(roundCashAmount(1003, 0)).toEqual({ roundedMinor: 1003, diffMinor: 0, stepMinor: 0 })
    expect(roundCashAmount(1003, undefined).roundedMinor).toBe(1003)
  })

  it('خطوة 0.25 (ربع جنيه): 10.03 ⇒ 10.00 و 10.13 ⇒ 10.25', () => {
    expect(roundCashAmount(1003, 25)).toEqual({ roundedMinor: 1000, diffMinor: -3, stepMinor: 25 })
    expect(roundCashAmount(1013, 25)).toEqual({ roundedMinor: 1025, diffMinor: 12, stepMinor: 25 })
  })

  it('نصف الخطوة يصعد (لا نشترط على العميل دفع أكثر من النصف)', () => {
    expect(roundCashAmount(1005, 10).roundedMinor).toBe(1010)
    expect(roundCashAmount(1004, 10).roundedMinor).toBe(1000)
    expect(roundCashAmount(1005, 5).roundedMinor).toBe(1005)
  })

  it('خطوة غير مسموحة أو مبالغ فاسدة لا تُقبل صامتة', () => {
    expect(normalizeRoundingStep(7)).toBe(0)
    expect(normalizeRoundingStep(50)).toBe(50)
    for (const step of CASH_ROUNDING_STEPS) expect(normalizeRoundingStep(step)).toBe(step)
    expect(() => roundCashAmount(-1, 25)).toThrow(RangeError)
    expect(() => roundCashAmount(10.5, 25)).toThrow(RangeError)
  })
})

describe('القيد — إجمالي الفاتورة ثابت والفرق وحده في 5112', () => {
  it('خسارة تقريب: الخزينة تقبض 10.00 والفاتورة 10.03 — الفرق مدين 5112', () => {
    const lines = buildSaleEntry(totals(1003), 'cash', '1101', 1003, undefined, 1000)
    assertBalanced(lines)
    const treasury = lines.find((l: { accountCode: string }) => l.accountCode === '1101')!
    const diff = lines.find((l: { accountCode: string }) => l.accountCode === CASH_ROUNDING_ACCOUNT)!
    expect(treasury.debit).toBe(1000)
    expect(diff.debit).toBe(3)
    expect(diff.credit).toBe(0)
  })

  it('ربح تقريب: الخزينة تقبض 10.25 والفاتورة 10.13 — الفرق دائن 5112', () => {
    const lines = buildSaleEntry(totals(1013), 'cash', '1101', 1013, undefined, 1025)
    assertBalanced(lines)
    expect(lines.find((l: { accountCode: string }) => l.accountCode === '1101')!.debit).toBe(1025)
    const diff = lines.find((l: { accountCode: string }) => l.accountCode === CASH_ROUNDING_ACCOUNT)!
    expect(diff.credit).toBe(12)
  })

  it('بلا تقريب (null): لا سطر 5112 إطلاقاً', () => {
    const lines = buildSaleEntry(totals(1003), 'cash', '1101', 1003, undefined, null)
    expect(lines.some((l: { accountCode: string }) => l.accountCode === CASH_ROUNDING_ACCOUNT)).toBe(false)
  })

  it('التقريب لا يُطبَّق على فاتورة غير محصلة كاملةً (آجل جزئي)', () => {
    expect(() => buildSaleEntry(totals(1000), 'cash', '1101', 400, undefined, 1000)).toThrow(/محصلة كاملة/)
  })
})
