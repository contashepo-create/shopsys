import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => commit() }))
import { ProjectsPage } from '../src/ui/pages/ContractingPages.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup })
 useRawDataStore.setState({ ...original, currentUserId: null, loggedOut: false, appUsers: [], activeBranchId: null, branches: [], projects: [], boqItems: [], projectExtracts: [], projectCosts: [], retentionReleases: [], changeOrders: [], clientAdvances: [], journal: [], projectDeletionRecords: [], auditLog: [] } as never)
 S().addProject({ nameAr: 'مشروع أ', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
it('يعرض قائمة بجانب الاسم ويطلب السبب والتأكيد قبل التغيير والعودة', async () => {
 render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
 const select = screen.getByLabelText('حالة تنفيذ مشروع أ') as HTMLSelectElement
 expect(select.value).toBe('running')
 fireEvent.change(select, { target: { value: 'on_hold' } })
 expect(S().projects[0].operationalStatus).toBeUndefined()
 expect(screen.getByText(/لا تقفل الحسابات ولا تسوي المحتجز/)).toBeTruthy()
 fireEvent.change(screen.getByLabelText('سبب تغيير حالة المشروع'), { target: { value: 'قرار التأجيل' } })
 fireEvent.click(screen.getByText('تأكيد تغيير الحالة'))
 await waitFor(() => expect(S().projects[0].operationalStatus).toBe('on_hold'))
 expect(select.value).toBe('on_hold')
 fireEvent.change(select, { target: { value: 'running' } })
 fireEvent.change(screen.getByLabelText('سبب تغيير حالة المشروع'), { target: { value: 'الاستئناف' } })
 fireEvent.click(screen.getByText('تأكيد تغيير الحالة'))
 await waitFor(() => expect(S().projects[0].operationalStatus).toBe('running'))
 expect(S().projects[0].operationalStatusHistory).toHaveLength(2)
 expect(S().projects[0].status).toBe('active')
})
it('لا يفتح المشروع المقفل مالياً من القائمة', () => {
 useRawDataStore.setState({ projects: [{ ...S().projects[0], status: 'completed' }] })
 render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
 const select = screen.getByLabelText('حالة تنفيذ مشروع أ') as HTMLSelectElement
 expect(select.disabled).toBe(true)
 expect(select.value).toBe('finished')
})
it('يرفض نافذة تأكيد متقادمة حتى إن أعيدت الحالة إلى قيمتها الأولى', async () => {
 render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
 fireEvent.change(screen.getByLabelText('حالة تنفيذ مشروع أ'), { target: { value: 'cancelled' } })
 fireEvent.change(screen.getByLabelText('سبب تغيير حالة المشروع'), { target: { value: 'إلغاء' } })
 const id = S().projects[0].id
 S().setProjectOperationalStatus({ projectId: id, expected: 'running', status: 'on_hold', reason: 'تأجيل آخر' })
 S().setProjectOperationalStatus({ projectId: id, expected: 'on_hold', status: 'running', reason: 'استئناف آخر' })
 fireEvent.click(screen.getByText('تأكيد تغيير الحالة'))
 await waitFor(() => expect(S().projects[0].operationalStatus).toBe('running'))
 expect(S().projects[0].operationalStatusHistory).toHaveLength(2)
})
