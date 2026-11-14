import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { comparisonCsvAmount, financialComparison } from '../src/core/financialComparison.ts'
import type { JournalEntry } from '../src/core/ledger.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { FinancialReportsTab } from '../src/ui/pages/FinancialReportsTab.tsx'

const print = vi.hoisted(() => vi.fn())
vi.mock('../src/ui/print/printReceipt.ts', () => ({ printHtml: print }))
const orig = useRawDataStore.getState()
const mk = (id: number, date: string, lines: JournalEntry['lines'], sourceType: JournalEntry['sourceType'] = 'manual', branchId = 1): JournalEntry => ({ id, entryNumber: id, date, description: 'قيد', sourceType, sourceId: null, lines, branchId, createdAt: date, createdBy: 'م', reversesEntryId: null, reversedByEntryId: null })
const l = (accountCode: string, debit: number, credit: number) => ({ accountCode, debit, credit })
const entries = [
 mk(1, '2024-01-01', [l('1101', 10000, 0), l('3101', 0, 10000)]),
 mk(2, '2024-06-01', [l('1101', 5000, 0), l('4101', 0, 5000)]),
 mk(3, '2024-08-01', [l('5102', 1000, 0), l('1101', 0, 1000)]),
 mk(4, '2024-12-31', [l('4101', 5000, 0), l('5102', 0, 1000), l('3102', 0, 4000)], 'year_closing'),
 mk(5, '2025-06-01', [l('1101', 9000, 0), l('4101', 0, 9000)]),
 mk(6, '2025-08-01', [l('5102', 3000, 0), l('1101', 0, 3000)]),
 mk(7, '2025-09-01', [l('3101', 500, 0), l('1101', 0, 500)]),
 mk(8, '2025-10-01', [l('3101', 200, 0), l('4101', 0, 200)], 'opening'),
]
const current = { from: '2025-01-01', to: '2025-12-31' }, prior = { from: '2024-01-01', to: '2024-12-31' }
const row = (key: string, journal = entries) => financialComparison(journal, current, prior, ['1101']).sections.flatMap(section => section.rows).find(item => item.key === key)!

