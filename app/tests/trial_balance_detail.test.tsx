import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { trialBalanceDetail, validFinancialPeriod } from '../src/core/financialReports.ts'
import type { JournalEntry, JournalLine } from '../src/core/ledger.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { FinancialReportsTab } from '../src/ui/pages/FinancialReportsTab.tsx'

const print = vi.hoisted(() => vi.fn())
vi.mock('../src/ui/print/printReceipt.ts', () => ({ printHtml: print }))
const line = (accountCode: string, debit: number, credit: number) => ({ accountCode, debit, credit })
const entry = (id: number, date: string, lines: JournalLine[], branchId?: number): JournalEntry => ({ id, entryNumber: id, date, description: 'حركة', sourceType: 'manual', sourceId: null, reversedByEntryId: null, reversesEntryId: null, lines, createdAt: date, createdBy: 'محاسب', ...(branchId ? { branchId } : {}) })
const entries: JournalEntry[] = [
 entry(1, '2025-12-31', [line('1101', 10000, 0), line('3101', 0, 10000)]),
 entry(2, '2026-01-01', [line('1101', 2000, 0), line('4101', 0, 2000)]),
 entry(3, '2026-06-01', [line('5101', 3000, 0), line('1101', 0, 3000)]),
 entry(4, '2026-12-31', [line('1101', 0, 11000), line('3101', 11000, 0)]),
 entry(5, '2027-01-01', [line('1101', 0, 99999), line('5101', 99999, 0)]),
]
const period = { from: '2026-01-01', to: '2026-12-31' }
const original = useRawDataStore.getState(), app = useAppStore.getState()
const cur = { code: 'SAR', symbol: 'ر.س', name: 'ريال', decimals: 2 as const }

