import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => commit() }))
import { ProjectExtractsPage } from '../src/ui/pages/ContractingPages.tsx'
import { ExtractWizardWindowView } from '../src/ui/windows/ExtractWizardWindowView.tsx'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'
import { ToastHost } from '../src/ui/components/ui.tsx'
const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, countryCode: 'EG', modules: ['contracting'] as never[], vatPercent: 15 }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], approvals: { ...app.approvals, enabled: false } })
 useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], projects: [], boqItems: [], projectExtracts: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], changeOrders: [], customers: [], employees: [], journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
 S().addProject({ nameAr: 'مشروع اختبار', clientName: 'عميل', clientId: S().customers[0].id, contractValueMinor: 20000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
function dateInput() {
 const date = screen.getByLabelText('تاريخ فاتورة المستخلص') as HTMLInputElement
 expect(date.type).toBe('date'); expect(date.value).toBe(todayLocalIso()); expect(date.max).toBe(todayLocalIso())
 fireEvent.change(date, { target: { value: '2025-05-01' } })
}
it('صفحة المستخلصات تحفظ تاريخ التقويم في المستند والقيد', async () => {
 const view = render(<MemoryRouter><ProjectExtractsPage /><ToastHost /></MemoryRouter>)
 fireEvent.click(view.container.querySelector('[data-open-extract-modal]')!)
 dateInput()
 const dialog = screen.getByLabelText('تاريخ فاتورة المستخلص').closest('[role="dialog"]')!
 const amount = Array.from(dialog.querySelectorAll('input')).find(input => input.getAttribute('inputmode') === 'decimal')!
 fireEvent.change(amount, { target: { value: '10' } })
 fireEvent.click(document.querySelector('[data-save-project-extract]')!)
 await waitFor(() => expect(S().projectExtracts).toHaveLength(1))
 expect(S().projectExtracts[0].date).toBe('2025-05-01'); expect(S().journal[0].date).toBe('2025-05-01')
})
it('المعالج يحفظ تاريخ التقويم في المستند والقيد', async () => {
 const view = render(<MemoryRouter><ExtractWizardWindowView /><ToastHost /></MemoryRouter>)
 fireEvent.change(screen.getByLabelText('مشروع المستخلص'), { target: { value: String(S().projects[0].id) } })
 dateInput(); fireEvent.click(screen.getByRole('button', { name: /التالي/ }))
 fireEvent.change(screen.getByLabelText('قيمة أعمال المستخلص'), { target: { value: '10' } })
 fireEvent.click(screen.getByRole('button', { name: /التالي/ }))
 fireEvent.click(view.container.querySelector('[data-wizard-post]')!)
 await waitFor(() => expect(S().projectExtracts).toHaveLength(1))
 expect(S().projectExtracts[0].date).toBe('2025-05-01'); expect(S().journal[0].date).toBe('2025-05-01')
})
