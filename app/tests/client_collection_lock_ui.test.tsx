import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const control = vi.hoisted(() => ({ before: null as null | (() => void), fail: false, hold: false, release: null as null | (() => void) }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => {
 if (control.hold) await new Promise<void>(resolve => { control.release = resolve })
 control.before?.(); const result = commit(); if (control.fail) throw new Error('flush failed'); return result
} }))
import { ClientCollectionsPage } from '../src/ui/pages/ProjectOpsPages.tsx'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { ToastHost } from '../src/ui/components/ui.tsx'
const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 control.before = null; control.fail = false; control.hold = false; control.release = null
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...initial, currentUserId: null, branches: [], activeBranchId: null, customers: [], projects: [], projectExtracts: [], journal: [], clientSettlements: [], vouchers: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] } as never)
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
function prepare() {
 render(<><ClientCollectionsPage /><ToastHost /></>)
 fireEvent.change(screen.getByLabelText('بحث العميل'), { target: { value: 'عميل' } })
 fireEvent.click(document.querySelector(`[data-quick-option][data-value="${S().customers[0].id}"]`)!)
 fireEvent.change(document.querySelector('input[inputmode="decimal"]')!, { target: { value: '10' } })
 return screen.getByRole('button', { name: /تحصيل وتوزيع تلقائي/ })
}
it('يرفض تغير الأساس بعد إعادة التحميل', async () => {
 const button = prepare(); control.before = () => { useRawDataStore.setState({ treasuries: S().treasuries.map(row => ({ ...row, nameAr: 'خزينة معدلة' })) }) }
 fireEvent.click(button)
 await waitFor(() => expect(screen.getByText(/تغيرت بيانات التحصيل/)).toBeTruthy())
 expect(S().clientSettlements).toHaveLength(0)
})
it('يمنع التكرار أثناء القفل ويحذر عند فشل تأكيد الحفظ', async () => {
 const button = prepare(); control.hold = true; control.fail = true
 fireEvent.click(button); fireEvent.click(button)
 expect(screen.getByRole('button', { name: /جارٍ تأمين التحصيل/ }).hasAttribute('disabled')).toBe(true)
 await act(async () => { control.release?.(); await Promise.resolve() })
 await waitFor(() => expect(screen.getByText(/سُجل التحصيل محلياً لكن تعذر تأكيد الحفظ/)).toBeTruthy())
 expect(S().clientSettlements).toHaveLength(1)
 expect((document.querySelector('input[inputmode="decimal"]') as HTMLInputElement).value).toBe('')
})