beforeEach(() => { print.mockClear(); useRawDataStore.setState({ ...original, loggedOut: false, currentUserId: null, activeBranchId: null, branches: [], customAccounts: [], journal: entries, treasuries: [{ code: '1101', nameAr: '<img src=x>', kind: 'cash', isDefault: true }] } as never) })
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('يحسب الأرصدة السابقة والحركة الشاملة للحدود والأرصدة المدينة والدائنة من الدفتر', () => {
 const result = trialBalanceDetail(entries, period)
 expect(result.rows.find(r => r.code === '1101')).toMatchObject({ openingDebitMinor: 10000, openingCreditMinor: 0, movementDebitMinor: 2000, movementCreditMinor: 14000, closingDebitMinor: 0, closingCreditMinor: 2000 })
 expect(result.rows.find(r => r.code === '3101')).toMatchObject({ openingCreditMinor: 10000, movementDebitMinor: 11000, closingDebitMinor: 1000 })
 expect(result.rows.find(r => r.code === '4101')).toMatchObject({ closingCreditMinor: 2000 })
 expect(result.rows.find(r => r.code === '5101')).toMatchObject({ closingDebitMinor: 3000 })
 expect(result.totals).toEqual({ openingDebitMinor: 10000, openingCreditMinor: 10000, movementDebitMinor: 16000, movementCreditMinor: 16000, closingDebitMinor: 4000, closingCreditMinor: 4000 })
 expect(result).toMatchObject({ openingBalanced: true, movementBalanced: true, closingBalanced: true })
})
it('يبقي الأرصدة التي لا حركة لها ويظهر اختلال أول الفترة منفصلاً عن اختلال حركتها', () => {
 const j = [entry(1, '2025-12-31', [line('1101', 500, 0)]), entry(2, '2026-02-01', [line('4101', 0, 500)])]
 const result = trialBalanceDetail(j, period)
 expect(result.rows).toHaveLength(2)
 expect(result).toMatchObject({ openingBalanced: false, movementBalanced: false, closingBalanced: true })
 expect(result.rows.find(r => r.code === '1101')?.openingDebitMinor).toBe(500)
})
it('يعرض حسابات التحويل بين الفروع كما في الدفتر ولا يخفي أحد الطرفين لاستبعاد مستقبلي', () => {
 const transfer = [
  { ...entry(1, '2026-01-01', [{ ...line('1114', 100, 0), relatedBranchId: 2 }, line('1101', 0, 100)], 1), sourceId: 1, interBranchTransferId: 1 },
  { ...entry(2, '2026-01-02', [line('1102', 100, 0), { ...line('2118', 0, 100), relatedBranchId: 1 }], 2), sourceId: 1, interBranchTransferId: 1 },
 ]
 const result = trialBalanceDetail(transfer, { from: '2026-01-01', to: '2026-01-01' })
 expect(result.rows.find(row => row.code === '1114')?.closingDebitMinor).toBe(100)
 expect(result.rows.some(row => row.code === '2118')).toBe(false)
 expect(result.closingBalanced).toBe(true)
})
it('يرفض الفترة المعكوسة والتاريخ غير الموجود بدلاً من إخراج ميزان فارغ متوازن', () => {
 expect(validFinancialPeriod({ from: '2026-02-30', to: '2026-03-02' })).toBe(false)
 expect(() => trialBalanceDetail(entries, { from: '2026-12-31', to: '2026-01-01' })).toThrow(/غير صالحة/)
 render(<FinancialReportsTab period={{ from: '2026-12-31', to: '2026-01-01' }} cur={cur} companyName="منشأة" />)
 expect(screen.getByRole('alert').textContent).toContain('فترة التقرير غير صالحة')
 expect(screen.queryByText('طباعة / PDF')).toBeNull()
})
it('يعرض ويطبع ويصدر أعمدة الميزان والمنهج والنطاق مع تهريب اسم الحساب', async () => {
 let blob: Blob | undefined
 vi.stubGlobal('URL', { ...URL, createObjectURL: (value: Blob) => { blob = value; return 'blob:test' }, revokeObjectURL: () => {} })
 vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
 render(<FinancialReportsTab period={period} cur={cur} companyName="منشأة" />)
 expect(screen.getByText(/ميزان الدفتر كما هو/)).toBeTruthy()
 const table = screen.getByRole('table')
 expect(within(table).getByText('أول الفترة مدين')).toBeTruthy()
 const row = within(table).getByText('<img src=x>').closest('tr')!
 const cells = within(row).getAllByRole('cell').map(cell => cell.textContent)
 expect(cells).toEqual(['1101', '<img src=x>', '100.00', '—', '20.00', '140.00', '—', '20.00'])
 fireEvent.click(screen.getByText('طباعة / PDF'))
 const html = print.mock.calls[0][0] as string
 expect(html).toContain('أول الفترة مدين'); expect(html).toContain('آخر الفترة دائن'); expect(html).toContain('&lt;img src=x&gt;'); expect(html).not.toContain('<img src=x>')
 fireEvent.click(screen.getByText('تصدير Excel'))
 const text = await blob!.text()
 expect(text).toContain('منهج الميزان'); expect(text).toContain('أول الفترة مدين'); expect(text).toContain('آخر الفترة دائن'); expect(text).toContain('التوازن')
 expect(new Uint8Array(await blob!.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]))
})
it('يستخدم نطاق الفرع الظاهر ولا يمزج حركة فرع آخر', () => {
 const branches = [{ id: 1, nameAr: 'الأول', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 const scoped = [entry(1, '2025-12-31', [line('1101', 10000, 0), line('3101', 0, 10000)], 1), entry(2, '2026-02-01', [line('1102', 70000, 0), line('4101', 0, 70000)], 2)]
 useRawDataStore.setState({ branches, journal: scoped, activeBranchId: 1 } as never)
 render(<FinancialReportsTab period={period} cur={cur} companyName="منشأة" />)
 expect(screen.queryByText('700.00')).toBeNull()
 act(() => { useRawDataStore.setState({ activeBranchId: 2 }) })
 expect(screen.getAllByText('700.00').length).toBeGreaterThan(0)
 expect(screen.queryByText('100.00')).toBeNull()
})

it('يوضح حدود التصنيف الآلي للتدفقات في الشاشة والطباعة والتصدير', async () => {
 let blob: Blob | undefined
 vi.stubGlobal('URL', { ...URL, createObjectURL: (value: Blob) => { blob = value; return 'blob:test' }, revokeObjectURL: () => {} })
 vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
 render(<FinancialReportsTab period={period} cur={cur} companyName="منشأة" />)
 fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cash_flow' } })
 expect(screen.getByText(/تصنيف التدفقات تقديري/)).toBeTruthy()
 fireEvent.click(screen.getByText('طباعة / PDF'))
 expect(print.mock.calls[0][0]).toContain('قد لا يوزع القيد المركب')
 expect(print.mock.calls[0][0]).not.toContain('حسب النشاط (IAS 7)')
 fireEvent.click(screen.getByText('تصدير Excel'))
 expect(await blob!.text()).toContain('تصنيف التدفقات تقديري')
})
