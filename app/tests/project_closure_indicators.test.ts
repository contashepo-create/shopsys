import { describe, expect, it } from 'vitest'
import { projectClosureIndicators } from '../src/core/projectClosureReview.ts'

const p = { id: 1, actualHandoverDate: '2024-01-31', defectsLiabilityMonths: 1 }
const check = (project = p, date = '2024-02-28', extracts: { projectId: number; isFinal?: boolean }[] = [], drafts: { projectId: number }[] = [], orders: { projectId: number; status: string }[] = []) => projectClosureIndicators(project, date, extracts, drafts, orders).join('\n')

describe('مؤشرات إقفال المشروع الوصفية', () => {
  it('تحسب نهاية الشهر والتاريخ المختار مع بيان أن الاستحقاق يحتاج مراجعة', () => {
    expect(check()).toContain('يسبق نهاية الضمان المحسوبة من البيانات المدخلة (2024-02-29)')
    expect(check(p, '2024-02-29')).toContain('لا يثبت هذا وحده استحقاق التحصيل')
    expect(check({ ...p, defectsLiabilityMonths: 0 }, '2024-01-30')).toContain('2024-01-31')
  })
  it('لا يخمّن تواريخ أو مدد تالفة أو غير معلومة', () => {
    for (const project of [{ ...p, actualHandoverDate: '' }, { ...p, actualHandoverDate: '2024-02-30' }, { ...p, defectsLiabilityMonths: -1 }, { ...p, defectsLiabilityMonths: 1.5 }, { ...p, defectsLiabilityMonths: NaN }, { ...p, defectsLiabilityMonths: 1201 }]) expect(check(project)).toContain('لا يمكن استنتاج استحقاق المحتجز')
    expect(check(p, '2024-02-30')).toContain('تاريخ المراجعة غير صالح')
    expect(check({ ...p, actualHandoverDate: '9999-12-31', defectsLiabilityMonths: 1 })).toContain('تعذر حساب نهاية الضمان')
  })
  it('يتتبع الختامي والمسودات على المشروع فقط دون افتراض صلاحيتها', () => {
    const flags = check(p, '2024-05-01', [{ projectId: 2, isFinal: true }], [{ projectId: 1 }], [{ projectId: 1, status: 'draft' }, { projectId: 2, status: 'approved' }])
    expect(flags).toContain('لا يظهر مستخلص ختامي'); expect(flags).toContain('مسودة مستخلص'); expect(flags).toContain('أوامر تغيير')
    const other = check(p, '2024-05-01', [{ projectId: 1, isFinal: true }], [{ projectId: 2 }], [{ projectId: 2, status: 'draft' }])
    expect(other).not.toContain('لا يظهر مستخلص ختامي'); expect(other).not.toContain('مسودة مستخلص'); expect(other).not.toContain('أوامر تغيير')
    expect(check(p, '2024-05-01', [{ projectId: 1, isFinal: true }, { projectId: 1, isFinal: true }])).toContain('أكثر من مستخلص')
  })
})
