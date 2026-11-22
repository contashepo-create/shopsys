import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const lock = vi.hoisted(() => ({ failAfter: false, calls: 0, gate: null as Promise<void> | null }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => { lock.calls++; if (lock.gate) await lock.gate; const result = commit(); if (lock.failAfter) throw new Error('flush failure'); return result } }))
import { CustodyPage } from '../src/ui/pages/CustodyPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'
const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
let id = 0
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], employees: [{ id: 1, nameAr: 'موظف', active: true }], projects: [], custodyFiles: [], custodyTxs: [], employeeAdvances: [], projectCosts: [], journal: [], payrollRuns: [], treasuries: [{ code: '1101', nameAr: 'خزينة', kind: 'cash', isDefault: true }] } as never)
 id = S().openCustodyFile({ employeeId: 1, projectId: null, reason: 'عهدة', notes: '' }).id
 lock.failAfter = false; lock.calls = 0; lock.gate = null; useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
function openFund() {
 render(<><CustodyPage /><ToastHost /></>)
 fireEvent.click(screen.getByTitle('فتح الملف'))
 fireEvent.click(screen.getByRole('button', { name: 'تعزيز العهدة' }))
 const button = screen.getByRole('button', { name: /تعزيز وقيد/ })
 const dialog = button.closest('[role="dialog"]')!
 const number = dialog.querySelector('input[type="number"]')!
 fireEvent.change(number, { target: { value: '10' } })
 return { button, dialog }
}
it('التمويل يمر بالقفل ويكتب الحركة مرة واحدة', async () => {
 const { button } = openFund(); fireEvent.click(button)
 await waitFor(() => expect(S().custodyTxs).toHaveLength(1))
 expect(lock.calls).toBe(1); expect(S().custodyTxs[0].amountMinor).toBe(1000); expect(S().journal).toHaveLength(1)
})
it('يرفض تغير الأساس بعد فتح نافذة التمويل', async () => {
 const { button } = openFund()
 act(() => { S().fundCustodyFile({ fileId: id, amountMinor: 100, treasury: '1101', description: '' }) })
 fireEvent.click(button)
 await waitFor(() => expect(screen.getByText(/تغير أساس العهدة/)).toBeTruthy())
 expect(S().custodyTxs).toHaveLength(1); expect(S().journal).toHaveLength(1)
})
it('عدم تأكيد التصريف بعد الحركة يغلق نافذتها ويحذر من التكرار', async () => {
 const { button } = openFund(); lock.failAfter = true; fireEvent.click(button)
 await waitFor(() => expect(screen.queryByRole('button', { name: /تعزيز وقيد/ })).toBeNull())
 expect(S().custodyTxs).toHaveLength(1); expect(screen.getByText(/تعذر تأكيد الحفظ/)).toBeTruthy()
})

