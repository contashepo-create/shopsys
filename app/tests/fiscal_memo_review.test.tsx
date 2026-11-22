import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { reviewFiscalCloseJournal } from '../src/core/fiscalCloseReview.ts'
import { financialComparison } from '../src/core/financialComparison.ts'
import { financialPositionReview } from '../src/core/financialPositionReview.ts'
import { fiscalCloseStateRepairs, isFiscalCloseBasisValid, type FiscalYear } from '../src/core/fiscal.ts'
import type { JournalEntry } from '../src/core/ledger.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { GeneralSettingsPage } from '../src/ui/pages/GeneralSettingsPage.tsx'

const app = useAppStore.getState(), data = useRawDataStore.getState()
const year: FiscalYear = { id: 1, nameAr: '2024', startDate: '2024-01-01', endDate: '2024-12-31', status: 'open' }
const entry: JournalEntry = { id: 1, entryNumber: 1, date: '2024-06-01', description: 'إيراد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 10000, credit: 0 }, { accountCode: '4101', debit: 0, credit: 10000 }], createdAt: '2024-06-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
const memo: JournalEntry = { ...entry, id: 2, entryNumber: 2, sourceType: 'sale', sourceId: 12, sourceCollection: 'sales', description: 'قيد تذكاري لتوثيق مستخلص', lines: [], memoOnly: true }
const current = { from: '2024-01-01', to: '2024-12-31' }, prior = { from: '2023-01-01', to: '2023-12-31' }
beforeEach(() => { useAppStore.setState({ ...app, activeBranchContext: null, fiscalYears: [year] }); useRawDataStore.setState({ ...data, loggedOut: false, currentUserId: null, branches: [], activeBranchId: null, journal: [entry, memo] }) })
afterEach(() => { cleanup(); useRawDataStore.setState(data); useAppStore.setState(app) })

it('يقبل التذكاري الصريح ذي السطور الفارغة دون تغيير القوائم، مع احتسابه ضمن عدد القيود المفحوصة', () => {
 expect(reviewFiscalCloseJournal([entry, memo], year)).toMatchObject({ valid: true, checkedEntries: 2, periodEntries: 2, visibleUnassignedEntries: 2, invalidEntryIds: [] })
 expect(financialPositionReview([entry, memo], '2024-12-31', ['2023-12-31'])).toEqual(financialPositionReview([entry], '2024-12-31', ['2023-12-31']))
 expect(financialComparison([entry, memo], current, prior, ['1101'])).toEqual(financialComparison([entry], current, prior, ['1101']))
})

it('لا يحوّل التذكاري وحده إلى حركة إيرادات قابلة للإقفال', () => {
 useRawDataStore.setState({ journal: [memo] })
 expect(reviewFiscalCloseJournal([memo], year).valid).toBe(true)
 expect(() => useRawDataStore.getState().closeFiscalYear(year, [year])).toThrow(/لا حركة إيرادات أو مصروفات/)
 expect(useRawDataStore.getState().journal).toEqual([memo])
 expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
})

it('يرفض المالي الموسوم تذكارياً والفارغ غير الموسوم والأشكال التالفة والمعرف المكرر', () => {
 const bad: JournalEntry[] = [
  { ...memo, lines: entry.lines },
  { ...memo, memoOnly: false },
  { ...memo, memoOnly: undefined },
  { ...memo, lines: null as never },
  { ...memo, memoOnly: 'true' as never },
  { ...memo, id: entry.id },
  { ...memo, date: '2024-02-30' },
 ]
 for (const invalid of bad) {
  const journal = [entry, invalid]
  expect(reviewFiscalCloseJournal(journal, year).valid).toBe(false)
  expect(() => financialPositionReview(journal, '2024-12-31', [])).toThrow(/غير سليمة/)
  expect(() => financialComparison(journal, current, prior, ['1101'])).toThrow(/غير سليمة/)
  useRawDataStore.setState({ journal })
  expect(() => useRawDataStore.getState().closeFiscalYear(year, [year])).toThrow(/قيود غير سليمة/)
  expect(useRawDataStore.getState().journal).toBe(journal)
  expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
 }
})

it('تتيح مراجعة الإقفال والإقفال واستعادة حالته وإعادة فتحه مع التذكاري الصريح', () => {
 render(<MemoryRouter><GeneralSettingsPage /></MemoryRouter>)
 fireEvent.click(screen.getByText('🔒 إقفال السنة'))
 expect(screen.getByLabelText('مراجعة الدفتر قبل الإقفال').textContent).toContain('القيود المفحوصة: 2')
 expect(screen.getByText('🔒 تأكيد الإقفال').closest('button')?.disabled).toBe(false)
 fireEvent.click(screen.getByText('🔒 تأكيد الإقفال'))
 const closed = useAppStore.getState().fiscalYears[0]
 expect(closed.status).toBe('closed')
 expect(useRawDataStore.getState().journal[2].lines).toEqual([{ accountCode: '4101', debit: 10000, credit: 0, note: 'إقفال إيراد سنة 2024' }, { accountCode: '3102', debit: 0, credit: 10000, note: 'صافي ربح سنة 2024 → أرباح مرحّلة' }])
 expect(fiscalCloseStateRepairs([year], useRawDataStore.getState().journal)).toEqual({ closeIds: [1], reopenIds: [] })
 const close = useRawDataStore.getState().journal[2]
 expect(isFiscalCloseBasisValid([entry, { ...memo, lines: entry.lines }, close], year, close)).toBe(false)
 expect(isFiscalCloseBasisValid([entry, { ...memo, memoOnly: 0 as never }, close], year, close)).toBe(false)
 expect(() => useRawDataStore.getState().reopenFiscalYear(closed, [closed])).not.toThrow()
 expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
})
