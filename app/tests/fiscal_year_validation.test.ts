import { beforeEach, describe, expect, it } from 'vitest'
import { fiscalCloseStateRepairs, fiscalYearsForBranch, suggestFiscalYear, validateFiscalYear, type FiscalYear } from '../src/core/fiscal.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const closed2025: FiscalYear = { id: 1, ...suggestFiscalYear(2025), status: 'closed' }

beforeEach(() => useAppStore.setState({ fiscalYears: [] }))

describe('التحقق من تعريف السنة المالية', () => {
  it.each(['2025-02-30', '2025-13-01', 'not-a-date', '2025-1-01'])('يرفض تاريخاً تقويمياً غير صالح: %s', (date) => {
    expect(validateFiscalYear({ nameAr: 'سنة غير صالحة', startDate: date, endDate: '2025-12-31' }, []))
      .toContain('تاريخ بداية السنة غير صالح — استخدم تاريخاً صحيحاً بصيغة YYYY-MM-DD')
  })

  it('يقبل اليوم الكبيس الحقيقي ويرفض اليوم نفسه في سنة غير كبيسة', () => {
    expect(validateFiscalYear({ nameAr: '2024', startDate: '2024-02-29', endDate: '2024-12-31' }, [])).toEqual([])
    expect(validateFiscalYear({ nameAr: '2025', startDate: '2025-02-29', endDate: '2025-12-31' }, []))
      .toContain('تاريخ بداية السنة غير صالح — استخدم تاريخاً صحيحاً بصيغة YYYY-MM-DD')
  })

  it('يحافظ على منع التداخل ووجود سنة واحدة مفتوحة فقط', () => {
    expect(validateFiscalYear(suggestFiscalYear(2025), [closed2025]).join(' ')).toContain('تتداخل')
    expect(validateFiscalYear(suggestFiscalYear(2026), [{ ...closed2025, status: 'open' }]).join(' ')).toContain('ما زالت مفتوحة')
  })

  it('يحرس إجراء المتجر نفسه من تاريخ غير صالح أو تداخل حتى عند تجاوز الواجهة', () => {
    expect(() => useAppStore.getState().addFiscalYear({ nameAr: 'تاريخ تالف', startDate: '2025-02-30', endDate: '2025-12-31' }))
      .toThrow(/تاريخ بداية السنة غير صالح/)
    expect(useAppStore.getState().fiscalYears).toEqual([])

    useAppStore.setState({ fiscalYears: [closed2025] })
    expect(() => useAppStore.getState().addFiscalYear(suggestFiscalYear(2025)))
      .toThrow(/تتداخل/)
    expect(useAppStore.getState().fiscalYears).toEqual([closed2025])
  })

  it('يرفض إكمال الإعداد إذا استُدعِي المتجر مباشرةً بتاريخ افتتاح غير صالح', () => {
    expect(() => useAppStore.getState().completeSetup({
      country: {} as never,
      activity: {} as never,
      shopName: 'اختبار',
      ownerName: 'المالك',
      fiscalYear: { nameAr: '2025', startDate: '2025-02-30', endDate: '2025-12-31' },
    })).toThrow(/تاريخ بداية السنة غير صالح/)
    expect(useAppStore.getState().setup.completed).toBe(false)
    expect(useAppStore.getState().fiscalYears).toEqual([])
  })

  it('يفصل السنوات بين الفروع ويسمح بتداخل الفترات بين فرعين مختلفين فقط', () => {
    useAppStore.getState().addBranchFiscalYear(10, suggestFiscalYear(2025))
    useAppStore.getState().addBranchFiscalYear(20, suggestFiscalYear(2025))
    expect(useAppStore.getState().fiscalYears.map((year) => year.branchId)).toEqual([10, 20])
    expect(fiscalYearsForBranch(useAppStore.getState().fiscalYears, 10)).toHaveLength(1)
    expect(fiscalYearsForBranch(useAppStore.getState().fiscalYears, 20)).toHaveLength(1)
    expect(() => useAppStore.getState().addBranchFiscalYear(10, suggestFiscalYear(2025))).toThrow(/تتداخل/)
  })

  it('يربط الفترات القديمة غير المنسوبة بالرئيسي فقط دون نقلها إلى الفروع الجديدة', () => {
    useAppStore.setState({ fiscalYears: [closed2025] })
    useAppStore.getState().bindLegacyFiscalYearsToMain(1)
    const years = useAppStore.getState().fiscalYears
    expect(fiscalYearsForBranch(years, 1, true)).toEqual([{ ...closed2025, branchId: 1 }])
    expect(fiscalYearsForBranch(years, 2)).toEqual([])
  })

  it('يصلح حالة السنة بعد hydration اعتماداً على قيود الإقفال والعكس فقط دون إنشاء قيود', () => {
    const year = { ...closed2025, status: 'open' as const, branchId: 7 }
    const activeClose = { sourceType: 'year_closing', sourceId: 1, branchId: 7, reversedByEntryId: null }
    expect(fiscalCloseStateRepairs([year], [activeClose])).toEqual({ closeIds: [1], reopenIds: [] })
    expect(fiscalCloseStateRepairs([closed2025], [
      { ...activeClose, branchId: undefined, reversedByEntryId: 99 },
    ])).toEqual({ closeIds: [], reopenIds: [1] })
    expect(fiscalCloseStateRepairs([closed2025], [])).toEqual({ closeIds: [], reopenIds: [] })
  })
})
