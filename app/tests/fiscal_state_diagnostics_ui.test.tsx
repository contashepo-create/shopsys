import { afterEach, beforeEach, expect, it } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GeneralSettingsPage } from '../src/ui/pages/GeneralSettingsPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import type { FiscalYear } from '../src/core/fiscal.ts'
import type { JournalEntry } from '../src/core/ledger.ts'

const savedData = useRawDataStore.getState(), savedApp = useAppStore.getState()
const year: FiscalYear = { id: 1, branchId: 1, nameAr: '2024', startDate: '2024-01-01', endDate: '2024-12-31', status: 'open' }
const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'فرع سري', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
const close: JournalEntry = { id: 8, entryNumber: 8, branchId: 1, date: '2024-12-31', description: 'قيد سري', sourceType: 'year_closing', sourceId: 1, sourceCollection: 'fiscalYears', lines: [{ accountCode: '4101', debit: 100, credit: 0 }, { accountCode: '3102', debit: 0, credit: 100 }], createdAt: '2024-12-31', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
const message = /حالة السنة أو دليل إقفالها الظاهر يحتاج مراجعة محاسبية/
beforeEach(() => {
  useAppStore.setState({ ...savedApp, fiscalYears: [year] })
  useRawDataStore.setState({ ...savedData, branches, activeBranchId: 1, currentUserId: null, loggedOut: false, appUsers: [], journal: [close] })
  useAppStore.getState().setActiveBranchContext(branches[0])
})
afterEach(() => { cleanup(); useRawDataStore.setState(savedData); useAppStore.getState().setActiveBranchContext(null); useAppStore.setState(savedApp) })

it('يعرض المؤشر ويتحدث مع حالة السنة والدفتر دون تعديل أي منهما', async () => {
  const originalJournal = useRawDataStore.getState().journal
  render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
  const warning = screen.getByText(message)
  expect(warning.getAttribute('role')).toBe('alert')
  expect(warning.textContent).not.toMatch(/#8|قيد سري/)
  expect(useRawDataStore.getState().journal).toBe(originalJournal)
  expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
  await act(async () => { useAppStore.setState({ fiscalYears: [{ ...year, status: 'closed' }] }) })
  expect(screen.queryByText(message)).toBeNull()
  await act(async () => { useRawDataStore.setState({ journal: [] }) })
  expect(screen.getByText(message)).toBeTruthy()
  expect(useAppStore.getState().fiscalYears[0].status).toBe('closed')
})

it('يعرض تحذير العكس غير المكتمل ويزيله بعد اكتمال الدليل الظاهر دون إصلاح تلقائي', async () => {
  const reversedClose = { ...close, reversedByEntryId: 9 }
  const reversal: JournalEntry = { ...close, id: 9, entryNumber: 9, sourceType: 'reversal', sourceId: 8, reversesEntryId: 8, reversedByEntryId: null, lines: close.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
  useRawDataStore.setState({ journal: [reversedClose] })
  render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
  expect(screen.getByText(message)).toBeTruthy()
  const completed = [reversedClose, reversal]
  await act(async () => { useRawDataStore.setState({ journal: completed }) })
  expect(screen.queryByText(message)).toBeNull()
  expect(useRawDataStore.getState().journal).toBe(completed)
  expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
})

it('ينبه لحركة بين الإقفال وعكسه الظاهر ويتغير دون تعديل الدفتر', async () => {
  const closing = { ...close, reversedByEntryId: 9 }
  const reverse: JournalEntry = { ...close, id: 9, entryNumber: 9, sourceType: 'reversal', sourceId: 8, reversesEntryId: 8, lines: close.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
  const activity: JournalEntry = { ...close, id: 10, entryNumber: 10, sourceType: 'manual', sourceId: null, date: '2024-06-01', description: 'حركة خاصة' }
  const journal = [closing, activity, reverse]
  useRawDataStore.setState({ journal })
  render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
  expect(screen.getByText(message).textContent).not.toMatch(/حركة خاصة|#10/)
  expect(useRawDataStore.getState().journal).toBe(journal)
  expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
  await act(async () => { useRawDataStore.setState({ journal: [closing, reverse, activity] }) })
  expect(screen.queryByText(message)).toBeNull()
})

it('يتوافق تنبيه التسلسل مع رفض الإقفال بعد دورة إقفال وفتح حقيقية', () => {
  const sale: JournalEntry = { ...close, id: 1, entryNumber: 1, sourceType: 'manual', sourceId: null, date: '2024-06-01', lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }] }
  useRawDataStore.setState({ journal: [sale] })
  useRawDataStore.getState().closeFiscalYear(year, [year])
  const closed = useAppStore.getState().fiscalYears[0]
  useRawDataStore.getState().reopenFiscalYear(closed, [closed])
  const reopened = useAppStore.getState().fiscalYears[0]
  const [first, closing, reverse] = useRawDataStore.getState().journal
  const journal = [first, closing, { ...sale, id: 50, entryNumber: 50, description: 'حركة بينية' }, reverse]
  useRawDataStore.setState({ journal })
  render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
  expect(screen.getByText(message).textContent).not.toMatch(/حركة بينية|#50/)
  expect(() => useRawDataStore.getState().closeFiscalYear(reopened, [reopened])).toThrow(/عكس|حركة/)
  expect(useRawDataStore.getState().journal).toBe(journal)
  expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
})

it('ينبه لحركة لاحقة ظاهرة في سنة مقفلة دون تسريب تفاصيل أو تغيير البيانات', async () => {
  const closed = { ...year, status: 'closed' as const }
  useAppStore.setState({ fiscalYears: [closed] })
  useRawDataStore.setState({ journal: [close] })
  render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
  expect(screen.queryByText(message)).toBeNull()
  const later: JournalEntry = { ...close, id: 10, entryNumber: 10, sourceType: 'manual', sourceId: null, date: '2024-06-01', description: 'حركة خاصة' }
  const journal = [close, later]
  await act(async () => { useRawDataStore.setState({ journal }) })
  expect(screen.getByText(message).textContent).not.toMatch(/حركة خاصة|#10/)
  expect(useRawDataStore.getState().journal).toBe(journal)
  expect(useAppStore.getState().fiscalYears[0].status).toBe('closed')
  await act(async () => { useRawDataStore.setState({ journal: [close, { ...later, date: '2025-01-01' }] }) })
  expect(screen.queryByText(message)).toBeNull()
})

it('لا يعرض حالة غير معروفة كمفتوحة ولا يتيح إجراءات الإقفال أو التقرير لها', () => {
  useAppStore.setState({ fiscalYears: [{ ...year, status: 'broken' as FiscalYear['status'] }] })
  useRawDataStore.setState({ journal: [] })
  render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
  const section = screen.getByText('السنوات المالية').closest('section')!
  expect(within(section).getByText('حالة غير معروفة')).toBeTruthy()
  expect(within(section).getByText(message)).toBeTruthy()
  expect(within(section).queryByText(/مفتوحة — جارية|إقفال السنة|تقرير السنة|إعادة فتح/)).toBeNull()
})

it('لا يعتمد على قيود الفرع الآخر ولا يكشف تفاصيلها في قائمة السنة', () => {
  useRawDataStore.setState({ journal: [{ ...close, branchId: 2 }] })
  render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
  expect(screen.queryByText(message)).toBeNull()
  const section = screen.getByText('السنوات المالية').closest('section')!
  expect(within(section).queryByText(/قيد سري|فرع سري|#8/)).toBeNull()
  expect(within(section).getByText(/غياب التنبيه لا يثبت/)).toBeTruthy()
})
