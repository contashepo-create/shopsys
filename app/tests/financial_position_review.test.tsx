import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { financialPositionReview } from '../src/core/financialPositionReview.ts'
import type { JournalEntry } from '../src/core/ledger.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { FinancialReportsTab } from '../src/ui/pages/FinancialReportsTab.tsx'

const print = vi.hoisted(() => vi.fn())
vi.mock('../src/ui/print/printReceipt.ts', () => ({ printHtml: print }))
const orig = useRawDataStore.getState()
const l = (accountCode: string, debit: number, credit: number) => ({ accountCode, debit, credit })
const entry = (id: number, date: string, lines: JournalEntry['lines'], branchId = 1): JournalEntry => ({ id, entryNumber: id, date, lines, branchId, description: 'قيد', sourceType: 'manual', sourceId: null, createdAt: date, createdBy: 'م', reversesEntryId: null, reversedByEntryId: null })
const journal = [entry(1, '2024-01-01', [l('1101', 100000, 0), l('3101', 0, 100000)]), entry(2, '2024-02-01', [l('1201', 25000, 0), l('2101', 0, 25000)]), entry(3, '2024-03-01', [l('1101', 5000, 0), l('4101', 0, 5000)])]
const k = (code: string, date: string) => JSON.stringify([code, date])
const asOf = '2024-03-31', prior = '2024-02-29'
const classifications = { [k('1101', prior)]: 'current', [k('1201', prior)]: 'noncurrent', [k('2101', prior)]: 'noncurrent', [k('1101', asOf)]: 'current', [k('1201', asOf)]: 'noncurrent', [k('2101', asOf)]: 'current' } as const

