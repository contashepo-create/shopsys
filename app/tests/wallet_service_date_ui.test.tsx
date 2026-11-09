import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
const lock = vi.hoisted(() => ({ failAfter: false }))
const approval = vi.hoisted(() => ({ requests: 0, callback: null as null | ((by?: string) => void) }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => { const result = commit(); if (lock.failAfter) throw new Error('flush failed'); return result } }))
vi.mock('../src/ui/components/SupervisorPinDialog.tsx', () => ({ useSupervisorApproval: () => ({ dialog: null, willAskPin: true, request: (cb: (by?: string) => void) => { approval.requests++; approval.callback = cb } }) }))
import { WalletServicesPage } from '../src/ui/pages/WalletServicesPage.tsx'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'mobiles' as never, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], customers: [], walletOps: [], journal: [], paymentTerminals: [], paymentTerminalTransactions: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل اختبار', phone: '', creditLimitMinor: 100, notes: '' })
 lock.failAfter = false; approval.requests = 0; approval.callback = null; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function open() {
 render(<><WalletServicesPage /><ToastHost /></>); fireEvent.click(screen.getByRole('button', { name: /عملية جديدة/ }))
 const date = screen.getByLabelText('تاريخ عملية المحافظ') as HTMLInputElement
 expect(date.type).toBe('date'); expect(date.value).toBe(todayLocalIso()); expect(date.max).toBe(todayLocalIso())
 const dialog = screen.getByRole('dialog')
 const inputs = dialog.querySelectorAll('input[dir="ltr"]')
 fireEvent.change(inputs[0], { target: { value: '010123' } }); fireEvent.change(inputs[1], { target: { value: '10' } }); fireEvent.change(inputs[2], { target: { value: '11' } })
 return { date, dialog, inputs }
}
it('يسجل التاريخ والقيد من الشاشة', async () => {
 const { date, dialog } = open(); fireEvent.change(date, { target: { value: '2025-05-01' } })
 fireEvent.click(within(dialog).getByRole('button', { name: /تسجيل العملية/ }))
 await waitFor(() => expect(S().walletOps).toHaveLength(1)); expect(S().walletOps[0].date).toBe('2025-05-01'); expect(S().journal[0].date).toBe('2025-05-01')
})
it('نقرة الإرسال لا تُعامل كاعتماد حد الائتمان؛ لا يرحّل إلا بعد الموافقة', async () => {
 const { dialog, inputs } = open()
 fireEvent.change(inputs[3], { target: { value: '0' } })
 const customer = within(dialog).getByLabelText('بحث العميل'); fireEvent.change(customer, { target: { value: 'عميل اختبار' } }); fireEvent.keyDown(customer, { key: 'Enter' })
 fireEvent.click(within(dialog).getByRole('button', { name: /تسجيل العملية/ }))
 await waitFor(() => expect(approval.requests).toBe(1)); expect(S().walletOps).toHaveLength(0)
 approval.callback?.('المدير'); await waitFor(() => expect(S().walletOps).toHaveLength(1))
 expect(S().walletOps[0].creditLimitOverrideBy).toBe('المدير')
})
it('عند تغير الأساس أو تعذر تأكيد الحفظ لا يشجع تكرار الترحيل', async () => {
 let { dialog } = open(); S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'آخر', phone: '', creditLimitMinor: 0, notes: '' })
 fireEvent.click(within(dialog).getByRole('button', { name: /تسجيل العملية/ }))
 await waitFor(() => expect(screen.getByText(/تغيرت بيانات العملية أو اليومية/)).toBeTruthy()); expect(S().walletOps).toHaveLength(0)
 cleanup(); ({ dialog } = open()); lock.failAfter = true
 fireEvent.click(within(dialog).getByRole('button', { name: /تسجيل العملية/ }))
 await waitFor(() => expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy()); expect(S().walletOps).toHaveLength(1); expect(screen.queryByLabelText('تاريخ عملية المحافظ')).toBeNull()
})
it('لا ينفذ اعتماداً بعد تغيير المسودة أو إغلاقها', async () => {
 const { dialog, inputs } = open(); fireEvent.change(inputs[3], { target: { value: '0' } })
 const customer = within(dialog).getByLabelText('بحث العميل'); fireEvent.change(customer, { target: { value: 'عميل اختبار' } }); fireEvent.keyDown(customer, { key: 'Enter' })
 fireEvent.click(within(dialog).getByRole('button', { name: /تسجيل العملية/ })); await waitFor(() => expect(approval.requests).toBe(1))
 fireEvent.change(inputs[2], { target: { value: '20' } }); approval.callback?.('المدير')
 await waitFor(() => expect(screen.getByText(/تغيرت العملية قبل الاعتماد/)).toBeTruthy()); expect(S().walletOps).toHaveLength(0)
})
