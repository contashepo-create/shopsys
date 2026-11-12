import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => commit() }))
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProjectExtractsPage } from '../src/ui/pages/ContractingPages.tsx'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const data = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[], vatPercent: 0 }
 useAppStore.setState({ setup, companySetup: setup })
 useRawDataStore.setState({ ...data, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], boqItems: [], projectExtracts: [], clientAdvances: [], journal: [], vouchers: [], clientSettlements: [], changeOrders: [], paymentTerminals: [] })
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'مالك الأعمال', phone: '', creditLimitMinor: 0, notes: '' })
 const customer = S().customers.at(-1)!
 const p = S().addProject({ nameAr: 'فيلا', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 100000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 S().addBoqItem({ projectId: p.id, code: '1', descriptionAr: 'دهانات', unit: 'م2', qty: 1000, unitPriceMinor: 100 })
})
afterEach(() => { cleanup(); useRawDataStore.setState(data); useAppStore.setState(app) })
it('من واجهة المستخلص الجاري ثم الختامي: يطابق الختامي قيمة العقد', async () => {
 render(<MemoryRouter><ProjectExtractsPage /></MemoryRouter>)
 fireEvent.click(screen.getByText('إصدار مستخلص جديد (فاتورة للعميل)'))
 fireEvent.change(screen.getByLabelText('كمية البند 1'), { target: { value: '200' } })
 fireEvent.click(screen.getByText('اعتماد المستخلص وإصدار الفاتورة'))
 await waitFor(() => expect(S().projectExtracts[0]?.lines?.[0].newExecutedQty).toBe(200))
 await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('PRX-'))
 const dialog = screen.getByRole('dialog')
 const close = within(dialog).getByRole('button', { name: /إغلاق/ })
 fireEvent.click(close)
 fireEvent.click(screen.getByText('إصدار مستخلص جديد (فاتورة للعميل)'))
 fireEvent.change(screen.getByLabelText('كمية البند 1'), { target: { value: '1000' } })
 fireEvent.click(screen.getByLabelText('مستخلص ختامي للمشروع'))
 expect(screen.getAllByText(/المتبقي/).length).toBeGreaterThan(0)
 fireEvent.click(screen.getByLabelText(/راجعت حصر جميع البنود/))
 fireEvent.click(screen.getByText('اعتماد المستخلص وإصدار الفاتورة'))
 await waitFor(() => expect(S().projectExtracts[1]?.lines?.[0]).toMatchObject({ prevExecutedQty: 200, newExecutedQty: 1000 }))
 expect(S().projectExtracts[1].totals.grossMinor).toBe(80000)
})

it('يحافظ على الكمية عند التبديل بين الجاري والتراكمي ويرفض الزيادة ويتطلب تأكيد الختامي بعد تعديل المدخل', () => {
 const project = S().projects[0], boq = S().boqItems[0]
 S().addProjectExtract({ projectId: project.id, description: 'سابق', payment: 'credit', vatPercent: 0, extractQtyLines: [{ boqItemId: boq.id, cumulativeQty: 200 }] })
 render(<MemoryRouter><ProjectExtractsPage /></MemoryRouter>)
 fireEvent.click(screen.getByText('إصدار مستخلص جديد (فاتورة للعميل)'))
 fireEvent.click(screen.getByRole('button', { name: 'كمية هذا المستخلص' }))
 const input = screen.getByLabelText('كمية البند 1') as HTMLInputElement
 fireEvent.change(input, { target: { value: '656' } })
 expect(document.querySelector('[data-extract-qty-row]')?.textContent).toContain('856')
 fireEvent.click(screen.getByRole('button', { name: 'الكمية التراكمية' }))
 expect(input.value).toBe('856')
 fireEvent.click(screen.getByLabelText('مستخلص ختامي للمشروع'))
 const confirm = screen.getByLabelText(/راجعت حصر جميع البنود/) as HTMLInputElement
 fireEvent.click(confirm)
 expect(confirm.checked).toBe(true)
 fireEvent.change(input, { target: { value: '1001' } })
 expect(confirm.checked).toBe(false)
 expect(screen.getByRole('alert').textContent).toContain('تتجاوز')
 expect(S().projectExtracts).toHaveLength(1)
})

it('يطلب موافقة ظاهرة على تقدير الكمية عند الانتقال من تاريخ النسب', async () => {
 const project = S().projects[0], boq = S().boqItems[0]
 S().addProjectExtract({ projectId: project.id, description: 'قديم', payment: 'credit', vatPercent: 0, extractLines: [{ boqItemId: boq.id, newProgressPercent: 20 }] })
 render(<MemoryRouter><ProjectExtractsPage /></MemoryRouter>)
 fireEvent.click(screen.getByText('إصدار مستخلص جديد (فاتورة للعميل)'))
 fireEvent.change(screen.getByLabelText('كمية البند 1'), { target: { value: '856' } })
 expect(screen.getByRole('alert').textContent).toContain('تقديرية')
 expect(S().projectExtracts).toHaveLength(1)
 fireEvent.click(screen.getByLabelText(/راجعت الكميات السابقة التقديرية/))
 fireEvent.click(screen.getByText('اعتماد المستخلص وإصدار الفاتورة'))
 await waitFor(() => expect(S().projectExtracts[1]?.lines?.[0]).toMatchObject({ prevExecutedQty: 200, newExecutedQty: 856, previousQtyEstimated: true }))
})

it('يدعم المعالج السريع الحصر التراكمي ويطلب تأكيد الختامي', async () => {
 const { ExtractWizardWindowView } = await import('../src/ui/windows/ExtractWizardWindowView.tsx')
 render(<MemoryRouter><ExtractWizardWindowView /></MemoryRouter>)
 fireEvent.change(screen.getByLabelText('مشروع المستخلص'), { target: { value: String(S().projects[0].id) } })
 fireEvent.click(screen.getByText('التالي'))
 fireEvent.click(screen.getByText('حصر كميات البنود'))
 fireEvent.change(screen.getByLabelText('كمية البند 1'), { target: { value: '1000' } })
 fireEvent.click(screen.getByText('التالي'))
 fireEvent.click(screen.getByLabelText('نعم — لا مستخلصات بعده'))
 const button = document.querySelector('[data-wizard-post]') as HTMLButtonElement
 expect(button.disabled).toBe(true)
 fireEvent.click(screen.getByLabelText(/راجعت الحصر الختامي/))
 expect(button.disabled).toBe(false)
 fireEvent.click(button)
 await waitFor(() => expect(S().projectExtracts[0]?.lines?.[0].newExecutedQty).toBe(1000))
 expect(S().projectExtracts[0].isFinal).toBe(true)
})
