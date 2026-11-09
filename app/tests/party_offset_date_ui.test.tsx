import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
const lock = vi.hoisted(() => ({ failAfter: false }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => { const result = commit(); if (lock.failAfter) throw new Error('flush failed'); return result } }))
vi.mock('../src/ui/components/SupervisorPinDialog.tsx', () => ({ useSupervisorApproval: () => ({ dialog: null, willAskPin: false, request: (cb: () => void) => cb() }) }))
import { SettlementsPage } from '../src/ui/pages/SettlementsPage.tsx'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG' }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], customers: [], suppliers: [], sales: [], purchases: [], vouchers: [], cheques: [], clientSettlements: [], partyOffsets: [], openingBalances: {}, journal: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل اختبار', phone: '', creditLimitMinor: 0, notes: '' }); S().addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد اختبار', phone: '', notes: '' })
 S().setOpeningBalance({ kind: 'customer', refId: S().customers[0].id, amountMinor: 1000, label: 'عميل', effectiveDate: '2025-01-01' }); S().setOpeningBalance({ kind: 'supplier', refId: S().suppliers[0].id, amountMinor: 1000, label: 'مورد', effectiveDate: '2025-01-01' })
 lock.failAfter = false; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function open() {
 render(<><SettlementsPage /><ToastHost /></>); fireEvent.click(screen.getByRole('button', { name: /مقاصة عميل\/مورد/ }))
 const date = screen.getByLabelText('تاريخ المقاصة') as HTMLInputElement; expect(date.type).toBe('date'); expect(date.value).toBe(todayLocalIso()); expect(date.max).toBe(todayLocalIso())
 fireEvent.change(date, { target: { value: '2025-05-01' } })
 const dialog = screen.getByRole('dialog')
 for (const [label, value] of [['العميل', 'عميل اختبار'], ['المورد', 'مورد اختبار']]) { const field = within(dialog).getByLabelText(label); fireEvent.change(field, { target: { value } }); fireEvent.keyDown(field, { key: 'Enter' }) }
 fireEvent.change(within(dialog).getByPlaceholderText('0'), { target: { value: '5' } }); return dialog
}
it('يسجل التاريخ المحدد للمستند والقيد', async () => {
 const dialog = open(); fireEvent.click(within(dialog).getByRole('button', { name: /ترحيل المقاصة/ }))
 await waitFor(() => expect(S().partyOffsets).toHaveLength(1)); expect(S().partyOffsets[0].date).toBe('2025-05-01'); expect(S().journal.at(-1)?.date).toBe('2025-05-01')
})
it('يرفض تغير الأساس ويحذر عند تعذر تأكيد الحفظ', async () => {
 let dialog = open(); S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'آخر', phone: '', creditLimitMinor: 0, notes: '' })
 fireEvent.click(within(dialog).getByRole('button', { name: /ترحيل المقاصة/ })); await waitFor(() => expect(screen.getByText(/تغيرت الأرصدة أو بيانات المقاصة/)).toBeTruthy()); expect(S().partyOffsets).toHaveLength(0)
 cleanup(); dialog = open(); lock.failAfter = true; fireEvent.click(within(dialog).getByRole('button', { name: /ترحيل المقاصة/ }))
 await waitFor(() => expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy()); expect(S().partyOffsets).toHaveLength(1); expect(screen.queryByLabelText('تاريخ المقاصة')).toBeNull()
})
