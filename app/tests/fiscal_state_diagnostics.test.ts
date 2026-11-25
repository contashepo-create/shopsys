import { describe, expect, it } from 'vitest'
import { fiscalYearStateWarnings } from '../src/core/fiscalStateDiagnostics.ts'
import type { FiscalYear } from '../src/core/fiscal.ts'
import type { JournalEntry } from '../src/core/ledger.ts'

const year: FiscalYear = { id: 1, nameAr: '2024', branchId: 1, startDate: '2024-01-01', endDate: '2024-12-31', status: 'open' }
const close: JournalEntry = { id: 8, entryNumber: 8, branchId: 1, date: '2024-12-31', description: 'إقفال', sourceType: 'year_closing', sourceId: 1, sourceCollection: 'fiscalYears', lines: [{ accountCode: '4101', debit: 100, credit: 0 }, { accountCode: '3102', debit: 0, credit: 100 }], createdAt: '2024-12-31', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }

describe('تنبيه حالة السنة مقابل قيود الإقفال الظاهرة', () => {
  it('ينبه عندما تظل السنة مفتوحة وبها إقفال نشط', () => {
    expect(fiscalYearStateWarnings([year], [close])).toEqual([1])
    expect(fiscalYearStateWarnings([year], [])).toEqual([])
    expect(fiscalYearStateWarnings([year], [{ ...close, reversedByEntryId: 9 }])).toEqual([1])
  })
  it('ينبه إذا كانت السنة مقفلة بلا قيد أو بجميع القيود المعكوسة', () => {
    const closed = { ...year, status: 'closed' as const }
    expect(fiscalYearStateWarnings([closed], [])).toEqual([1])
    expect(fiscalYearStateWarnings([closed], [{ ...close, reversedByEntryId: 9 }])).toEqual([1])
    expect(fiscalYearStateWarnings([closed], [close])).toEqual([])
  })
  it('ينبه عن الأدلة المكررة أو التالفة دون اختلاق إصلاح', () => {
    const closed = { ...year, status: 'closed' as const }
    expect(fiscalYearStateWarnings([closed], [close, { ...close, id: 10 }])).toEqual([1])
    expect(fiscalYearStateWarnings([closed], [{ ...close, reversedByEntryId: 0 }])).toEqual([1])
    expect(fiscalYearStateWarnings([closed], [{ ...close, reversesEntryId: 9 }])).toEqual([1])
    expect(fiscalYearStateWarnings([closed], [{ ...close, date: '2024-12-30' }])).toEqual([1])
    expect(fiscalYearStateWarnings([closed], [{ ...close, lines: [] }])).toEqual([1])
    expect(fiscalYearStateWarnings([closed], [{ ...close, lines: [{ ...close.lines[0], debit: 99 }, close.lines[1]] }])).toEqual([1])
    expect(fiscalYearStateWarnings([{ ...year, status: 'broken' as FiscalYear['status'] }], [])).toEqual([1])
    expect(fiscalYearStateWarnings([year, year], [close])).toEqual([1])
  })
  it('يفحص روابط العكس الظاهرة دون اعتبار رابط منفرد دليلاً', () => {
    const closed = { ...close, reversedByEntryId: 9 }
    const reverse: JournalEntry = { ...close, id: 9, entryNumber: 9, sourceType: 'reversal', sourceId: 8, reversesEntryId: 8, reversedByEntryId: null, lines: close.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
    expect(fiscalYearStateWarnings([year], [closed, reverse])).toEqual([])
    expect(fiscalYearStateWarnings([year], [closed, { ...reverse, lines: close.lines }])).toEqual([1])
    expect(fiscalYearStateWarnings([year], [reverse, closed])).toEqual([1])
    expect(fiscalYearStateWarnings([year], [closed, reverse, { ...reverse, id: 10 }])).toEqual([1])
    expect(fiscalYearStateWarnings([year], [close, reverse])).toEqual([1])
    expect(fiscalYearStateWarnings([{ ...year, status: 'closed' }], [{ ...close, branchId: 2 }])).toEqual([1])
  })
  it('ينبه لحركة ظاهرة بعد الإقفال النشط داخل الفترة أو بتاريخ مجهول فقط', () => {
    const closed = { ...year, status: 'closed' as const }
    const activity: JournalEntry = { ...close, id: 10, entryNumber: 10, sourceType: 'manual', sourceId: null, date: '2024-06-01' }
    expect(fiscalYearStateWarnings([closed], [close, activity], 1)).toEqual([1])
    expect(fiscalYearStateWarnings([closed], [close, { ...activity, date: '2024-02-30' }], 1)).toEqual([1])
    expect(fiscalYearStateWarnings([closed], [close, { ...activity, date: '2025-01-01' }], 1)).toEqual([])
    expect(fiscalYearStateWarnings([closed], [close, { ...activity, branchId: 2 }], 1)).toEqual([])
    expect(fiscalYearStateWarnings([closed], [close, { ...activity, branchId: undefined }], 1)).toEqual([1])
    const reversed = { ...close, reversedByEntryId: 9 }
    const reverse: JournalEntry = { ...close, id: 9, sourceType: 'reversal', sourceId: 8, reversesEntryId: 8, lines: close.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
    expect(fiscalYearStateWarnings([year], [reversed, reverse, activity], 1)).toEqual([])
  })
  it('ينبه للحركة بين الإقفال وعكسه لا للحركة بعد العكس المثبت', () => {
    const closing = { ...close, reversedByEntryId: 9 }
    const reverse: JournalEntry = { ...close, id: 9, sourceType: 'reversal', sourceId: 8, reversesEntryId: 8, lines: close.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
    const activity: JournalEntry = { ...close, id: 10, sourceType: 'manual', sourceId: null, date: '2024-07-01' }
    expect(fiscalYearStateWarnings([year], [closing, activity, reverse], 1)).toEqual([1])
    expect(fiscalYearStateWarnings([year], [closing, { ...activity, date: '2024-12-31' }, reverse], 1)).toEqual([1])
    expect(fiscalYearStateWarnings([year], [closing, { ...activity, date: '2024-02-30' }, reverse], 1)).toEqual([1])
    expect(fiscalYearStateWarnings([year], [closing, { ...activity, branchId: undefined }, reverse], 1)).toEqual([1])
    expect(fiscalYearStateWarnings([year], [closing, { ...activity, branchId: 2 }, reverse], 1)).toEqual([])
    expect(fiscalYearStateWarnings([year], [closing, { ...activity, date: '2025-01-01' }, reverse], 1)).toEqual([])
    expect(fiscalYearStateWarnings([year], [closing, reverse, activity], 1)).toEqual([])
  })
  it('ينبه عندما لا يتبع العكس إسناد الإقفال وفق الفرع الرئيسي', () => {
    const closing = { ...close, branchId: 2, reversedByEntryId: 9 }
    const reverse: JournalEntry = { ...closing, id: 9, branchId: undefined, sourceType: 'reversal', sourceId: 8, reversesEntryId: 8, reversedByEntryId: null, lines: close.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
    expect(fiscalYearStateWarnings([{ ...year, branchId: 2 }], [closing, reverse], 1)).toEqual([1])
    expect(fiscalYearStateWarnings([year], [{ ...closing, branchId: 1 }, reverse], 1)).toEqual([])
  })
  it('ينبه إلى تاريخ أو اسم سنة تالف دون تعطيل العرض', () => {
    expect(fiscalYearStateWarnings([{ ...year, startDate: '2024-02-30' }], [])).toEqual([1])
    expect(fiscalYearStateWarnings([{ ...year, endDate: '2023-12-31' }], [])).toEqual([1])
    expect(fiscalYearStateWarnings([{ ...year, nameAr: null as unknown as string }], [])).toEqual([1])
  })
  it('يستخدم فقط السنوات والقيود الممررة إليه ولا يتعطل بصف تالف', () => {
    const second = { ...year, id: 2, branchId: 2, nameAr: 'فرع آخر', status: 'closed' as const }
    const otherClose = { ...close, id: 22, branchId: 2, sourceId: 2 }
    expect(fiscalYearStateWarnings([year], [otherClose, null as unknown as JournalEntry])).toEqual([])
    expect(fiscalYearStateWarnings([second], [otherClose])).toEqual([])
  })
})
