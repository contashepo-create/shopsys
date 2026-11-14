import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { FinancialReportsTab } from '../src/ui/pages/FinancialReportsTab.tsx'

const print = vi.hoisted(() => vi.fn())
vi.mock('../src/ui/print/printReceipt.ts', () => ({ printHtml: print }))
const original = useRawDataStore.getState(), app = useAppStore.getState()
const branches = [
 { id: 1, nameAr: 'الرئيسي <م>', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true },
 { id: 2, nameAr: 'الفرع الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true },
]
const line = (accountCode: string, debit: number, credit: number) => ({ accountCode, debit, credit })
const entry = (id: number, branchId: number | undefined, cash: string, amount: number) => ({ id, entryNumber: id, date: '2026-02-01', description: 'بيع', sourceType: 'manual' as const, lines: [line(cash, amount, 0), line('4101', 0, amount)], createdAt: '2026-02-01', createdBy: 'م', ...(branchId == null ? {} : { branchId }) })
const cur = { code: 'SAR', symbol: 'ر.س', name: 'ريال', decimals: 2 as const }
beforeEach(() => {
 print.mockClear()
 useRawDataStore.setState({ ...original, currentUserId: null, branches, activeBranchId: 1, customAccounts: [], treasuries: [{ code: '1101', nameAr: '<img src=x>', kind: 'cash', isDefault: true }, { code: '1102', nameAr: 'خزينة ثانية', kind: 'cash', isDefault: false }], journal: [entry(1, 1, '1101', 100), entry(2, 2, '1102', 200), entry(3, undefined, '1101', 50)] } as never)
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const renderReport = () => render(<FinancialReportsTab period={{ from: '2026-01-01', to: '2026-12-31' }} cur={cur} companyName="منشأة" />)

it('يبيّن نطاق الفرع وينبه للقيود بلا فرع صريح في العرض والطباعة، ويهرّب أسماء الحسابات', () => {
 renderReport()
 expect(screen.getByText(/نطاق التقرير: فرع الرئيسي/).textContent).toContain('#1')
 expect(screen.getByRole('alert').textContent).toContain('الظاهر هنا 1')
 fireEvent.change(screen.getByRole('combobox'), { target: { value: 'balance_sheet' } })
 fireEvent.click(screen.getByText('طباعة / PDF'))
 const html = print.mock.calls[0][0] as string
 expect(html).toContain('فرع الرئيسي &lt;م&gt; (#1)'); expect(html).toContain('دون فرع صريح')
 expect(html).toContain('&lt;img src=x&gt;'); expect(html).not.toContain('<img src=x>')
 expect(html).toContain('ليس إيداعًا في قوائم أو إقرارًا زكويًا')
})

it('يوضح الفرع والفترة والتنبيه داخل ملف CSV ولا يدّعي التوافق الرسمي', async () => {
 let blob: Blob | null = null
 vi.stubGlobal('URL', { ...URL, createObjectURL: (value: Blob) => { blob = value; return 'blob:test' }, revokeObjectURL: () => {} })
 vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
 renderReport()
 fireEvent.change(screen.getByRole('combobox'), { target: { value: 'balance_sheet' } })
 fireEvent.click(screen.getByText('تصدير Excel'))
 const text = await (blob! as Blob).text()
 expect(text).toContain('فرع الرئيسي <م> (#1)'); expect(text).toContain('حتى 2026-12-31')
 expect(text).toContain('ليس إيداعًا في قوائم أو إقرارًا زكويًا'); expect(text).toContain('دون فرع صريح')
 expect(text).toContain('إجمالي الأصول')
 const bytes = new Uint8Array(await (blob! as Blob).arrayBuffer())
 const boms = Array.from(bytes).filter((byte, index) => byte === 0xef && bytes[index + 1] === 0xbb && bytes[index + 2] === 0xbf)
 expect(boms).toHaveLength(1)
})

it('يتغير وصف النطاق عند تبديل الفرع أو اختيار العرض الشامل', () => {
 renderReport()
 act(() => { useRawDataStore.setState({ activeBranchId: 2 }) })
 expect(screen.getByText(/نطاق التقرير: فرع الفرع الثاني/)).toBeTruthy()
 expect(screen.getByRole('alert').textContent).toContain('الظاهر هنا 0')
 expect(screen.getByRole('alert').textContent).toContain('قد توجد قيود أخرى خارج هذا النطاق')
 act(() => { useRawDataStore.setState({ activeBranchId: null }) })
 expect(screen.getByText(/نطاق التقرير: كل الفروع — عرض شامل/)).toBeTruthy()
 expect(screen.getByRole('alert').textContent).toContain('لا يثبت توحيد الكيانات')
})
