import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const control = vi.hoisted(() => ({ approve: null as null | ((name?: string) => void), release: null as null | (() => void), calls: 0, failAfter: false }))
vi.mock('../src/ui/components/SupervisorPinDialog.tsx', () => ({ useSupervisorApproval: () => ({ dialog: null, willAskPin: true, request: (cb: (name?: string) => void) => { control.approve = cb } }) }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => {
  control.calls++
  await new Promise<void>(resolve => { control.release = resolve })
  const result = commit()
  if (control.failAfter) throw new Error('تعذر الحفظ')
  return result
} }))
import { ProjectsPage, ProjectExtractsPage } from '../src/ui/pages/ContractingPages.tsx'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { useToast } from '../src/ui/components/ui.tsx'

const initial = useRawDataStore.getState(), app = useAppStore.getState(), toast = useToast.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
  control.approve = null; control.release = null; control.calls = 0; control.failAfter = false
  const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[], vatPercent: 0 }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], boqItems: [], projectExtracts: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], vouchers: [], clientSettlements: [], changeOrders: [], retentionReleases: [], sales: [], paymentTerminals: [], paymentTerminalTransactions: [] })
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const p = S().addProject({ nameAr: 'مشروع', clientId: S().customers[0].id, clientName: 'عميل', contractValueMinor: 100000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
  const b = S().addBoqItem({ projectId: p.id, code: '1', descriptionAr: 'بند', unit: 'م', qty: 1000, unitPriceMinor: 100 })
  S().addProjectExtract({ projectId: p.id, description: 'أعمال', payment: 'credit', vatPercent: 0, extractQtyLines: [{ boqItemId: b.id, cumulativeQty: 200 }] })
  useToast.setState({ msg: null, kind: 'success', show: (msg, kind = 'success') => useToast.setState({ msg, kind }) })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app); useToast.setState(toast) })
