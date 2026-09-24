import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateCostCenter } from '../src/core/costCenters.ts'
import { validateExpenseTemplate } from '../src/core/expenseCatalog.ts'
import { invoiceExpensesByCostCenter } from '../src/core/expenseReports.ts'
import { useDataStore } from '../src/data/repo.ts'

const original = useDataStore.getState()

beforeEach(() => useDataStore.setState({ ...original, costCenters: [], expenseTemplates: [] }))
afterEach(() => useDataStore.setState(original))

describe('المراكز العامة وبنود المصروف القابلة لإعادة الاستخدام', () => {
  it('يتحقق من عدم تكرار كود واسم المركز', () => {
    const existing = [{ id: 1, code: 'OPS', nameAr: 'تشغيل', isActive: true, notes: '' }]
    expect(validateCostCenter({ code: ' ops ', nameAr: 'جديد' }, existing)).toContain('كود مركز التكلفة مستخدم مسبقاً')
    expect(validateCostCenter({ code: 'NEW', nameAr: 'تشغيل' }, existing)).toContain('اسم مركز التكلفة مستخدم مسبقاً')
  })

  it('ينشئ ويعطل مركزاً عاماً دون استبدال مركز المركبة', () => {
    const center = useDataStore.getState().addCostCenter({ code: 'OPS', nameAr: 'تشغيل' })
    expect(center.isActive).toBe(true)
    expect(() => useDataStore.getState().addCostCenter({ code: 'ops', nameAr: 'تشغيل آخر' })).toThrow()
    useDataStore.getState().updateCostCenter(center.id, { isActive: false })
    expect(useDataStore.getState().costCenters[0]).toMatchObject({ code: 'OPS', isActive: false })
  })

  it('يحفظ قالب بند مصروف افتراضي دون ترحيل قيد', () => {
    const template = useDataStore.getState().addExpenseTemplate({ code: 'FREIGHT', nameAr: 'نولون', accountCode: '5108', taxTreatment: 'exempt', taxPercent: 0, settlement: 'payable_later', affectsProfit: true, landedCostAllocation: 'value', notes: '' })
    expect(template.code).toBe('FREIGHT')
    expect(useDataStore.getState().journal).toHaveLength(original.journal.length)
    expect(validateExpenseTemplate({ code: 'FREIGHT', nameAr: 'آخر', accountCode: '5108', taxPercent: 0 }, [template])).toContain('كود بند المصروف مستخدم مسبقاً')
  })

  it('يجمع المركز العام مستقلاً عن المشروع ويمكن أن يظهر الاثنان معاً', () => {
    const report = invoiceExpensesByCostCenter([{ date: '2026-09-25', internalExpenses: [
      { costCenterId: 3, projectId: 7, amountMinor: 1000, settlement: 'paid_now' },
      { costCenterId: 3, projectId: 7, amountMinor: 500, settlement: 'payable_later' },
    ] }], {})
    expect(report.rows[0]).toMatchObject({ costCenterId: 3, projectId: 7, totalMinor: 1500, paidMinor: 1000, accruedMinor: 500 })
  })
})
