import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const lock = vi.hoisted(() => ({ failAfter: false, calls: 0 }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => { lock.calls++; const result = commit(); if (lock.failAfter) throw new Error('flush failed'); return result } }))
import { ProjectsPage } from '../src/ui/pages/ContractingPages.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, countryCode: 'EG', modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], projects: [], boqItems: [], projectExtracts: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], changeOrders: [], projectTasks: [], projectCosts: [], subContracts: [], customers: [], employees: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addProject({ nameAr: 'مشروع اختبار', clientName: '', contractValueMinor: 20000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
 lock.failAfter = false; lock.calls = 0; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function open() {
 render(<MemoryRouter><ProjectsPage /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('دفعة مقدمة من العميل'))
 const date = screen.getByLabelText('تاريخ الدفعة') as HTMLInputElement
 const modal = date.closest('[role="dialog"]')!
 const amount = Array.from(modal.querySelectorAll('input')).find(input => input.getAttribute('inputmode') === 'decimal')!
 return { date, amount }
}
it('يعرض تاريخ اليوم ويسجل التاريخ السابق في الدفعة والقيد', async () => {
 const { date, amount } = open()
 expect(date.type).toBe('date'); expect(date.value).toBe(todayLocalIso()); expect(date.max).toBe(todayLocalIso())
 fireEvent.change(date, { target: { value: '2025-05-01' } }); fireEvent.change(amount, { target: { value: '10' } })
 fireEvent.click(screen.getByRole('button', { name: /استلام الدفعة/ }))
 await waitFor(() => expect(S().clientAdvances).toHaveLength(1))
 expect(S().clientAdvances[0].date).toBe('2025-05-01'); expect(S().journal[0].date).toBe('2025-05-01')
 expect(lock.calls).toBe(1)
})
it('يرفض بصمة قديمة بلا مستند جديد أو قيد', async () => {
 const { amount } = open(); fireEvent.change(amount, { target: { value: '10' } })
 S().receiveClientAdvance({ projectId: S().projects[0].id, amountMinor: 500, treasury: '1101' })
 fireEvent.click(screen.getByRole('button', { name: /استلام الدفعة/ }))
 await waitFor(() => expect(screen.getByText(/تغير المشروع أو دفعاته/)).toBeTruthy())
 expect(S().clientAdvances).toHaveLength(1); expect(S().journal).toHaveLength(1)
})
it('بعد فشل تأكيد التخزين يغلق النافذة ويحذر بدل إعادة التسجيل', async () => {
 const { amount } = open(); fireEvent.change(amount, { target: { value: '10' } }); lock.failAfter = true
 fireEvent.click(screen.getByRole('button', { name: /استلام الدفعة/ }))
 await waitFor(() => expect(screen.queryByLabelText('تاريخ الدفعة')).toBeNull())
 expect(S().clientAdvances).toHaveLength(1); expect(S().journal).toHaveLength(1)
 expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy()
})
