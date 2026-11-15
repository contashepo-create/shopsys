import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => commit() }))
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { ProjectsPage } from '../src/ui/pages/ContractingPages.tsx'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup })
 useRawDataStore.setState({ ...original, currentUserId: null, branches: [], activeBranchId: null, customers: [], projects: [], boqItems: [], projectSurveys: [], projectExtracts: [], projectExtractDrafts: [], projectCloseouts: [], projectCosts: [], changeOrders: [], clientAdvances: [], journal: [], vouchers: [], clientSettlements: [], approvalRequests: [] } as never)
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
 const p = S().addProject({ nameAr: 'مشروع', clientName: 'عميل', clientId: S().customers[0].id, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 S().addBoqItem({ projectId: p.id, code: '1', descriptionAr: 'عمل', unit: 'م', qty: 100, unitPriceMinor: 100 })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
it('إنشاء واعتماد زيادة كمية من واجهة المشروع ينشئ شريحة بسعر العقد', async () => {
 render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('أمر تغيير على العقد'))
 fireEvent.change(screen.getByLabelText('نوع أمر التغيير'), { target: { value: 'quantity' } })
 fireEvent.change(screen.getByLabelText('بند أمر تغيير الكمية'), { target: { value: String(S().boqItems[0].id) } })
 fireEvent.change(screen.getByLabelText('كمية أمر التغيير'), { target: { value: '20' } })
 fireEvent.change(screen.getByPlaceholderText('أعمال إضافية للواجهة…'), { target: { value: 'زيادة مقاسة' } })
 fireEvent.click(screen.getByText('إنشاء أمر التغيير (مسودة)'))
 await waitFor(() => expect(S().changeOrders).toHaveLength(1))
 expect(S().changeOrders[0].amountMinor).toBe(2000)
 expect(S().boqItems).toHaveLength(1)
 fireEvent.click(screen.getByTitle('أمر تغيير على العقد'))
 fireEvent.click(screen.getByText('اعتماد'))
 await waitFor(() => expect(S().boqItems).toHaveLength(2))
 expect(S().boqItems[1].quantityChange?.orderId).toBe(S().changeOrders[0].id)
})
