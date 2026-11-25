import { afterEach, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { JournalEntry } from '../src/core/ledger.ts'
import { balanceSheet, cashFlowReport, generalLedger, incomeStatement, vatReport } from '../src/core/financialReports.ts'
import { financialComparison } from '../src/core/financialComparison.ts'
import { FinancialReportsTab } from '../src/ui/pages/FinancialReportsTab.tsx'
import { useRawDataStore } from '../src/data/repo.ts'

const original = useRawDataStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(original) })
const line = (accountCode: string, debit: number, credit: number) => ({ accountCode, debit, credit })
const entry = (id: number, date: string, lines: JournalEntry['lines'], sourceType: JournalEntry['sourceType'] = 'manual'): JournalEntry => ({ id, entryNumber: id, date, description: 'قيد', sourceType, sourceId: null, lines, branchId: 1, createdAt: date, createdBy: 'م', reversesEntryId: null, reversedByEntryId: null })
const p = { from: '2024-01-01', to: '2024-12-31' }
const future = '2025-01-01'

it('لا تغيّر روابط الإقفال المستقبلية نتيجة الدخل أو المركز السابق', () => {
 const reversal = { ...entry(1, '2024-02-01', [line('1101', 100, 0), line('4101', 0, 100)], 'reversal'), reversesEntryId: 2 }
 const closing = entry(2, future, [line('4101', 100, 0), line('3102', 0, 100)], 'year_closing')
 expect(incomeStatement([reversal, closing], p)).toEqual(incomeStatement([reversal], p))
 expect(incomeStatement([reversal, closing], p).netProfitMinor).toBe(100)
 expect(balanceSheet([reversal, closing], p.to)).toEqual(balanceSheet([reversal], p.to))
})
it('لا يستنتج التدفق أو الضريبة أصل عكس من قيد مستقبلي', () => {
 const reversal = { ...entry(1, '2024-02-01', [line('1101', 100, 0), line('2102', 0, 100)], 'reversal'), reversesEntryId: 2 }
 const opening = entry(2, future, [line('1101', 100, 0), line('2102', 0, 100)], 'opening')
 expect(cashFlowReport([reversal, opening], ['1101'], p)).toEqual(cashFlowReport([reversal], ['1101'], p))
 expect(cashFlowReport([reversal, opening], ['1101'], p).netChangeMinor).toBe(100)
 expect(vatReport([reversal, opening], p)).toEqual(vatReport([reversal], p))
 expect(vatReport([reversal, opening], p).outputVatMinor).toBe(100)
})
it('تجاهل القيود المستقبلية التالفة لا يمنع الأستاذ أو التدفق أو المقارنة السابقة', () => {
 const base = [entry(1, '2024-06-01', [line('1101', 100, 0), line('4101', 0, 100)])]
 const corrupt = { ...entry(2, future, []), lines: null } as unknown as JournalEntry
 expect(generalLedger([...base, corrupt], '1101', p)).toEqual(generalLedger(base, '1101', p))
 expect(cashFlowReport([...base, corrupt], ['1101'], p)).toEqual(cashFlowReport(base, ['1101'], p))
 const prior = { from: '2023-01-01', to: '2023-12-31' }
 expect(financialComparison([...base, corrupt], p, prior, ['1101'])).toEqual(financialComparison(base, p, prior, ['1101']))
})
it('لا يخفي قيد بعد نهاية المقارنة التاريخية حركة حقوق ملكية سابقة', () => {
 const reversal = { ...entry(1, '2023-06-01', [line('1101', 100, 0), line('3101', 0, 100)], 'reversal'), reversesEntryId: 2 }
 const closing = entry(2, '2024-02-01', [line('4101', 100, 0), line('3102', 0, 100)], 'year_closing')
 const result = financialComparison([reversal, closing], p, { from: '2023-01-01', to: '2023-12-31' }, ['1101'])
 expect(result.sections.flatMap(section => section.rows).find(row => row.key === 'equity-direct')?.priorMinor).toBe(100)
})
it('تعرض الواجهة الأستاذ والتدفق رغم تلف قيد مستقبلي، وتحجب قيداً تالفاً داخل الفترة', () => {
 const valid = entry(1, '2024-06-01', [line('1101', 100, 0), line('4101', 0, 100)])
 const corrupt = { ...entry(2, future, []), lines: null } as unknown as JournalEntry
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: 1, branches: [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }], journal: [valid, corrupt], treasuries: [{ code: '1101', nameAr: 'النقدية', kind: 'cash', isDefault: true }], customAccounts: [] } as never)
 render(<FinancialReportsTab period={p} cur={{ code: 'SAR', symbol: 'ر.س', name: 'ريال', decimals: 2 }} companyName="شركة" />)
 fireEvent.change(screen.getByRole('combobox'), { target: { value: 'gl' } })
 expect(screen.queryByText(/تعذر إعداد التقرير/)).toBeNull()
 fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'cash_flow' } })
 expect(screen.queryByText(/تعذر إعداد التقرير/)).toBeNull()
 act(() => { useRawDataStore.setState({ journal: [valid, { ...corrupt, date: '2024-03-01' }] }) })
 expect(screen.getByText(/تعذر إعداد التقرير/)).toBeTruthy()
})

it('يظل أصل الافتتاح الظاهر وعكسه مستبعدين من الدخل ومصنفين كتسوية نقدية', () => {
 const opening = entry(1, '2024-01-10', [line('1101', 100, 0), line('4101', 0, 100)], 'opening')
 const reversal = { ...entry(2, '2024-02-01', [line('4101', 100, 0), line('1101', 0, 100)], 'reversal'), reversesEntryId: 1 }
 expect(incomeStatement([opening, reversal], p).netProfitMinor).toBe(0)
 expect(cashFlowReport([opening, reversal], ['1101'], p)).toMatchObject({ openingBalanceAdjustmentsMinor: 0, netChangeMinor: 0, closingCashMinor: 0 })
})
it('يُفحص القيد التالف بتاريخ غير معروف بدلاً من افتراض أنه مستقبلي', () => {
 const badDate = { ...entry(2, future, []), date: 'not-a-date' }
 expect(() => financialComparison([badDate], p, { from: '2023-01-01', to: '2023-12-31' }, ['1101'])).toThrow(/#2/)
})

it('لا تنهار تصفية الفرع الرئيسي عند قيد غير مسند تالف، ويظهر الحجب إذا دخل الفترة', () => {
 const valid = entry(1, '2024-06-01', [line('1101', 100, 0), line('4101', 0, 100)])
 const corrupt = { ...entry(2, future, []), branchId: undefined, lines: null } as unknown as JournalEntry
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: 1, branches: [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }], journal: [valid, corrupt], treasuries: [{ code: '1101', nameAr: 'النقدية', kind: 'cash', isDefault: true }], customAccounts: [] } as never)
 render(<FinancialReportsTab period={p} cur={{ code: 'SAR', symbol: 'ر.س', name: 'ريال', decimals: 2 }} companyName="شركة" />)
 expect(screen.queryByText(/تعذر إعداد التقرير/)).toBeNull()
 act(() => { useRawDataStore.setState({ journal: [valid, { ...corrupt, date: '2024-03-01' }] }) })
 expect(screen.getByText(/تعذر إعداد التقرير/).textContent).toContain('#2')
})