it('يعرض أرصدة تراكمية لعدة تواريخ ويصنف كل حساب في كل تاريخ دون استنتاج أجل آلي', () => {
 const unclassified = financialPositionReview(journal, asOf, [prior])
 expect(unclassified.dates).toEqual([prior, asOf]); expect(unclassified.unclassifiedCount).toBe(6); expect(unclassified.workingCapital).toBeNull()
 const result = financialPositionReview(journal, asOf, [prior], classifications)
 expect(result.totalAssets.values).toEqual([125000, 130000])
 expect(result.liabilitiesAndEquity.values).toEqual([125000, 130000]); expect(result.difference.values).toEqual([0, 0])
 expect(result.totalLiabilities.values).toEqual([25000, 25000])
 expect(result.totalEquity.values).toEqual([100000, 105000])
 expect(result.workingCapital?.values).toEqual([100000, 80000])
 expect(result.sections.find(section => section.key === 'liabilities-noncurrent')?.total.values).toEqual([25000, 0])
 expect(result.sections.find(section => section.key === 'liabilities-current')?.total.values).toEqual([0, 25000])
})
it('يرفض تواريخ مكررة أو غير صحيحة أو مستقبلاً بالنسبة لتاريخ التقرير وقيداً مختلاً', () => {
 expect(() => financialPositionReview(journal, asOf, [prior, prior])).toThrow(/مكررة/)
 expect(() => financialPositionReview(journal, asOf, ['2024-02-30'])).toThrow(/غير صالحة/)
 expect(() => financialPositionReview(journal, asOf, ['2024-04-01'])).toThrow(/سابقة/)
 expect(() => financialPositionReview([...journal, entry(4, prior, [l('1101', 1, 0)])], asOf, [])).toThrow(/#4/)
})
it('يحتسب الخسارة والأرصدة العكسية وعواكس الإقفال دون مضاعفة النتيجة', () => {
 const sale = entry(1, '2024-01-15', [l('1101', 5000, 0), l('4101', 0, 5000)])
 const expense = entry(2, '2024-02-01', [l('5102', 8000, 0), l('2101', 0, 8000)])
 const close = { ...entry(3, '2024-12-31', [l('4101', 5000, 0), l('5102', 0, 8000), l('3102', 3000, 0)]), sourceType: 'year_closing' as const, sourceId: 1, reversedByEntryId: 4 }
 const reverse = { ...entry(4, '2024-12-31', close.lines.map(line => l(line.accountCode, line.credit, line.debit))), sourceType: 'reversal' as const, sourceId: 3, reversesEntryId: 3 }
 const again = { ...close, id: 5, entryNumber: 5, reversedByEntryId: null }
 const report = financialPositionReview([sale, expense, close, reverse, again], '2024-12-31', [])
 expect(report.totalAssets.values).toEqual([5000]); expect(report.totalLiabilities.values).toEqual([8000]); expect(report.totalEquity.values).toEqual([-3000]); expect(report.difference.values).toEqual([0])
})

beforeEach(() => { print.mockClear(); useRawDataStore.setState({ ...orig, currentUserId: null, loggedOut: false, activeBranchId: 1, branches: [{ id: 1, nameAr: '<الرئيسي>', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الفرع الآخر', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }], treasuries: [{ code: '1101', nameAr: '<الخزينة>', kind: 'cash', isDefault: true }], customAccounts: [], journal: [...journal, entry(4, '2024-01-01', [l('1102', 400000, 0), l('3101', 0, 400000)], 2)] } as never) })
afterEach(() => { cleanup(); useRawDataStore.setState(orig); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const renderReport = () => { render(<FinancialReportsTab period={{ from: '2024-01-01', to: asOf }} cur={{ code: 'SAR', symbol: 'ر.س', name: 'ريال', decimals: 2 }} companyName="شركة" />); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'balance_sheet' } }) }

it('يعرض جدولاً متعدد التواريخ وتصنيفاً منفصلاً مع طباعة متطابقة وآمنة', () => {
 renderReport()
 fireEvent.change(screen.getByLabelText('تاريخ المقارنة 1'), { target: { value: prior } })
 const box = screen.getByRole('region', { name: 'المركز المالي المقارن' })
 expect(within(box).getByText('لا يُحسب رأس المال العامل قبل تحديد جميع التصنيفات.', { exact: false })).toBeTruthy()
 fireEvent.change(within(box).getByLabelText('تصنيف <الخزينة> 2024-02-29'), { target: { value: 'current' } })
 fireEvent.change(within(box).getByLabelText('تصنيف <الخزينة> 2024-03-31'), { target: { value: 'current' } })
 expect(within(box).getByText('الأصول المتداولة')).toBeTruthy()
 fireEvent.click(within(box).getByText('طباعة / PDF'))
 const html = print.mock.calls[0][0] as string
 expect(html).toContain('2024-02-29'); expect(html).toContain('2024-03-31'); expect(html).toContain('&lt;الخزينة&gt;'); expect(html).not.toContain('<الخزينة>')
 expect(html).toContain('التصنيف يحدده المستخدم'); expect(html).toContain('دون فرع صريح'); expect(html).toContain('نتائج تراكمية غير مقفلة')
})
it('يوقف الإخراج لتواريخ متكررة ويصدر البيانات والنطاق بعد تصحيحها', async () => {
 let blob: Blob | null = null
 vi.stubGlobal('URL', { ...URL, createObjectURL: (value: Blob) => { blob = value; return 'blob:test' }, revokeObjectURL: () => {} })
 vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
 renderReport()
 fireEvent.change(screen.getByLabelText('تاريخ المقارنة 1'), { target: { value: prior } })
 fireEvent.change(screen.getByLabelText('تاريخ المقارنة 2'), { target: { value: prior } })
 const box = screen.getByRole('region', { name: 'المركز المالي المقارن' })
 expect(within(box).getByRole('alert').textContent).toContain('مكررة')
 expect(within(box).getByText('تصدير Excel').closest('button')?.disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('تاريخ المقارنة 2'), { target: { value: '' } })
 fireEvent.click(within(box).getByText('تصدير Excel'))
 const text = await (blob! as Blob).text()
 expect(text).toContain('فرع <الرئيسي>'); expect(text).toContain('حتى 2024-03-31'); expect(text).toContain('2024-02-29,2024-03-31'); expect(text).toContain('غير المصنفة')
 expect(text).toContain('إجمالي الأصول,1250.00,1300.00')
})
it('يعزل بيانات الفروع ويزيل التصنيفات المؤقتة عند تغيير النطاق', () => {
 renderReport()
 fireEvent.change(screen.getByLabelText('تصنيف <الخزينة> 2024-03-31'), { target: { value: 'current' } })
 act(() => { useRawDataStore.setState({ activeBranchId: 2 }) })
 expect(screen.getByText(/نطاق التقرير: فرع الفرع الآخر/)).toBeTruthy()
 const box = screen.getByRole('region', { name: 'المركز المالي المقارن' })
 expect(within(box).queryByText('<الخزينة>')).toBeNull()
 expect(within(box).getByText('إجمالي الأصول').closest('tr')?.textContent).toContain('4,000.00')
})

it('لا يستبعد رصيد فرع في تاريخ سابق اعتماداً على الطرف المقابل المستقبلي', () => {
 const source = { ...entry(1, '2024-02-01', [{ ...l('1114', 5000, 0), relatedBranchId: 2 }, l('1101', 0, 5000)], 1), sourceId: 8 }
 const destination = { ...entry(2, '2024-03-01', [l('1102', 5000, 0), { ...l('2118', 0, 5000), relatedBranchId: 1 }], 2), sourceId: 8 }
 const report = financialPositionReview([source, destination], asOf, [prior])
 expect(report.difference.values).toEqual([0, 0])
 expect(report.sections.find(s => s.key === 'assets-unclassified')?.rows.find(r => r.code === '1114')?.values).toEqual([5000, 0])
})

it('يعيد التصنيف إلى غير مصنف فور تغير الدفتر حتى لو بقي كود الحساب', () => {
 renderReport()
 fireEvent.change(screen.getByLabelText('تصنيف <الخزينة> 2024-03-31'), { target: { value: 'current' } })
 expect((screen.getByLabelText('تصنيف <الخزينة> 2024-03-31') as HTMLSelectElement).value).toBe('current')
 act(() => { const state = useRawDataStore.getState(); useRawDataStore.setState({ journal: [...state.journal, entry(5, '2024-03-01', [l('1101', 100, 0), l('3101', 0, 100)])] }) })
 expect((screen.getByLabelText('تصنيف <الخزينة> 2024-03-31') as HTMLSelectElement).value).toBe('unclassified')
})

it('يصدر CSV بسطور وأعمدة سليمة وحماية نصوص الصيغ ودقة المبالغ', async () => {
 let blob: Blob | null = null
 vi.stubGlobal('URL', { ...URL, createObjectURL: (value: Blob) => { blob = value; return 'blob:test' }, revokeObjectURL: () => {} })
 vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
 useRawDataStore.setState({ journal: [entry(1, '2024-01-01', [l('1101', 100, 0), l('3101', 0, 100)])] })
 render(<FinancialReportsTab period={{ from: '2024-01-01', to: asOf }} cur={{ code: 'SAR', symbol: 'ر.س', name: 'ريال', decimals: 2 }} companyName="=CMD()" />)
 fireEvent.change(screen.getByRole('combobox'), { target: { value: 'balance_sheet' } })
 fireEvent.click(screen.getByText('تصدير Excel'))
 const csv = await (blob! as Blob).text()
 expect([...new Uint8Array(await (blob! as Blob).arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
 expect(csv).toContain("المنشأة,'=CMD()")
 expect(csv).toContain('1101 — <الخزينة>,1.00')
 expect(csv).toContain('\nالبند,2024-03-31\n')
 expect(csv).toContain('\nالأصول غير المصنفة,\n')
 expect(csv).not.toContain('\\n')
})
