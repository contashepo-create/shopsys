import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
const lock = vi.hoisted(() => ({ failAfter: false }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => { const result = commit(); if (lock.failAfter) throw new Error('flush failed'); return result } }))
import { EmployeesPage } from '../src/ui/pages/EmployeesPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG' }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], staffCommissions: [], journal: [] })
 S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', salaryMinor: 30000, active: true } as never)
 lock.failAfter = false; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function open() {
 render(<MemoryRouter><EmployeesPage initialTab="commissions" /><ToastHost /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: /عمولة جديدة/ }))
 const date = screen.getByLabelText('تاريخ استحقاق العمولة') as HTMLInputElement
 expect(date.value).toBe(todayLocalIso()); expect(date.max).toBe(todayLocalIso())
 fireEvent.change(date, { target: { value: '2025-05-01' } })
 const d = screen.getByRole('dialog'); fireEvent.change(within(d).getByPlaceholderText('0'), { target: { value: '10' } }); fireEvent.change(within(d).getByPlaceholderText('عمولة تأجير وحدة A-3 — عقد LC-0007'), { target: { value: 'عمولة' } })
 return d
}
it('تسجل تاريخ المعاينة في القيد', async () => { const d = open(); fireEvent.click(within(d).getByRole('button', { name: /استحقاق العمولة/ })); await waitFor(() => expect(S().staffCommissions).toHaveLength(1)); expect(S().journal[0].date).toBe('2025-05-01') })
it('توقف البيانات المتغيرة وتحذر من فشل تأكيد الحفظ', async () => {
 let d = open(); S().addEmployee({ nameAr: 'آخر', phone: '', roleId: 'cashier', salaryMinor: 1, active: true } as never)
 fireEvent.click(within(d).getByRole('button', { name: /استحقاق العمولة/ })); await waitFor(() => expect(screen.getByText(/تغيرت بيانات العمولة/)).toBeTruthy()); expect(S().staffCommissions).toHaveLength(0)
 cleanup(); d = open(); lock.failAfter = true; fireEvent.click(within(d).getByRole('button', { name: /استحقاق العمولة/ }))
 await waitFor(() => expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy()); expect(S().staffCommissions).toHaveLength(1); expect(screen.queryByLabelText('تاريخ استحقاق العمولة')).toBeNull()
})
