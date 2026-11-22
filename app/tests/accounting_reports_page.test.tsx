import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { JournalEntry, JournalLine } from '../src/core/ledger.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { TrialBalancePage } from '../src/ui/pages/TrialBalancePage.tsx'

const print = vi.hoisted(() => vi.fn())
vi.mock('../src/ui/print/printReceipt.ts', () => ({ printHtml: print }))
const line = (accountCode: string, debit: number, credit: number): JournalLine => ({ accountCode, debit, credit })
const entry = (id: number, date: string, lines: JournalLine[], sourceType: JournalEntry['sourceType'] = 'manual'): JournalEntry => ({ id, entryNumber: id, date, description: id === 2 ? '<img src=x>' : `حركة ${id}`, sourceType, sourceId: null, reversedByEntryId: null, reversesEntryId: null, lines, createdAt: date, createdBy: 'محاسب' })
const original = useRawDataStore.getState(), app = useAppStore.getState()
const entries = [
 entry(1, '2025-12-31', [line('1101', 10000, 0), line('3101', 0, 10000)]),
 entry(2, '2026-01-01', [line('1101', 2000, 0), line('4101', 0, 2000)]),
 entry(3, '2026-02-01', [line('3101', 7000, 0), line('4101', 0, 7000)], 'opening'),
 entry(4, '2026-03-01', [line('5101', 500, 0), line('1101', 0, 500)]),
]
beforeEach(() => {
 print.mockClear()
 useRawDataStore.setState({ ...original, loggedOut: false, currentUserId: null, activeBranchId: null, branches: [], customAccounts: [], journal: entries, treasuries: [{ code: '1101', nameAr: '=cash', kind: 'cash', isDefault: true }] } as never)
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function period() {
 fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2026-01-01' } })
 fireEvent.change(screen.getByLabelText('إلى تاريخ'), { target: { value: '2026-12-31' } })
}
function exports() {
 let blob: Blob | undefined
 vi.stubGlobal('URL', { ...URL, createObjectURL: (value: Blob) => { blob = value; return 'blob:test' }, revokeObjectURL: () => {} })
 vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
 return () => blob!
}
it('يعرض الفترة التفصيلية وحركة الحساب ويطبعها ويصدرها مع تهريب البيانات', async () => {
 const getBlob = exports()
 render(<TrialBalancePage />); period()
 const row = screen.getByRole('button', { name: '=cash' }).closest('tr')!
 expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual(['1101', '=cash', '100.00', '—', '20.00', '5.00', '115.00', '—'])
 fireEvent.click(screen.getByText('تصدير Excel'))
 expect(await getBlob().text()).toContain("1101,'=cash,100.00,0.00,20.00,5.00,115.00,0.00")
 fireEvent.click(screen.getByRole('button', { name: '=cash' }))
 expect(screen.getByText('<img src=x>')).toBeTruthy()
 expect(screen.getByText(/حركة الدفتر الخام/)).toBeTruthy()
 fireEvent.click(screen.getByText('طباعة / PDF'))
 expect(print.mock.calls[0][0]).toContain('&lt;img src=x&gt;')
 expect(print.mock.calls[0][0]).toContain('1101 — =cash')
 fireEvent.click(screen.getByText('تصدير Excel'))
 const csv = await getBlob().text()
 expect(csv).toContain('الحساب,1101 — =cash'); expect(csv).toContain('دفتر خام'); expect(csv).toContain('<img src=x>')
 fireEvent.click(screen.getByText('العودة إلى ميزان المراجعة'))
 expect(screen.getByText('أول الفترة مدين')).toBeTruthy()
})
it('قائمة الدخل جدول بمجاميع الأداء وتستبعد الافتتاح بينما حركة الحساب خام', async () => {
 const getBlob = exports()
 render(<TrialBalancePage />); period()
 fireEvent.change(screen.getByRole('combobox'), { target: { value: 'income' } })
 expect(screen.getByText(/يستبعد قيود الإقفال والافتتاح/)).toBeTruthy()
 const revenue = within(screen.getByRole('table')).getByText('4101').closest('tr')!
 expect(within(revenue).getAllByRole('cell').at(-1)?.textContent).toBe('20.00')
 expect(within(screen.getByText('صافي الربح').closest('tr')!).getAllByRole('cell').at(-1)?.textContent).toBe('15.00')
 fireEvent.click(screen.getByText('طباعة / PDF'))
 expect(print.mock.calls[0][0]).toContain('إجمالي التكاليف المباشرة')
 expect(print.mock.calls[0][0]).toContain('4101')
 fireEvent.click(screen.getByText('تصدير Excel'))
 expect(await getBlob().text()).toContain('منهج قائمة الدخل')
 fireEvent.click(within(revenue).getByRole('button'))
 expect(screen.getByText('حركة 3')).toBeTruthy()
 fireEvent.click(screen.getByText('العودة إلى قائمة الدخل'))
 expect(screen.getByText('صافي الربح')).toBeTruthy()
})
it('يرفض الفترة الخاطئة والقيود غير السليمة بدلاً من طباعة تقرير مضلل', () => {
 render(<TrialBalancePage />); period()
 fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2027-01-01' } })
 expect(screen.getByRole('alert').textContent).toContain('فترة التقرير غير صالحة')
 expect(screen.queryByText('طباعة / PDF')).toBeNull()
 fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2026-01-01' } })
 act(() => { useRawDataStore.setState({ journal: [entry(21, '2026-02-01', [line('1101', 1, 0)])] }) })
 expect(screen.getByRole('alert').textContent).toContain('#21')
 expect((screen.getByText('تصدير Excel').closest('button') as HTMLButtonElement).disabled).toBe(true)
})
