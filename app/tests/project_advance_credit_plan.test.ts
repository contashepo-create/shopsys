import { describe, expect, it } from 'vitest'
import { planAdvanceCredit, type AdvanceCreditEvidence } from '../src/core/projectAdvanceCreditPlan.ts'

const allocations = [{ advanceId: 1, journalEntryId: 11, amountMinor: 120 }, { advanceId: 2, journalEntryId: 12, amountMinor: 80 }]
const base = { dueMinor: 1000, recoveryMinor: 200, allocations, previous: [] as AdvanceCreditEvidence[] }

describe('نموذج تحديد المقدمة المعادة في الإشعار', () => {
  it('يقبل القيمة اليدوية ويعيد تخصيص المستخلص بدءاً من آخر دفعة دون تعديل المصدر', () => {
    const before = structuredClone(base)
    expect(planAdvanceCredit({ ...base, amountMinor: 400, restoredAdvanceMinor: 100 })).toEqual({
      minRestoredMinor: 0, maxRestoredMinor: 200, customerMinor: 300,
      allocations: [{ advanceId: 2, journalEntryId: 12, amountMinor: 80 }, { advanceId: 1, journalEntryId: 11, amountMinor: 20 }],
    })
    expect(base).toEqual(before)
    expect(planAdvanceCredit({ ...base, amountMinor: 400, restoredAdvanceMinor: 0 }).customerMinor).toBe(400)
  })
  it('يحسب الحدود على الرصيد التراكمي ويعيد كل المقدمة عند رد كل المستحق', () => {
    const first = planAdvanceCredit({ ...base, amountMinor: 400, restoredAdvanceMinor: 100 })
    const previous = [{ amountMinor: 400, restoredAdvanceMinor: 100, allocations: first.allocations }]
    expect(() => planAdvanceCredit({ ...base, previous, amountMinor: 550, restoredAdvanceMinor: 49 })).toThrow(/غير صالح/)
    const second = planAdvanceCredit({ ...base, previous, amountMinor: 550, restoredAdvanceMinor: 50 })
    expect(second).toEqual({ minRestoredMinor: 50, maxRestoredMinor: 100, customerMinor: 500, allocations: [{ advanceId: 1, journalEntryId: 11, amountMinor: 50 }] })
    const final = planAdvanceCredit({ ...base, previous: [...previous, { amountMinor: 550, restoredAdvanceMinor: 50, allocations: second.allocations }], amountMinor: 50, restoredAdvanceMinor: 50 })
    expect(final.minRestoredMinor).toBe(50); expect(final.maxRestoredMinor).toBe(50); expect(final.customerMinor).toBe(0)
  })
  it('يرفض قيمة يدوية خارج الحدود والكسور وتجاوز المستحق', () => {
    for (const [amountMinor, restoredAdvanceMinor] of [[400, 201], [50, 51], [1000, 199], [1001, 200], [0, 0], [10, -1], [10, 0.5], [NaN, 0]]) {
      expect(() => planAdvanceCredit({ ...base, amountMinor, restoredAdvanceMinor })).toThrow()
    }
    expect(planAdvanceCredit({ ...base, amountMinor: 1000, restoredAdvanceMinor: 200 }).customerMinor).toBe(800)
  })
  it('يرفض التوزيع المفقود أو المعدل أو المكرر، ولا يتخيل الدفعة التاريخية', () => {
    for (const bad of [[], [allocations[0]], [allocations[0], allocations[0]], [{ ...allocations[0], journalEntryId: 0 }, allocations[1]]]) {
      expect(() => planAdvanceCredit({ ...base, allocations: bad, amountMinor: 100, restoredAdvanceMinor: 0 })).toThrow()
    }
    const previous = [{ amountMinor: 400, restoredAdvanceMinor: 100, allocations: [{ advanceId: 1, journalEntryId: 11, amountMinor: 100 }] }]
    expect(() => planAdvanceCredit({ ...base, previous, amountMinor: 100, restoredAdvanceMinor: 0 })).toThrow()
  })
  it('يغطي جميع حدود الأجزاء الصغيرة والتحقق التراكمي', () => {
    for (let due = 1; due <= 12; due++) for (let recovery = 0; recovery <= due; recovery++) for (let amount = 1; amount <= due; amount++) {
      const rows = recovery ? [{ advanceId: 1, journalEntryId: 1, amountMinor: recovery }] : []
      const min = Math.max(0, recovery - (due - amount)), max = Math.min(amount, recovery)
      for (let restored = 0; restored <= recovery; restored++) {
        const call = () => planAdvanceCredit({ dueMinor: due, recoveryMinor: recovery, allocations: rows, previous: [], amountMinor: amount, restoredAdvanceMinor: restored })
        if (restored < min || restored > max) expect(call).toThrow()
        else { const result = call(); expect(result.minRestoredMinor).toBe(min); expect(result.maxRestoredMinor).toBe(max); expect(result.customerMinor + restored).toBe(amount) }
      }
    }
  })
})