function open(page: 'projects' | 'extracts') {
  render(<MemoryRouter>{page === 'projects' ? <ProjectsPage /> : <ProjectExtractsPage />}</MemoryRouter>)
  if (page === 'projects') {
    fireEvent.click(screen.getByTitle('التفاصيل والقيود'))
    fireEvent.click(screen.getByTitle(/إشعار دائن \(رفض/))
  } else {
    fireEvent.click(screen.getByTitle('مراجعة المستخلص وتفاصيل القيد'))
    fireEvent.click(screen.getByText('إشعار دائن'))
  }
  fireEvent.change(screen.getByLabelText('كمية الرد 1'), { target: { value: '10' } })
  fireEvent.change(screen.getByLabelText('سبب الإشعار'), { target: { value: 'رفض أعمال' } })
  fireEvent.click(screen.getByText('على حساب العميل'))
}
function requestApproval() {
  fireEvent.click(screen.getByRole('button', { name: /تنفيذ إشعار الكميات/ }))
  expect(control.approve).not.toBeNull()
}
function expectUnchanged() {
  expect(S().projectExtracts[0].refunds ?? []).toHaveLength(0)
  expect(S().journal).toHaveLength(1)
}
for (const page of ['projects', 'extracts'] as const) {
  it(`${page}: يرحل الموافقة السليمة مرة واحدة`, async () => {
    open(page); requestApproval(); act(() => { control.approve?.('المشرف'); control.approve?.('المشرف') })
    expect(control.calls).toBe(1)
    await act(async () => { control.release?.() })
    await waitFor(() => expect(S().projectExtracts[0].refunds).toHaveLength(1))
    expect(S().projectExtracts[0].refundedMinor).toBe(1000)
    expect(S().journal).toHaveLength(2)
  })
  it(`${page}: يغلق الإشعار ويحذر عند تعذر تأكيد الحفظ بعد الترحيل`, async () => {
    open(page); requestApproval(); control.failAfter = true
    act(() => control.approve?.('المشرف'))
    await act(async () => { control.release?.() })
    await waitFor(() => expect(useToast.getState().msg).toContain('تعذر تأكيد الحفظ'))
    expect(S().projectExtracts[0].refunds).toHaveLength(1)
    expect(screen.queryByLabelText('سبب الإشعار')).toBeNull()
  })
  it(`${page}: يرفض أساساً تغير بعد فتح نافذة الإشعار حتى لو تغير قبل طلب الموافقة`, async () => {
    open(page)
    act(() => { useRawDataStore.setState({ treasuries: [...S().treasuries, { code: '1199', nameAr: 'جديدة', kind: 'cash', isDefault: false }] }) })
    requestApproval(); act(() => control.approve?.('المشرف'))
    await act(async () => { control.release?.() })
    await waitFor(() => expect(useToast.getState().msg).toContain('تغير أساس إشعار المستخلص'))
    expectUnchanged()
  })
  it(`${page}: يرفض تغير دفتر اليومية أثناء انتظار القفل`, async () => {
    open(page); requestApproval(); act(() => control.approve?.('المشرف'))
    act(() => { useRawDataStore.setState({ journal: S().journal.map(row => ({ ...row, description: 'تغير' })) }) })
    await act(async () => { control.release?.() })
    await waitFor(() => expect(useToast.getState().msg).toContain('تغير أساس إشعار المستخلص'))
    expectUnchanged()
  })
  it(`${page}: لا ينفذ مسودة تغيرت أثناء انتظار موافقة المشرف`, () => {
    open(page); requestApproval()
    fireEvent.change(screen.getByLabelText('سبب الإشعار'), { target: { value: 'سبب آخر' } })
    act(() => control.approve?.('المشرف'))
    expect(screen.getByRole('alert').textContent).toContain('تغيرت بيانات الإشعار')
    expect(control.calls).toBe(0); expectUnchanged()
  })
  it(`${page}: لا ينفذ بعد تغير المسودة أثناء انتظار القفل`, async () => {
    open(page); requestApproval(); act(() => control.approve?.('المشرف'))
    fireEvent.change(screen.getByLabelText('سبب الإشعار'), { target: { value: 'سبب بعد الاعتماد' } })
    await act(async () => { control.release?.() })
    await waitFor(() => expect(useToast.getState().msg).toContain('تغيرت مسودة الإشعار'))
    expectUnchanged()
  })
  it(`${page}: لا ينفذ بعد إغلاق النافذة أثناء انتظار القفل`, async () => {
    open(page); requestApproval(); act(() => control.approve?.('المشرف'))
    const box = screen.getByLabelText('سبب الإشعار').closest('[role="dialog"]')!
    fireEvent.click(box.querySelector('button[aria-label="إغلاق النافذة"]')!)
    await act(async () => { control.release?.() })
    await waitFor(() => expect(useToast.getState().msg).toContain('تغيرت مسودة الإشعار'))
    expectUnchanged()
  })
  it(`${page}: لا ينفذ موافقة بعد إغلاق النافذة`, () => {
    open(page); requestApproval()
    const box = screen.getByLabelText('سبب الإشعار').closest('[role="dialog"]')!
    fireEvent.click(box.querySelector('button[aria-label="إغلاق النافذة"]')!)
    act(() => control.approve?.('المشرف'))
    expect(control.calls).toBe(0); expectUnchanged()
  })
}

it('لا يفتح الإشعار من مراجعة مشروع تحتفظ بنسخة قديمة من المستخلص', () => {
  render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
  fireEvent.click(screen.getByTitle('التفاصيل والقيود'))
  fireEvent.click(screen.getByTitle('مراجعة المستخلص — كل البيانات والقيد والطباعة والتعديل'))
  act(() => { useRawDataStore.setState({ projectExtracts: S().projectExtracts.map(row => ({ ...row, description: 'تغير' })) }) })
  fireEvent.click(screen.getByText('إشعار دائن'))
  expect(useToast.getState().msg).toContain('تغير المستخلص منذ عرضه')
  expect(screen.queryByLabelText('سبب الإشعار')).toBeNull()
  expectUnchanged()
})
