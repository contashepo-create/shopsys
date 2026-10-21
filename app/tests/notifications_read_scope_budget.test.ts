/**
 * انحدار بلاغ المالك 2026-10-21:
 *  ١) «إشعار ضبط الموازنة لا يختفي عند تعليمه كمقروء» — علامات القراءة تُخزَّن مبدوءة بنطاق
 *     المستخدم/الفرع، وكان عرض «كل الفروع» للمالك يُرجعها بالبادئة فلا تطابق معرّفات الجرس.
 *  ٢) «إذا كتبت أي رقم ابدأ المقارنة، أما إذا كان صفراً فلا أريد أي إشعارات للموازنة»
 *     — فئة بموازنة صفر تُعرض «بلا موازنة» ولا تُرفع إلى الجرس إطلاقاً.
 */
import { describe, it, expect, beforeAll } from 'vitest'

describe('موازنة المشروع — صفر لا يقارن ولا يُنبّه', () => {
  it('فئة بلا موازنة (صفر) بحالة no-budget ولا نسبة استهلاك', () => {
    return import('../src/core/contracting.ts').then(({ budgetVarianceReport }) => {
      const report = budgetVarianceReport([], [{ kind: 'materials', amountMinor: 500_000 }])
      expect(report.rows).toHaveLength(1)
      expect(report.rows[0].status).toBe('no-budget')
      expect(report.rows[0].usagePercent).toBe(0)
      expect(report.rows[0].budgetMinor).toBe(0)
      expect(report.rows[0].actualMinor).toBe(500_000)
    })
  })

  it('موازنة مُدخلة صراحةً بصفر لا تُعدّ تجاوزاً', async () => {
    const { budgetVarianceReport } = await import('../src/core/contracting.ts')
    const report = budgetVarianceReport([{ kind: 'labor', amountMinor: 0 }], [{ kind: 'labor', amountMinor: 900_000 }])
    expect(report.rows[0].status).toBe('no-budget')
  })

  it('أي رقم موجب يبدأ المقارنة: 90٪ تحذير و140٪ تجاوز', async () => {
    const { budgetVarianceReport } = await import('../src/core/contracting.ts')
    const warn = budgetVarianceReport([{ kind: 'materials', amountMinor: 1_000_000 }], [{ kind: 'materials', amountMinor: 900_000 }])
    expect(warn.rows[0].status).toBe('warning')
    expect(warn.rows[0].usagePercent).toBe(90)
    const over = budgetVarianceReport([{ kind: 'materials', amountMinor: 1_000_000 }], [{ kind: 'materials', amountMinor: 1_400_000 }])
    expect(over.rows[0].status).toBe('over')
    expect(over.rows[0].varianceMinor).toBe(-400_000)
  })

  it('جرس التنبيهات لا يُنتج prjbudget بلا تجاوزات موجبة', async () => {
    const { collectNotifications } = await import('../src/core/notifications.ts')
    const base = {
      batches: [], itemName: () => '', installmentPlans: [], customerName: () => '', cheques: [],
      fmt: (m: number) => String(m), todayIso: '2026-10-21T00:00:00Z',
    }
    expect(collectNotifications({ ...base, projectBudgetOverruns: [] }).some((n) => n.id.startsWith('prjbudget:'))).toBe(false)
    expect(collectNotifications({
      ...base,
      projectBudgetOverruns: [{ projectId: 1, projectNameAr: 'مشروع', kindAr: 'مواد', overrunMinor: 100 }],
    }).filter((n) => n.id.startsWith('prjbudget:'))).toHaveLength(1)
  })
})

describe('تعليم الإشعار كمقروء — معرّف العرض مطابق لمعرّف الجرس', () => {
  let useDataStore: typeof import('../src/data/repo.ts').useDataStore
  let useRawDataStore: typeof import('../src/data/repo.ts').useRawDataStore

  beforeAll(async () => {
    localStorage.clear()
    ;({ useDataStore, useRawDataStore } = await import('../src/data/repo.ts'))
  })

  it('بعد التعليم يظهر المعرّف مجرَّداً بلا بادئة نطاق فيختفي من غير المقروء', () => {
    const id = 'prjbudget:1:مواد'
    useDataStore.getState().markNotificationRead(id)
    const readIds = useDataStore.getState().readNotificationIds
    expect(readIds).toContain(id)
    expect(readIds.some((x) => x.startsWith('notification-read:v1:'))).toBe(false)
    // نفس منطق الجرس في Header.tsx
    expect(new Set(readIds).has(id)).toBe(true)
    // التخزين الخام محتفظ بالبادئة لعزل المستخدم/الفرع
    expect(useRawDataStore.getState().readNotificationIds).toContain(`notification-read:v1:owner:branch-all:${id}`)
  })

  it('الاسترجاع يعيد الإشعار إلى غير المقروء', () => {
    useDataStore.getState().restoreNotifications()
    expect(useDataStore.getState().readNotificationIds).toHaveLength(0)
    expect(useRawDataStore.getState().readNotificationIds).toHaveLength(0)
  })
})
