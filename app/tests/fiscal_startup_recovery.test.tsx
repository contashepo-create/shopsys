import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import App from '../src/App.tsx'
import * as fiscalRepair from '../src/data/fiscalStateRepair.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import type { FiscalYear } from '../src/core/fiscal.ts'
import type { JournalEntry } from '../src/core/ledger.ts'

const savedApp = useAppStore.getState(), savedData = useRawDataStore.getState()
const year: FiscalYear = { id: 1, branchId: 1, nameAr: '2024', startDate: '2024-01-01', endDate: '2024-12-31', status: 'open' }
const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
const activity: JournalEntry = { id: 1, entryNumber: 1, branchId: 1, date: '2024-06-01', description: 'إيراد', sourceType: 'manual', sourceId: null, lines: [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], createdAt: '2024-06-01', createdBy: 'م', reversedByEntryId: null, reversesEntryId: null }
const hidden: JournalEntry = { ...activity, id: 10, entryNumber: 10, branchId: 2, sourceType: 'reversal', sourceId: 1, reversesEntryId: 1, lines: activity.lines.map(line => ({ ...line, debit: line.credit, credit: line.debit })) }
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
  useAppStore.setState({ ...savedApp, fiscalYears: [year] })
  useRawDataStore.setState({ ...savedData, branches, activeBranchId: 1, currentUserId: null, loggedOut: false, appUsers: [], journal: [activity] })
  useRawDataStore.getState().closeFiscalYear(year, [year])
  useAppStore.setState({ fiscalYears: [year] })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); useRawDataStore.setState(savedData); useAppStore.setState(savedApp) })

describe('استعادة حالة السنة عند تشغيل التطبيق', () => {
  it('لا تغلق السنة عند مطالبة عكس مخفية رغم أن قيد الإقفال محفوظ', async () => {
    const journal = [...useRawDataStore.getState().journal, hidden]
    useRawDataStore.setState({ journal })
    const review = vi.spyOn(fiscalRepair, 'guardedFiscalStateRepairs')
    render(<App />)
    await waitFor(() => expect(review).toHaveBeenCalled())
    expect(useAppStore.getState().fiscalYears[0].status).toBe('open')
    expect(useRawDataStore.getState().journal).toBe(journal)
  })
  it('يستعيد حالة الإقفال السليم بعد التحميل', async () => {
    render(<App />)
    await waitFor(() => expect(useAppStore.getState().fiscalYears[0].status).toBe('closed'))
  })
  it('لا يستعيد الفتح بعد الانقطاع عند وجود مطالبة عكس مخفية', async () => {
    const closed = { ...year, status: 'closed' as const }
    useAppStore.setState({ fiscalYears: [closed] })
    useRawDataStore.getState().reopenFiscalYear(closed, [closed])
    const journal = [...useRawDataStore.getState().journal, hidden]
    useRawDataStore.setState({ journal }); useAppStore.setState({ fiscalYears: [closed] })
    const review = vi.spyOn(fiscalRepair, 'guardedFiscalStateRepairs')
    render(<App />)
    await waitFor(() => expect(review).toHaveBeenCalled())
    expect(useAppStore.getState().fiscalYears[0].status).toBe('closed')
    expect(useRawDataStore.getState().journal).toBe(journal)
  })
  it('يستعيد الفتح عند وجود عكس إقفال سليم بلا مطالبة مخفية', async () => {
    const closed = { ...year, status: 'closed' as const }
    useAppStore.setState({ fiscalYears: [closed] })
    useRawDataStore.getState().reopenFiscalYear(closed, [closed])
    useAppStore.setState({ fiscalYears: [closed] })
    render(<App />)
    await waitFor(() => expect(useAppStore.getState().fiscalYears[0].status).toBe('open'))
  })
})
