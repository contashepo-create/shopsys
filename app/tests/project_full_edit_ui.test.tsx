import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => commit() }))
import { ProjectsPage } from '../src/ui/pages/ContractingPages.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const data = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, countryCode: 'EG', modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup })
 useRawDataStore.setState({ ...data, currentUserId: null, activeBranchId: null, branches: [], projects: [], boqItems: [], projectExtracts: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], changeOrders: [], projectTasks: [], projectCosts: [], subContracts: [], customers: [], employees: [], journal: [] })
 S().addProjectWithBoq({ nameAr: 'مشروع اختبار', clientName: '', contractValueMinor: 2000, retentionPercent: 0, startDate: '2026-01-01', notes: '', boqSections: [{ id: 'floor', nameAr: 'الدور الأول' }] }, [{ code: '1', descriptionAr: 'دهانات', sectionId: 'floor', unit: 'م2', qty: 2, unitPriceMinor: 1000, estCostMinor: 0 }])
})
afterEach(() => { cleanup(); useRawDataStore.setState(data); useAppStore.setState(app) })
it('يفتح الأقسام والبنود ويعدل المشروع والكمية ويحفظهما معاً', async () => {
 const id = S().boqItems[0].id
 render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('تعديل بيانات المشروع (القيمة قبل أول مستخلص فقط)'))
 fireEvent.change(screen.getByLabelText('اسم المشروع'), { target: { value: 'مشروع معدل' } })
 fireEvent.change(screen.getByLabelText('اسم القسم 1'), { target: { value: 'الدور الأرضي' } })
 fireEvent.change(screen.getByLabelText('كمية البند 1'), { target: { value: '3' } })
 fireEvent.click(screen.getByRole('button', { name: /حفظ التعديلات/ }))
 await waitFor(() => expect(S().projects[0].nameAr).toBe('مشروع معدل'))
 expect(S().projects[0].contractValueMinor).toBe(3000)
 expect(S().projects[0].boqSections?.[0].nameAr).toBe('الدور الأرضي')
 expect(S().boqItems[0]).toMatchObject({ id, qty: 3 })
})
it('يعرض بنود المشروع المرتبطة بالحصر دون السماح بتعديلها', () => {
 useRawDataStore.setState({ projectSurveys: [{ id: 1, projectId: S().projects[0].id, lines: [], revisions: [] }] as never[] })
 render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('تعديل بيانات المشروع (القيمة قبل أول مستخلص فقط)'))
 expect((screen.getByLabelText('كمية البند 1') as HTMLInputElement).disabled).toBe(true)
 expect(screen.getByText(/الجدول للعرض فقط/)).toBeTruthy()
})
it('يعرض أثر العرض الفائز قبل تعديل الكميات والأسعار', () => {
 useRawDataStore.setState({ quotations: [{ id: 1, projectId: S().projects[0].id, status: 'won' }] as never[] })
 render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('تعديل بيانات المشروع (القيمة قبل أول مستخلص فقط)'))
 expect((screen.getByLabelText('كمية البند 1') as HTMLInputElement).disabled).toBe(true)
 expect((screen.getByLabelText('سعر البند 1') as HTMLInputElement).disabled).toBe(true)
 expect((screen.getByLabelText('وصف البند 1') as HTMLInputElement).disabled).toBe(false)
 expect(screen.getByText(/المشروع مرتبط بعرض فائز/)).toBeTruthy()
})
