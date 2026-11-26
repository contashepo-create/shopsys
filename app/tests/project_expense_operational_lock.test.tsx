import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const mock = vi.hoisted(() => ({ pauseBefore: false, failAfter: false }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => {
 if (mock.pauseBefore) { const { useRawDataStore } = await import('../src/data/repo.ts'); const s = useRawDataStore.getState(); s.setProjectOperationalStatus({ projectId: s.projects[0].id, expected: 'running', status: 'on_hold', reason: 'تأجيل متزامن' }) }
 const result = commit(); if (mock.failAfter) throw new Error('فشل الحفظ'); return result
} }))
import { ProjectExpenseWindowView } from '../src/ui/windows/ProjectExpenseWindowView.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[], vatPercent: 0, allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, loggedOut: false, appUsers: [], branches: [], activeBranchId: null, projects: [], projectCosts: [], boqItems: [], projectExtracts: [], journal: [], suppliers: [], custodyFiles: [], treasuries: [{ code: '1101', nameAr: 'خزينة', kind: 'cash', isDefault: true }] } as never)
 S().addProject({ nameAr: 'مشروع', clientName: '', contractValueMinor: 100000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
 mock.pauseBefore = false; mock.failAfter = false; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function open() {
 render(<MemoryRouter><ProjectExpenseWindowView /><ToastHost /></MemoryRouter>)
 fireEvent.change(document.querySelector('[data-expense-line-desc]')!, { target: { value: 'مواد' } })
 fireEvent.change(document.querySelector('[data-expense-line-price]')!, { target: { value: '100' } })
 fireEvent.change(document.querySelector('[data-expense-paid-now]')!, { target: { value: '100' } })
 return document.querySelector('[data-save-project-expense]') as HTMLButtonElement
}
it('يعيد فحص التوقف بعد انتظار قفل الترحيل', async () => {
 mock.pauseBefore = true
 const button = open(); fireEvent.click(button)
 await waitFor(() => expect(S().projects[0].operationalStatus).toBe('on_hold'))
 expect(S().projectCosts).toHaveLength(0)
 expect(S().journal).toHaveLength(0)
})
it('يمنع تكرار المصروف عند تعذر تأكيد الحفظ', async () => {
 mock.failAfter = true
 const button = open(); fireEvent.click(button)
 await waitFor(() => expect(screen.getByText(/تعذر تأكيد حفظه/)).toBeTruthy())
 expect(S().projectCosts).toHaveLength(1)
 expect(button.disabled).toBe(true)
 fireEvent.click(button)
 expect(S().projectCosts).toHaveLength(1)
})
