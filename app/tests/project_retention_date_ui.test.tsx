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
const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, countryCode: 'EG', modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], projects: [], boqItems: [], projectExtracts: [], projectCosts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], changeOrders: [], projectTasks: [], subContracts: [], customers: [], employees: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 const p = S().addProject({ nameAr: 'مشروع اختبار', clientName: '', contractValueMinor: 20000, retentionPercent: 10, startDate: '2025-01-01', notes: '' })
 S().addProjectExtract({ projectId: p.id, date: '2025-04-30', grossMinor: 1000, payment: 'cash', description: 'أعمال', vatPercent: 0 })
 lock.failAfter = false; lock.calls = 0; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
function open() {
 render(<MemoryRouter><ProjectsPage /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByTitle(/الإفراج عن المحتجز/))
 const date = screen.getByLabelText('تاريخ تحصيل المحتجز') as HTMLInputElement
 expect(date.value).toBe(todayLocalIso()); expect(date.type).toBe('date'); expect(date.max).toBe(todayLocalIso())
 fireEvent.change(date, { target: { value: '2025-05-01' } })
}
it('يحفظ تاريخ التقويم في التحصيل والقيد مع وقت إقفال فعلي', async () => {
 open(); fireEvent.click(screen.getByRole('button', { name: /تحصيل وإقفال/ }))
 await waitFor(() => expect(S().retentionReleases).toHaveLength(1))
 expect(S().retentionReleases[0].date).toBe('2025-05-01'); expect(S().journal[1].date).toBe('2025-05-01')
 expect(S().projects[0].completedAt?.slice(0, 10)).toBe(todayLocalIso()); expect(lock.calls).toBe(1)
})
it('يرفض تغيير الأساس منذ فتح النافذة', async () => {
 open()
 S().addProjectExtract({ projectId: S().projects[0].id, grossMinor: 100, payment: 'cash', description: 'أعمال جديدة', vatPercent: 0 })
 fireEvent.click(screen.getByRole('button', { name: /تحصيل وإقفال/ }))
 await waitFor(() => expect(screen.getByText(/تغير المشروع أو مستخلصاته أو محتجزه/)).toBeTruthy())
 expect(S().retentionReleases).toHaveLength(0); expect(S().projects[0].status).toBe('active')
})
it('يحذر ويغلق النافذة بعد تعذر تأكيد الحفظ بدلاً من تشجيع التكرار', async () => {
 open(); lock.failAfter = true; fireEvent.click(screen.getByRole('button', { name: /تحصيل وإقفال/ }))
 await waitFor(() => expect(screen.queryByLabelText('تاريخ تحصيل المحتجز')).toBeNull())
 expect(S().retentionReleases).toHaveLength(1); expect(S().journal).toHaveLength(2)
 expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy()
})
