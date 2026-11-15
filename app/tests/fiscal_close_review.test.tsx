import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { reviewFiscalCloseJournal } from '../src/core/fiscalCloseReview.ts'
import type { FiscalYear } from '../src/core/fiscal.ts'
import type { JournalEntry } from '../src/core/ledger.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { GeneralSettingsPage } from '../src/ui/pages/GeneralSettingsPage.tsx'

const app = useAppStore.getState(), data = useRawDataStore.getState()
const year: FiscalYear = { id: 1, nameAr: '2024', startDate: '2024-01-01', endDate: '2024-12-31', status: 'open' }
const entry: JournalEntry = { id: 1, entryNumber: 1, date: '2024-06-01', description: 'حركة', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 10000, credit: 0 }, { accountCode: '4101', debit: 0, credit: 10000 }], createdAt: '2024-06-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
beforeEach(() => { useAppStore.setState({ ...app, activeBranchContext: null, fiscalYears: [year] }); useRawDataStore.setState({ ...data, loggedOut: false, currentUserId: null, branches: [], activeBranchId: null, journal: [entry] }) })
afterEach(() => { cleanup(); useRawDataStore.setState(data); useAppStore.setState(app) })

it('يكشف القيود غير المتوازنة وتواريخها وأرقامها المكررة وما لا ينتمي للفترة', () => {
 expect(reviewFiscalCloseJournal([entry], year)).toMatchObject({ valid: true, checkedEntries: 1, periodEntries: 1, visibleUnassignedEntries: 1 })
 expect(reviewFiscalCloseJournal([entry, { ...entry, id: 2, lines: [{ accountCode: '1101', debit: 5, credit: 0 }] }], year).invalidEntryIds).toEqual([2])
 expect(reviewFiscalCloseJournal([entry, { ...entry, date: '2024-02-30' }], year).valid).toBe(false)
 expect(reviewFiscalCloseJournal([entry, entry], year).valid).toBe(false)
 expect(reviewFiscalCloseJournal([entry, { ...entry, id: 2, date: '2025-01-01', lines: [] }], year).valid).toBe(true)
})
it('يحجب الإقفال عند وجود قيد سابق تالف دون تغيير الدفتر أو حالة السنة', () => {
 const broken = { ...entry, id: 2, date: '2023-12-31', lines: [{ accountCode: '1101', debit: 100, credit: 0 }] }
 useRawDataStore.setState({ journal: [entry, broken] })
 const before = useRawDataStore.getState().journal
 expect(() => useRawDataStore.getState().closeFiscalYear(year, [year])).toThrow(/قيود غير سليمة/)
 expect(useRawDataStore.getState().journal).toBe(before)
 expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
})
it('تعرض النافذة فحصاً تمهيدياً وحدوده قبل التأكيد وتسمح بالإقفال عند سلامة البنية', () => {
 render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
 fireEvent.click(screen.getByText('🔒 إقفال السنة'))
 const review = screen.getByLabelText('مراجعة الدفتر قبل الإقفال')
 expect(review.textContent).toContain('القيود المفحوصة: 1'); expect(review.textContent).toContain('الفحص لا يثبت صحة إسناد الفروع')
 expect(review.textContent).toContain('صافي قيد الإقفال المتوقع')
 expect(screen.getByText('🔒 تأكيد الإقفال').closest('button')?.disabled).toBe(false)
 fireEvent.click(screen.getByText('🔒 تأكيد الإقفال'))
 expect(useAppStore.getState().fiscalYears[0].status).toBe('closed')
})
it('تظهر النافذة القيد المختل وتعطّل التأكيد', () => {
 useRawDataStore.setState({ journal: [{ ...entry, lines: [{ accountCode: '1101', debit: 100, credit: 0 }] }] })
 render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
 fireEvent.click(screen.getByText('🔒 إقفال السنة'))
 expect(screen.getByLabelText('مراجعة الدفتر قبل الإقفال').textContent).toContain('#1')
 expect(screen.getByText('🔒 تأكيد الإقفال').closest('button')?.disabled).toBe(true)
})
