import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const lock = vi.hoisted(() => ({ release: undefined as undefined | (() => void), calls: 0, failAfterCommit: false }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => {
 lock.calls++
 await new Promise<void>(resolve => { lock.release = resolve })
 const result = commit()
 if (lock.failAfterCommit) throw new Error('فشل الحفظ')
 return result
} }))
import { ProjectExtractsPage } from '../src/ui/pages/ContractingPages.tsx'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 lock.calls = 0; lock.release = undefined; lock.failAfterCommit = false
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[], vatPercent: 0 }
 useAppStore.setState({ setup, companySetup: setup })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], boqItems: [], projectExtracts: [], clientAdvances: [], journal: [], vouchers: [], clientSettlements: [], changeOrders: [], paymentTerminals: [] })
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
 const p = S().addProject({ nameAr: 'مشروع', clientId: S().customers[0].id, clientName: 'عميل', contractValueMinor: 100000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 S().addBoqItem({ projectId: p.id, code: '1', descriptionAr: 'بند', unit: 'م', qty: 1000, unitPriceMinor: 100 })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function openExtract() {
 render(<MemoryRouter><ProjectExtractsPage /></MemoryRouter>)
 fireEvent.click(screen.getByText('إصدار مستخلص جديد (فاتورة للعميل)'))
 fireEvent.change(screen.getByLabelText('كمية البند 1'), { target: { value: '200' } })
}
it('النقر المكرر أثناء انتظار القفل لا يرحّل المستخلص مرتين', async () => {
 openExtract()
 const button = screen.getByText('اعتماد المستخلص وإصدار الفاتورة')
 fireEvent.click(button); fireEvent.click(button)
 expect(lock.calls).toBe(1)
 expect(S().projectExtracts).toHaveLength(0)
 await act(async () => { lock.release?.() })
 await waitFor(() => expect(S().projectExtracts).toHaveLength(1))
 expect(S().journal.filter(row => row.sourceType === 'project_extract')).toHaveLength(1)
})
it('تغير المشروع أثناء انتظار القفل يرفض الترحيل بدلاً من استعمال معاينة قديمة', async () => {
 openExtract()
 fireEvent.click(screen.getByText('اعتماد المستخلص وإصدار الفاتورة'))
 act(() => { S().addBoqItem({ projectId: S().projects[0].id, code: '2', descriptionAr: 'بند جديد', unit: 'م', qty: 1, unitPriceMinor: 1 }) })
 await act(async () => { lock.release?.() })
 expect(S().projectExtracts).toHaveLength(0)
 expect(S().journal).toHaveLength(0)
})
it('تأكيد الختامي يُلغى عند تغير أساس المشروع', () => {
 openExtract()
 fireEvent.click(screen.getByLabelText('مستخلص ختامي للمشروع'))
 const confirm = screen.getByLabelText(/راجعت حصر جميع البنود/) as HTMLInputElement
 fireEvent.click(confirm)
 expect(confirm.checked).toBe(true)
 act(() => { S().addBoqItem({ projectId: S().projects[0].id, code: '2', descriptionAr: 'بند جديد', unit: 'م', qty: 1, unitPriceMinor: 1 }) })
 expect(confirm.checked).toBe(false)
})
it('الإشعار الدائن يستخدم القفل نفسه ولا يُكرر عند النقر مرتين', async () => {
 const project = S().projects[0], boq = S().boqItems[0]
 S().addProjectExtract({ projectId: project.id, description: 'أعمال', payment: 'credit', vatPercent: 0, extractQtyLines: [{ boqItemId: boq.id, cumulativeQty: 200 }] })
 render(<MemoryRouter><ProjectExtractsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('مراجعة المستخلص وتفاصيل القيد'))
 fireEvent.click(screen.getByText('إشعار دائن'))
 fireEvent.change(screen.getByLabelText('كمية الرد 1'), { target: { value: '10' } })
 fireEvent.change(screen.getByLabelText('سبب الإشعار'), { target: { value: 'رفض بعض الأعمال' } })
 fireEvent.click(screen.getByText(/على حساب العميل/))
 const button = screen.getByText('تنفيذ إشعار الكميات')
 fireEvent.click(button); fireEvent.click(button)
 expect(lock.calls).toBe(1)
 await act(async () => { lock.release?.() })
 await waitFor(() => expect(S().projectExtracts[0].refundedMinor).toBe(1000))
 expect(S().projectExtracts[0].refunds).toHaveLength(1)
})

it('فشل تأكيد الحفظ بعد الترحيل يغلق المحرر ولا يعرض فشلاً يسمح بترحيل مكرر', async () => {
 openExtract()
 lock.failAfterCommit = true
 fireEvent.click(screen.getByText('اعتماد المستخلص وإصدار الفاتورة'))
 await act(async () => { lock.release?.() })
 expect(S().projectExtracts).toHaveLength(1)
 expect(screen.queryByText('اعتماد المستخلص وإصدار الفاتورة')).toBeNull()
 expect(S().journal.filter(row => row.sourceType === 'project_extract')).toHaveLength(1)
})
it('إعادة محاولة حد الائتمان المباشرة تبقى مقفلة أمام النقر المكرر', async () => {
 useRawDataStore.setState({ customers: S().customers.map(c => ({ ...c, creditLimitMinor: 5000 })) })
 openExtract()
 const button = screen.getByText('اعتماد المستخلص وإصدار الفاتورة')
 fireEvent.click(button)
 await act(async () => { lock.release?.() })
 await waitFor(() => expect(lock.calls).toBe(2))
 expect(S().projectExtracts).toHaveLength(0)
 fireEvent.click(button)
 expect(lock.calls).toBe(2)
 await act(async () => { lock.release?.() })
 await waitFor(() => expect(S().projectExtracts).toHaveLength(1))
 expect(S().journal.filter(row => row.sourceType === 'project_extract')).toHaveLength(1)
})

it('واجهة الإشعار تمنع المبلغ الحر وتتطلب كمية موثقة وسبباً', () => {
 const project = S().projects[0], boq = S().boqItems[0]
 S().addProjectExtract({ projectId: project.id, description: 'أعمال', payment: 'credit', vatPercent: 0, extractQtyLines: [{ boqItemId: boq.id, cumulativeQty: 200 }] })
 render(<MemoryRouter><ProjectExtractsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('مراجعة المستخلص وتفاصيل القيد'))
 fireEvent.click(screen.getByText('إشعار دائن'))
 expect(screen.queryByPlaceholderText('المبلغ المردود (شامل الضريبة)')).toBeNull()
 const button = screen.getByText('تنفيذ إشعار الكميات').closest('button')!
 expect(button.disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('كمية الرد 1'), { target: { value: '201' } })
 fireEvent.change(screen.getByLabelText('سبب الإشعار'), { target: { value: 'رفض أعمال' } })
 expect(screen.getByRole('alert').textContent).toMatch(/تتجاوز/)
 expect(button.disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('كمية الرد 1'), { target: { value: '10' } })
 expect(button.disabled).toBe(false)
 expect(document.querySelector('[data-project-refund-amount]')?.textContent).toMatch(/10/)
})
