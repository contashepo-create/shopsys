import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const controls = vi.hoisted(() => ({ approve: null as null | (() => void), failAfter: false, beforeCommit: null as null | (() => void), release: null as null | (() => void), hold: false }))
vi.mock('../src/data/invoiceCommitLock.ts', () => ({ withInvoiceCommitLock: async (_refresh: unknown, commit: () => unknown) => {
  if (controls.hold) await new Promise<void>(resolve => { controls.release = resolve })
  controls.beforeCommit?.()
  const result = commit()
  if (controls.failAfter) throw new Error('flush failed')
  return result
} }))
vi.mock('../src/ui/components/SupervisorPinDialog.tsx', () => ({ useSupervisorApproval: () => ({ dialog: null, willAskPin: true, request: (cb: () => void) => { controls.approve = cb } }) }))
import { SettlementsPage } from '../src/ui/pages/SettlementsPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { ToastHost, useToast } from '../src/ui/components/ui.tsx'
const original = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'supermarket' as const, countryCode: 'EG' }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], journal: [], settlements: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 controls.approve = null; controls.failAfter = false; controls.beforeCommit = null; controls.release = null; controls.hold = false
 useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
function prepare() {
 render(<><SettlementsPage /><ToastHost /></>)
 fireEvent.change(screen.getByRole('combobox'), { target: { value: '1101' } })
 fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '10' } })
 fireEvent.change(screen.getByPlaceholderText(/جرد نهاية الشهر/), { target: { value: 'جرد' } })
 fireEvent.click(screen.getByRole('button', { name: /ترحيل التسوية/ }))
 expect(controls.approve).not.toBeNull()
}
it('يرفض مسودة تغيرت أثناء انتظار الاعتماد', () => {
 prepare(); fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '20' } })
 act(() => controls.approve?.())
 expect(useRawDataStore.getState().settlements).toHaveLength(0)
 expect(screen.getByText(/تغيرت بيانات التسوية قبل الاعتماد/)).toBeTruthy()
})
it('يرفض تغير الرصيد بعد إعادة التحميل وقبل الترحيل', async () => {
 prepare(); controls.beforeCommit = () => { const s = useRawDataStore.getState(); s.applySettlement({ section: 'treasury', refId: '1101', actualMinor: 500, reason: 'تغيير', approvedBy: undefined }) }
 act(() => controls.approve?.())
 await waitFor(() => expect(screen.getByText(/تغير الرصيد أو بيانات التسوية/)).toBeTruthy())
 expect(useRawDataStore.getState().settlements).toHaveLength(1)
})
it('يمنع التنفيذ المتكرر أثناء القفل ويحذر عند تعذر تأكيد الحفظ', async () => {
 controls.hold = true; controls.failAfter = true; prepare()
 const approve = controls.approve!
 act(() => { approve(); approve() })
 expect(screen.getByRole('button', { name: /جارٍ تأمين التسوية/ }).hasAttribute('disabled')).toBe(true)
 await act(async () => { controls.release?.(); await Promise.resolve() })
 await waitFor(() => expect(screen.getByText(/سُجلت التسوية محلياً لكن تعذر تأكيد الحفظ/)).toBeTruthy())
 expect(useRawDataStore.getState().settlements).toHaveLength(1)
 expect((screen.getByPlaceholderText('0') as HTMLInputElement).value).toBe('')
})