it('يطابق القوائم على رقم الحساب، ويستبعد الإقفال من النتيجة ومن حركة حقوق الملكية المباشرة', () => {
 expect(row('net')).toMatchObject({ currentMinor: 6000, priorMinor: 4000 })
 expect(row('equity-start')).toMatchObject({ currentMinor: 14000, priorMinor: 0 })
 expect(row('equity-opening')).toMatchObject({ currentMinor: 200, priorMinor: 0 })
 expect(row('equity-direct')).toMatchObject({ currentMinor: -700, priorMinor: 10000 })
 expect(row('equity-end')).toMatchObject({ currentMinor: 19500, priorMinor: 14000 })
 expect(row('equity-difference')).toMatchObject({ currentMinor: 0, priorMinor: 0 })
 expect(row('assets-total')).toMatchObject({ currentMinor: 19500, priorMinor: 14000 })
 expect(financialComparison(entries, current, prior, ['1101'])).toMatchObject({ currentBalanced: true, priorBalanced: true, currentEquityReconciled: true, priorEquityReconciled: true })
})
it('يحترم الرصيد في اليوم الكبيس السابق مباشرةً لبداية الفترة', () => {
 const leap = [mk(1, '2024-02-29', [l('1101', 1234, 0), l('3101', 0, 1234)])]
 const result = financialComparison(leap, { from: '2024-03-01', to: '2024-03-31' }, { from: '2024-02-01', to: '2024-02-29' }, ['1101'])
 expect(result.sections.flatMap(section => section.rows).find(item => item.key === 'equity-start')?.currentMinor).toBe(1234)
})
it('يبقي النتائج متطابقة بعد عكس الإقفال وإقفاله مجدداً', () => {
 const oldClose = { ...entries[3], reversedByEntryId: 9 }
 const reversal = { ...mk(9, '2024-12-31', oldClose.lines.map(line => l(line.accountCode, line.credit, line.debit)), 'reversal'), sourceId: 4, reversesEntryId: 4 }
 const newClose = { ...oldClose, id: 10, entryNumber: 10, reversedByEntryId: null }
 const ledger = [...entries.slice(0, 3), oldClose, ...entries.slice(4), reversal, newClose]
 expect(row('net', ledger)).toMatchObject({ currentMinor: 6000, priorMinor: 4000 })
 expect(row('equity-difference', ledger)).toMatchObject({ currentMinor: 0, priorMinor: 0 })
})
it('يحافظ على دقة الأرقام المصدرة حتى الحد الآمن وبالكسور المختلفة', () => {
 expect(comparisonCsvAmount(-Number.MAX_SAFE_INTEGER, 2)).toBe('-90071992547409.91')
 expect(comparisonCsvAmount(9_007_199_254_739_999, 3)).toBe('9007199254739.999')
 expect(comparisonCsvAmount(7, 3)).toBe('0.007')
 expect(comparisonCsvAmount(7, 0)).toBe('7')
 expect(() => comparisonCsvAmount(Number.MAX_SAFE_INTEGER + 1, 2)).toThrow(/النطاق الآمن/)
})
it('يحجب المقارنة عند خلل بنيوي في الدفتر الظاهر', () => {
 expect(() => financialComparison([...entries, { ...entries[0], id: 20, lines: [l('1101', 1, 0)] }], current, prior, ['1101'])).toThrow(/#20/)
 expect(() => financialComparison([...entries, entries[0]], current, prior, ['1101'])).toThrow(/#1/)
})
it('يرفض فترة مقلوبة أو متداخلة أو غير تقويمية بلا إنشاء مقارنة مضللة', () => {
 expect(() => financialComparison(entries, current, { from: '2024-02-30', to: '2024-12-31' }, ['1101'])).toThrow(/غير صالحة/)
 expect(() => financialComparison(entries, current, { from: '2024-01-01', to: '2025-01-01' }, ['1101'])).toThrow(/تداخل/)
 expect(() => financialComparison(entries, current, { from: '2024-12-31', to: '2024-01-01' }, ['1101'])).toThrow(/غير صالحة/)
})

beforeEach(() => {
 print.mockClear()
 useRawDataStore.setState({ ...orig, currentUserId: null, activeBranchId: 1, branches: [{ id: 1, nameAr: 'الفرع <أ>', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الآخر', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }], treasuries: [{ code: '1101', nameAr: 'النقدية <س>', kind: 'cash', isDefault: true }], customAccounts: [], journal: [...entries, mk(11, '2025-02-01', [l('1102', 80000, 0), l('4101', 0, 80000)], 'manual', 2)] } as never)
})
afterEach(() => { cleanup(); useRawDataStore.setState(orig); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const renderReport = () => render(<FinancialReportsTab period={current} cur={{ code: 'SAR', symbol: 'ر.س', name: 'ريال', decimals: 2 }} companyName="المنشأة" />)
function selectComparison() { fireEvent.change(screen.getByRole('combobox'), { target: { value: 'comparison' } }); fireEvent.change(screen.getByLabelText('بداية فترة المقارنة'), { target: { value: prior.from } }); fireEvent.change(screen.getByLabelText('نهاية فترة المقارنة'), { target: { value: prior.to } }) }
it('تعرض المقارنة والفرع والتواريخ والتحذير وتطبع البيانات نفسها مع تهريب الأسماء', () => {
 renderReport(); selectComparison()
 const section = screen.getByRole('region', { name: 'مقارنة القوائم التشغيلية' })
 expect(within(section).getByText(/توازن المركز المالي/).textContent).toContain('متوازن')
 const result = within(section).getByText('صافي الربح / الخسارة').closest('tr')!
 expect(result.textContent).toContain('60'); expect(result.textContent).toContain('40')
 fireEvent.click(within(section).getByText('طباعة المقارنة / PDF'))
 const html = print.mock.calls[0][0] as string
 expect(html).toContain('الفرع &lt;أ&gt;'); expect(html).toContain('النقدية &lt;س&gt;'); expect(html).not.toContain('النقدية <س>')
 expect(html).toContain('2024-01-01'); expect(html).toContain('2025-12-31'); expect(html).toContain('ليست قوائم قانونية')
 act(() => { useRawDataStore.setState({ activeBranchId: 2 }) })
 const newSection = screen.getByRole('region', { name: 'مقارنة القوائم التشغيلية' })
 expect(within(newSection).queryByText('صافي الربح / الخسارة')).toBeNull()
 fireEvent.change(screen.getByLabelText('بداية فترة المقارنة'), { target: { value: prior.from } })
 fireEvent.change(screen.getByLabelText('نهاية فترة المقارنة'), { target: { value: prior.to } })
 expect(within(newSection).getByText('صافي الربح / الخسارة').closest('tr')?.textContent).toContain('800')
})
it('يجمع للمالك الفروع المنسوبة صراحة فقط ويحذّر من غياب التاريخ والقيود غير المسندة في الشاشة والطباعة', () => {
 useRawDataStore.setState({ activeBranchId: null, financialEntityProfiles: [{ id: 'one', nameAr: 'شركة <أ>', branchIds: [1], framework: 'sme', externalAudit: 'exempt' }], journal: [...entries, mk(11, '2025-02-01', [l('1102', 80000, 0), l('4101', 0, 80000)], 'manual', 2), { ...mk(12, '2025-03-01', [l('1101', 70000, 0), l('4101', 0, 70000)]), branchId: undefined }] })
 renderReport(); selectComparison()
 fireEvent.change(screen.getByLabelText('نطاق المقارنة الاسترشادي'), { target: { value: 'one' } })
 const section = screen.getByRole('region', { name: 'مقارنة القوائم التشغيلية' })
 expect(within(section).getByRole('note').textContent).toContain('استُبعد 1 قيد دون فرع صريح')
 expect(within(section).getByRole('note').textContent).toContain('لا تاريخ صلاحية له')
 expect(within(section).getByText('صافي الربح / الخسارة').closest('tr')?.textContent).toContain('60.00')
 fireEvent.click(within(section).getByText('طباعة المقارنة / PDF'))
 expect(print.mock.calls[0][0]).toContain('شركة &lt;أ&gt;')
 expect(print.mock.calls[0][0]).toContain('استُبعد 1 قيد')
})
it('يرفض تجميع إعداد دون فروع ولا يكشف إعدادات الكيان لموظف الفرع', () => {
 useRawDataStore.setState({ activeBranchId: null, financialEntityProfiles: [{ id: 'empty', nameAr: 'غير محددة', branchIds: [], framework: 'undetermined', externalAudit: 'undetermined' }] })
 renderReport(); selectComparison()
 fireEvent.change(screen.getByLabelText('نطاق المقارنة الاسترشادي'), { target: { value: 'empty' } })
 expect(screen.getByRole('region', { name: 'مقارنة القوائم التشغيلية' }).textContent).toContain('لا يحتوي فروعاً')
 act(() => { useRawDataStore.setState({ appUsers: [{ id: 3, nameAr: 'موظف', roleId: 'cashier', pinHash: '', active: true, branchId: 1 }], currentUserId: 3, activeBranchId: 1 }) })
 expect(screen.queryByLabelText('نطاق المقارنة الاسترشادي')).toBeNull()
})
it('يعطل التصدير عند التداخل ويصدر CSV ببيانات النطاق والقيم السالبة العددية بعد التصحيح', async () => {
 let blob: Blob | null = null
 vi.stubGlobal('URL', { ...URL, createObjectURL: (value: Blob) => { blob = value; return 'blob:test' }, revokeObjectURL: () => {} })
 vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
 renderReport(); selectComparison()
 fireEvent.change(screen.getByLabelText('نهاية فترة المقارنة'), { target: { value: '2025-01-01' } })
 const section = screen.getByRole('region', { name: 'مقارنة القوائم التشغيلية' })
 expect(within(section).getByRole('alert').textContent).toContain('تداخل')
 expect(within(section).getByText('تصدير المقارنة CSV').closest('button')?.disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('نهاية فترة المقارنة'), { target: { value: prior.to } })
 fireEvent.click(within(section).getByText('تصدير المقارنة CSV'))
 const text = await (blob! as Blob).text()
 expect(text).toContain('الفرع <أ>'); expect(text).toContain('2024-01-01'); expect(text).toContain('ليست قوائم قانونية')
 expect(text).toContain('باستثناء آلية الإقفال,-7.00,100.00'); expect(text).not.toContain("باستثناء آلية الإقفال,'-7")
})
