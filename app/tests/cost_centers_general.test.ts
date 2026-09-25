import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateCostCenter } from '../src/core/costCenters.ts'
import { allocateJournalLine } from '../src/core/ledger.ts'
import { validateExpenseTemplate } from '../src/core/expenseCatalog.ts'
import { invoiceExpensesByCostCenter, journalExpensesByCostCenter, costCenterBudgetReport, returnsByCostCenter } from '../src/core/expenseReports.ts'
import { buildInternalExpenseLines } from '../src/core/advancedInvoice.ts'
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

  it('يثبت المركز على سطر المصروف في القيد ويظهر في تقرير القيود', () => {
    const lines = buildInternalExpenseLines([{ id: 'e1', label: 'نولون', amountMinor: 1000, accountCode: '5108', costCenterId: 3, settlement: 'payable_later', payableAccountCode: '2117', taxTreatment: 'exempt', taxPercent: 0, affectsProfit: true, landedCostAllocation: 'none' }])
    expect(lines[0]).toMatchObject({ accountCode: '5108', costCenterId: 3 })
    const report = journalExpensesByCostCenter([{ id: 1, entryNumber: 1, date: '2026-09-25', description: 'مصروف', sourceType: 'payment_voucher', sourceId: 1, lines, createdBy: 'المالك', createdAt: '2026-09-25T00:00:00Z', reversedByEntryId: null, reversesEntryId: null }], { from: '2026-09-01', to: '2026-09-30' }, new Set())
    expect(report).toMatchObject({ totalMinor: 1000 })
    expect(report.rows[0]).toMatchObject({ costCenterId: 3, accountCode: '5108', txCount: 1 })
  })

  it('يحافظ على ارتباط المرتجع بالمركز الموروث دون خلطه بتقرير المصروفات', () => {
    const rows = returnsByCostCenter([
      { date: '2026-09-25', totalMinor: 800, costCenterIds: [3], kind: 'sale_return' },
      { date: '2026-09-25', totalMinor: 200, costCenterIds: [3, 4], kind: 'purchase_return' },
    ], { from: '2026-09-01', to: '2026-09-30' })
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ costCenterId: 3, kind: 'sale_return', totalMinor: 800, txCount: 1 }),
      expect.objectContaining({ costCenterId: 3, kind: 'purchase_return', totalMinor: 200, txCount: 1 }),
      expect.objectContaining({ costCenterId: 4, kind: 'purchase_return', totalMinor: 200, txCount: 1 }),
    ]))
  })

  it('يربط تكلفة مشروع المقاولات بالمركز العام مع إبقاء projectId منفصلاً', () => {
    const center = useDataStore.getState().addCostCenter({ code: 'PRJ', nameAr: 'مركز المشاريع' })
    const project = useDataStore.getState().addProject({ nameAr: 'مشروع اختبار', clientName: 'عميل اختبار', contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-09-25', notes: '' })
    const cost = useDataStore.getState().addProjectCost({ projectId: project.id, kind: 'materials', amountMinor: 1000, payment: 'credit', description: 'حديد', costCenterId: center.id })
    expect(cost).toMatchObject({ projectId: project.id, costCenterId: center.id })
    const entry = useDataStore.getState().journal.find(row => row.id === cost.journalEntryId)
    expect(entry?.lines.find(line => line.accountCode === '5110')).toMatchObject({ costCenterId: center.id, debit: 1000 })
  })

  it('يدعم شجرة المراكز وموازنتها وتوزيع السطر دون فقد مليم', () => {
    const root = useDataStore.getState().addCostCenter({ code: 'OPS', nameAr: 'تشغيل' })
    const child = useDataStore.getState().addCostCenter({ code: 'OPS-1', nameAr: 'فرع 1', parentId: root.id })
    expect(useDataStore.getState().costCenters.find(center => center.id === child.id)?.parentId).toBe(root.id)
    expect(() => useDataStore.getState().updateCostCenter(root.id, { parentId: child.id })).toThrow('دورة')
    const budget = useDataStore.getState().addCostCenterBudget({ costCenterId: child.id, from: '2026-09-01', to: '2026-09-30', amountMinor: 1000, notes: '' })
    const line = { accountCode: '5108', debit: 100, credit: 0, note: 'توزيع' }
    const split = allocateJournalLine(line, [{ costCenterId: root.id, weight: 1 }, { costCenterId: child.id, weight: 2 }])
    expect(split.map(row => row.debit)).toEqual([33, 67])
    expect(split.reduce((sum, row) => sum + row.debit, 0)).toBe(100)
    const entry = { id: 8, entryNumber: 8, date: '2026-09-10', description: 'مصروف', sourceType: 'manual' as const, sourceId: 8, lines: [{ ...split[1], debit: 100 }], createdBy: 'المالك', createdAt: '2026-09-10T00:00:00Z', reversedByEntryId: null, reversesEntryId: null }
    expect(costCenterBudgetReport([budget], [entry], { from: '2026-09-01', to: '2026-09-30' }, new Set())[0]).toMatchObject({ actualMinor: 100, varianceMinor: 900 })
  })
})
