/**
 * مراجعة ③ (ح5) — مرساة سطح المكتب: الأقدم لبداية التجربة، والأحدث لآخر ظهور،
 * ولا تُقبل قيمة تالفة. الدالة الخالصة في desktop/trialAnchor.ts (العملية الرئيسية تستدعيها).
 */
import { describe, it, expect } from 'vitest'
import { mergeTrialAnchor, isIsoDay } from '../desktop/trialAnchor.ts'

describe('مرساة سطح المكتب — desktop/trialAnchor', () => {
  it('قيمة فارغة لا تصير «الأقدم» ولا تفسد المرساة', () => {
    const r = mergeTrialAnchor({ firstTrialAt: '2026-09-01T00:00:00.000Z' }, { firstTrialAt: '' })
    expect(r.anchor.firstTrialAt).toBe('2026-09-01T00:00:00.000Z')
    expect(r.changed).toBe(false)
  })

  it('الأقدم يفوز لبداية التجربة (مسح القاعدة لا يعيدها)', () => {
    expect(mergeTrialAnchor({ firstTrialAt: '2026-09-01T00:00:00.000Z' }, { firstTrialAt: '2026-10-05T00:00:00.000Z' }).anchor.firstTrialAt)
      .toBe('2026-09-01T00:00:00.000Z')
    expect(mergeTrialAnchor(null, { firstTrialAt: '2026-10-05T00:00:00.000Z' }).anchor.firstTrialAt).toBe('2026-10-05T00:00:00.000Z')
  })

  it('الأحدث يفوز لآخر ظهور ولا يرجع للخلف (خط الدفاع ضد إرجاع الساعة)', () => {
    const r = mergeTrialAnchor({ lastSeenAt: '2026-10-05T10:00:00.000Z' }, { lastSeenAt: '2026-10-01T00:00:00.000Z' })
    expect(r.anchor.lastSeenAt).toBe('2026-10-05T10:00:00.000Z')
    expect(r.changed).toBe(false)
  })

  it('ملف تالف (ليس كائناً) يُعاد بناؤه من القيم الصالحة ويُكتب', () => {
    const r = mergeTrialAnchor('garbage', { firstTrialAt: '2026-10-05T00:00:00.000Z', lastSeenAt: '2026-10-05T10:00:00.000Z' })
    expect(r.anchor).toEqual({ firstTrialAt: '2026-10-05T00:00:00.000Z', lastSeenAt: '2026-10-05T10:00:00.000Z' })
    expect(r.changed).toBe(true)
  })

  it('لا كتابة على القرص عند عدم تغيّر شيء (حارس الفرق)', () => {
    const saved = { firstTrialAt: '2026-09-01T00:00:00.000Z', lastSeenAt: '2026-10-05T10:00:00.000Z' }
    expect(mergeTrialAnchor(saved, { firstTrialAt: '2026-10-05T00:00:00.000Z', lastSeenAt: '2026-10-05T09:00:00.000Z' }).changed).toBe(false)
  })

  it('isIsoDay يقبل التاريخ الكامل ويرفض ما ليس تاريخاً', () => {
    expect(isIsoDay('2026-10-09T10:00:00.000Z')).toBe(true)
    for (const v of ['', 'junk', 12, null, undefined]) expect(isIsoDay(v)).toBe(false)
  })
})
