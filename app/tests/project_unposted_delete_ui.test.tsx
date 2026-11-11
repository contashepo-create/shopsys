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
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, ownerPinHash: 'dd963634ae8f2839313302f03077c41b6de321c73056d69b1f34334c193c425e', branches: [], projects: [], boqItems: [], projectExtracts: [], projectCosts: [], retentionReleases: [], changeOrders: [], clientAdvances: [], journal: [], projectDeletionRecords: [], auditLog: [] } as never)
 S().addProject({ nameAr: 'مشروع ملغي', clientName: 'العميل', contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
it('يطلب سبباً وتأكيداً قبل حذف المشروع غير المرحّل', async () => {
 render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('حذف مشروع غير مرحّل'))
 expect(S().projects).toHaveLength(1)
 expect(screen.getByText(/لا يُحذف المشروع إذا كانت له مستندات أو حركات مرحّلة/)).toBeTruthy()
 fireEvent.change(screen.getByLabelText('سبب حذف المشروع'), { target: { value: 'إلغاء العميل' } })
 fireEvent.change(screen.getByLabelText('الرقم السري للمالك لحذف المشروع'), { target: { value: '123456' } })
 fireEvent.click(screen.getByText('تأكيد حذف المشروع'))
 await waitFor(() => expect(S().projects).toHaveLength(0))
 expect(S().projectDeletionRecords[0].reason).toBe('إلغاء العميل')
})
it('تغيّر بنود المشروع بعد عرض التأكيد يمنع حذف بيانات لم يراجعها المستخدم', async () => {
 render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('حذف مشروع غير مرحّل'))
 S().addBoqItem({ projectId: S().projects[0].id, code: '1', descriptionAr: 'بند جديد', unit: 'م', qty: 1, unitPriceMinor: 100 })
 fireEvent.change(screen.getByLabelText('سبب حذف المشروع'), { target: { value: 'إلغاء العميل' } })
 fireEvent.change(screen.getByLabelText('الرقم السري للمالك لحذف المشروع'), { target: { value: '123456' } })
 fireEvent.click(screen.getByText('تأكيد حذف المشروع'))
 await waitFor(() => expect(S().projects).toHaveLength(1))
 expect(S().boqItems).toHaveLength(1)
})
it('لا يحذف من الواجهة عند كلمة مالك خاطئة ويبقى زر التأكيد بعد مراجعتها', async () => {
 render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('حذف مشروع غير مرحّل'))
 fireEvent.change(screen.getByLabelText('سبب حذف المشروع'), { target: { value: 'سبب' } })
 fireEvent.change(screen.getByLabelText('الرقم السري للمالك لحذف المشروع'), { target: { value: '654321' } })
 fireEvent.click(screen.getByText('تأكيد حذف المشروع'))
 await waitFor(() => expect(S().loginGuard.failures).toBe(1))
 expect(S().projects).toHaveLength(1)
 expect(screen.getByLabelText('الرقم السري للمالك لحذف المشروع')).toBeTruthy()
})
