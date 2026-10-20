import { describe, expect, it } from 'vitest'
import { returnReasonsSummary } from '../src/core/reports.ts'

const reasonName = (code: string) => ({ expired: 'منتهي الصلاحية', wrong_size: 'مقاس خاطئ' }[code] ?? code)

describe('تحليل أسباب الإرجاع (سد فجوة التوثيق)', () => {
  it('يجمع المرتجعات حسب السبب ويرتبها بالأكثر تكراراً', () => {
    const rows = returnReasonsSummary([
      { id: 1, date: '2026-09-05', reasonCode: 'expired', totals: { totalMinor: 1000 }, lines: [{ condition: 'damaged' }] },
      { id: 2, date: '2026-09-10', reasonCode: 'expired', totals: { totalMinor: 500 }, lines: [{ condition: 'damaged' }] },
      { id: 3, date: '2026-09-12', reasonCode: 'wrong_size', totals: { totalMinor: 300 }, lines: [{ condition: 'resellable' }] },
      { id: 4, date: '2026-08-01', reasonCode: 'expired', totals: { totalMinor: 999 }, lines: [] }, // خارج الفترة
    ], { from: '2026-09-01', to: '2026-09-30' }, reasonName)

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ reasonCode: 'expired', nameAr: 'منتهي الصلاحية', count: 2, totalValueMinor: 1500, damagedLines: 2, resellableLines: 0 })
    expect(rows[1]).toMatchObject({ reasonCode: 'wrong_size', count: 1, totalValueMinor: 300, resellableLines: 1 })
  })

  it('يضع المرتجعات بلا reasonCode (سجلات قديمة) في دلو منفصل', () => {
    const rows = returnReasonsSummary([
      { id: 1, date: '2026-09-05', totals: { totalMinor: 200 }, lines: [] },
    ], { from: '2026-09-01', to: '2026-09-30' }, reasonName)
    expect(rows[0]).toMatchObject({ reasonCode: 'unspecified', nameAr: 'غير محدد (سجل قديم)', count: 1 })
  })

  it('لا مرتجعات في الفترة تعيد مصفوفة فارغة', () => {
    expect(returnReasonsSummary([], { from: '2026-09-01', to: '2026-09-30' }, reasonName)).toEqual([])
  })
})