it('اختيار بلا مشروع يسجل المصروف العام ولا ينشئ تكلفة مشروع', async () => {
 const project = { id: 3, code: 'P', nameAr: 'مشروع', status: 'active' }
 useRawDataStore.setState({ projects: [project], custodyFiles: S().custodyFiles.map(f => ({ ...f, projectId: 3 })) } as never)
 S().fundCustodyFile({ fileId: id, amountMinor: 1000, treasury: '1101', description: '' })
 render(<><CustodyPage /><ToastHost /></>)
 fireEvent.click(screen.getByTitle('فتح الملف'))
 fireEvent.click(screen.getByRole('button', { name: /تسجيل مصروف/ }))
 const button = screen.getByRole('button', { name: /تسجيل المصروف/ })
 const dialog = button.closest('[role="dialog"]')!
 fireEvent.change(dialog.querySelector('input[type="number"]')!, { target: { value: '2' } })
 fireEvent.change(dialog.querySelector('input[placeholder^="مواد"]')!, { target: { value: 'مصروف عام' } })
 fireEvent.change(dialog.querySelector('select')!, { target: { value: '' } })
 fireEvent.click(button)
 await waitFor(() => expect(S().custodyTxs).toHaveLength(2))
 expect(S().custodyTxs[1].projectId).toBeNull()
 expect(S().projectCosts).toHaveLength(0)
 expect(S().journal[1].lines[0].accountCode).toBe('5108')
})
function openNewFile() {
 render(<><CustodyPage /><ToastHost /></>)
 fireEvent.click(screen.getByRole('button', { name: /فتح ملف عهدة/ }))
 fireEvent.change(screen.getByPlaceholderText(/عهدة موقع/), { target: { value: 'ملف جديد' } })
 return screen.getByRole('button', { name: /📂 فتح الملف/ })
}
it('فتح الملف يمر بالقفل ولا يكرره عند الضغط أثناء الحفظ', async () => {
 let release!: () => void; lock.gate = new Promise<void>(resolve => { release = resolve })
 const button = openNewFile(); fireEvent.click(button); fireEvent.click(button)
 expect(lock.calls).toBe(1); expect((button as HTMLButtonElement).disabled).toBe(true); expect(S().custodyFiles).toHaveLength(1)
 await act(async () => { release(); await lock.gate })
 await waitFor(() => expect(S().custodyFiles).toHaveLength(2))
 expect(S().custodyFiles.map(file => file.id)).toEqual([1, 2])
})
it('يفشل فتح الملف عندما يتغير ترقيم الملفات بعد فتح النافذة', async () => {
 const button = openNewFile()
 act(() => { S().openCustodyFile({ employeeId: 1, projectId: null, reason: 'آخر', notes: '' }) })
 fireEvent.click(button)
 await waitFor(() => expect(screen.getByText(/تغير أساس العهدة/)).toBeTruthy())
 expect(S().custodyFiles).toHaveLength(2)
})
it('عدم تأكيد حفظ فتح الملف يغلق النافذة ويحذر من تكراره', async () => {
 const button = openNewFile(); lock.failAfter = true; fireEvent.click(button)
 await waitFor(() => expect(screen.queryByPlaceholderText(/عهدة موقع/)).toBeNull())
 expect(S().custodyFiles).toHaveLength(2); expect(screen.getByText(/راجع الملفات قبل إعادة المحاولة/)).toBeTruthy()
})
it('المصروف الضريبي يتطلب المرجع والتأكيد ويعرض صافي القيد', async () => {
 S().fundCustodyFile({ fileId: id, amountMinor: 20000, treasury: '1101', description: '' })
 render(<><CustodyPage /><ToastHost /></>)
 fireEvent.click(screen.getByTitle('فتح الملف'))
 fireEvent.click(screen.getByRole('button', { name: /تسجيل مصروف/ }))
 const button = screen.getByRole('button', { name: /تسجيل المصروف/ }) as HTMLButtonElement
 const dialog = button.closest('[role="dialog"]')!
 fireEvent.change(dialog.querySelector('input[type="number"]')!, { target: { value: '115' } })
 fireEvent.change(dialog.querySelector('input[placeholder^="مواد"]')!, { target: { value: 'مصروف ضريبي' } })
 fireEvent.click(screen.getByLabelText('فصل ضريبة مدخلات قابلة للاسترداد'))
 fireEvent.change(screen.getByLabelText('مبلغ الضريبة القابلة للاسترداد'), { target: { value: '15' } })
 expect(button.disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('مرجع الفاتورة الضريبية'), { target: { value: 'INV-42' } })
 fireEvent.click(screen.getByLabelText(/أؤكد مراجعة أهلية/))
 expect(button.disabled).toBe(false)
 fireEvent.click(button)
 await waitFor(() => expect(S().custodyTxs).toHaveLength(2))
 expect(S().custodyTxs[1]).toMatchObject({ inputVatMinor: 1500, taxInvoiceRef: 'INV-42' })
 expect(S().journal[1].lines.map(l => [l.accountCode, l.debit, l.credit])).toEqual([['5108', 10000, 0], ['2102', 1500, 0], ['1108', 0, 11500]])
})
it('يحذر من صرف سابق لا يمكن توزيعه على زيادة ظهرت بعده', () => {
 useRawDataStore.setState({ custodyTxs: [{ id: 1, fileId: id, type: 'expense', date: '2026-11-02', amountMinor: 1000, excessMinor: 1000, description: 'مصروف', treasury: null, projectId: null, purchaseId: null, journalEntryId: null }], payrollRuns: [{ id: 1, date: '2026-11-01', lines: [{ employeeId: 1, excessPaidMinor: 500 }] }] } as never)
 render(<><CustodyPage /><ToastHost /></>)
 fireEvent.click(screen.getByTitle('فتح الملف'))
 expect(screen.getByRole('alert').textContent).toContain('غير موزع')
})
