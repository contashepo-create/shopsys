import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../src/ui/print/printReceipt.ts', async (load) => ({ ...(await load<typeof import('../src/ui/print/printReceipt.ts')>()), printHtml: vi.fn() }))
vi.mock('../src/core/fullExport.ts', async (load) => ({ ...(await load<typeof import('../src/core/fullExport.ts')>()), downloadTextFile: vi.fn() }))
import { printHtml } from '../src/ui/print/printReceipt.ts'
import { downloadTextFile } from '../src/core/fullExport.ts'
import { ContractingReportsPage } from '../src/ui/pages/ContractingReportsPage.tsx'
import { ProjectBudgetPage } from '../src/ui/pages/ContractingPlanPages.tsx'
import { EvmDashboardPage } from '../src/ui/pages/ProjectOpsPages.tsx'
import { Header } from '../src/ui/layout/Header.tsx'
import { ProjectExpenseWindowView } from '../src/ui/windows/ProjectExpenseWindowView.tsx'
import { FinancialDataReviewError } from '../src/core/financialDataReview.ts'
import { AnalyticalProjectReportView } from '../src/ui/contracting/AnalyticalProjectReportView.tsx'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const project = (id: number) => ({ id, code: `PRJ-000${id}`, nameAr: `مشروع ${id}`, status: 'active', startDate: '2020-01-01', clientId: null, clientName: '', contractValueMinor: 100000, retentionPercent: 0, notes: '' })

beforeEach(() => {
  const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, countryCode: 'EG', allowNegativeTreasury: true }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], approvals: { ...app.approvals, enabled: false } })
  useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [], projects: [project(1), project(2)] as never, projectCosts: [], projectExtracts: [], retentionReleases: [], changeOrders: [], clientAdvances: [], customers: [], payrollRuns: [], payrollSlips: [], journal: [], employeeAdvances: [], advanceRepayments: [], employeeDeductions: [], attendanceRecords: [], leaveRequests: [] })
  S().addEmployee({ nameAr: 'موظف', phone: '', roleId: 'cashier', baseSalaryMinor: 10000, active: true } as never)
  S().accruePayrollSlips({ month: todayLocalIso().slice(0, 7), rows: [{ employeeId: 1, grossMinor: 10000, allowancesMinor: 0, deductionsMinor: 0, advanceMinor: 0, projectPercentages: [{ projectId: 1, basisPoints: 2500 }, { projectId: 2, basisPoints: 7500 }] }] })
  vi.clearAllMocks()
})
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); useRawDataStore.setState(original); useAppStore.setState(app) })

function selectFirstProject() {
  fireEvent.change(screen.getByLabelText('بحث المشروع'), { target: { value: 'مشروع' } })
  const option = [...document.querySelectorAll('[data-quick-option="true"]')].find(row => (row as HTMLElement).dataset.value === '1')
  expect(option).toBeTruthy()
  fireEvent.doubleClick(option!)
}

it('يظهر إجمالي 5110 و5102 وتفصيل القسيمة في البطاقة والطباعة وExcel حتى دون مصروفات 5110', () => {
  render(<MemoryRouter><ContractingReportsPage /></MemoryRouter>)
  fireEvent.click(screen.getAllByText('مشروع بعينه')[0]); selectFirstProject()
  expect(document.querySelector('[data-cost-sources]')?.textContent).toContain('25.00')
  expect(document.querySelector('[data-project-payroll-costs]')?.textContent).toContain('PS-0001')
  expect(document.querySelector('[data-project-payroll-costs]')?.textContent).toContain('25٪')
  fireEvent.click(document.querySelector('[data-print="project-card"]')!)
  const html = vi.mocked(printHtml).mock.calls.at(-1)?.[0] ?? ''
  expect(html).toContain('تفصيل التوزيع المثبت من 5102'); expect(html).toContain('25.00'); expect(html).toContain('المسير المجمّع')
  const excel = document.querySelector('[data-expense-ledger-excel]') as HTMLButtonElement
  expect(excel.disabled).toBe(false); fireEvent.click(excel)
  const xml = vi.mocked(downloadTextFile).mock.calls.at(-1)?.[2] ?? ''
  expect(xml).toContain('توزيع الرواتب 5102'); expect(xml).toContain('PS-0001'); expect(xml).toContain('25')
  expect(S().journal).toHaveLength(1); expect(S().projectCosts).toHaveLength(0)
})

it('التقرير التحليلي يشمل نصيب القسيمة ويحظر طباعة معاينة قديمة عند تلف القيد', () => {
  render(<MemoryRouter><AnalyticalProjectReportView projectId="1" onProjectChange={() => {}} /></MemoryRouter>)
  expect(screen.getByText(/توزيع قسيمة 5102/)).toBeTruthy()
  expect(screen.getByText(/المسير المجمّع والقسائم بلا توزيع/)).toBeTruthy()
  fireEvent.click(document.querySelector('[data-print-formal]')!)
  expect(usePrintPreview.getState().handle?.html).toContain('PS-0001')
  act(() => { useRawDataStore.setState({ journal: S().journal.map(entry => ({ ...entry, lines: entry.lines.map(line => line.accountCode === '5102' ? { ...line, debit: 1 } : line) })) }); usePrintPreview.getState().refresh() })
  expect(screen.getByRole('alert').textContent).toContain('مراجعة توزيعات الرواتب')
  expect(usePrintPreview.getState().rebuildError).toBe(true)
})

it('تعطل صفحة التقارير الأرقام والأزرار عند فقد دليل الإلغاء', () => {
  S().cancelPayrollSlip(S().payrollSlips[0].id, 'تصحيح')
  useRawDataStore.setState({ payrollSlips: S().payrollSlips.map(slip => ({ ...slip, cancellationEntryId: undefined })) })
  render(<MemoryRouter><ContractingReportsPage /></MemoryRouter>)
  expect(screen.getByRole('alert').textContent).toContain('توزيعات الرواتب')
  expect(document.querySelector('[data-print="projects"]')).toBeNull()
  expect(screen.queryByText('تصدير اللوحة CSV')).toBeNull()
})

it('تمنع إعادة بناء بطاقة مطبوعة عند تغير مستند تكلفة بعد فتح المعاينة', () => {
  render(<MemoryRouter><ContractingReportsPage /></MemoryRouter>)
  fireEvent.click(screen.getAllByText('مشروع بعينه')[0]); selectFirstProject()
  fireEvent.click(document.querySelector('[data-print="project-card"]')!)
  const options = vi.mocked(printHtml).mock.calls.at(-1)?.[1]
  const rebuild = options?.preview?.rebuild
  expect(rebuild).toBeTypeOf('function')
  act(() => { useRawDataStore.setState({ projectCosts: [{ id: 12, projectId: 1, kind: 'materials', amountMinor: 100, date: todayLocalIso(), description: 'مواد', payment: 'cash', journalEntryId: 100 }] as never }) })
  expect(() => rebuild!()).toThrow(/تغير أساس التقرير/)
})

it('الموازنة وEVM تحسبان حصة المشروع مرة واحدة وتستبعدان الإلغاء المثبت', () => {
  useRawDataStore.setState({ projectBudgets: [{ id: 1, projectId: 1, kind: 'labor', amountMinor: 2000 }] as never, boqItems: [{ id: 1, projectId: 1, code: '1', descriptionAr: 'بند', unit: 'م', qty: 1, unitPriceMinor: 10000, estCostMinor: 8000, progressPercent: 50 }] })
  expect(S().getProjectBudgetVariance(1).rows.find(r => r.kind === 'labor')).toMatchObject({ actualMinor: 2500, status: 'over' })
  expect(S().getProjectBudgetVariance(2).totalActualMinor).toBe(7500)
  expect(S().getProjectEvm(1).actualCostMinor).toBe(2500)
  S().cancelPayrollSlip(S().payrollSlips[0].id, 'تصحيح')
  expect(S().getProjectBudgetVariance(1).totalActualMinor).toBe(0)
  expect(S().getProjectEvm(1).actualCostMinor).toBe(0)
  useRawDataStore.setState({ payrollSlips: S().payrollSlips.map(s => ({ ...s, cancellationEntryId: undefined })) })
  expect(() => S().getProjectBudgetVariance(1)).toThrow(FinancialDataReviewError)
  expect(() => S().getProjectEvm(1)).toThrow(FinancialDataReviewError)
})

it('تتحدث شاشة الموازنة فور تغير القيد وتخفي الأرقام عند فساد الدليل ثم تستعيدها', () => {
  const originalJournal = S().journal
  render(<MemoryRouter><ProjectBudgetPage /></MemoryRouter>)
  expect(document.body.textContent).toContain('25.00')
  act(() => { useRawDataStore.setState({ journal: [] }) })
  expect(screen.getByRole('alert').textContent).toContain('مراجعة')
  expect(document.querySelector('table')).toBeNull()
  act(() => { useRawDataStore.setState({ journal: originalJournal }) })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(document.body.textContent).toContain('25.00')
})

it('تتحدث لوحة القيمة المكتسبة مع القسائم والقيود وتعرض المراجعة بدل أرقام قديمة', () => {
  useRawDataStore.setState({ boqItems: [{ id: 1, projectId: 1, code: '1', descriptionAr: 'بند', unit: 'م', qty: 1, unitPriceMinor: 10000, estCostMinor: 8000, progressPercent: 50 }] })
  render(<MemoryRouter><EvmDashboardPage /></MemoryRouter>)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })
  expect(document.body.textContent).toContain('25.00')
  act(() => { useRawDataStore.setState({ journal: [] }) })
  expect(screen.getByRole('alert').textContent).toContain('مراجعة')
  expect(screen.queryByText('التكلفة الفعلية AC')).toBeNull()
})

it('المبالغ أو جدول الكميات غير الآمنين يحجبان النتائج بدلاً من أرقام غير دقيقة', () => {
  useRawDataStore.setState({ projectBudgets: [{ id: 1, projectId: 1, kind: 'labor', amountMinor: Number.MAX_SAFE_INTEGER + 1 }] as never })
  expect(() => S().getProjectBudgetVariance(1)).toThrow(FinancialDataReviewError)
  useRawDataStore.setState({ boqItems: [{ id: 1, projectId: 1, code: '1', descriptionAr: 'بند', unit: 'م', qty: Number.MAX_SAFE_INTEGER, unitPriceMinor: 10000, estCostMinor: 8000, progressPercent: 50 }] })
  expect(() => S().getProjectEvm(1)).toThrow(FinancialDataReviewError)
})

it('جرس الموازنة يستبدل التجاوز بتحذير مراجعة عند فساد القيد دون تعطيل الرأس ثم يحدثه عند الإصلاح', () => {
  const originalJournal = S().journal
  useRawDataStore.setState({ projectBudgets: [{ id: 1, projectId: 1, kind: 'labor', amountMinor: 2000 }] as never, readNotificationIds: [] })
  render(<MemoryRouter><Header title="الرئيسية" /></MemoryRouter>)
  fireEvent.click(document.querySelector('button[title*="تنبيه"]')!)
  expect(document.body.textContent).toContain('تجاوز موازنة: مشروع 1')
  act(() => { useRawDataStore.setState({ journal: [] }) })
  expect(document.body.textContent).toContain('مراجعة موازنة: مشروع 1')
  expect(document.body.textContent).not.toContain('تجاوز موازنة: مشروع 1')
  expect(document.body.textContent).toContain('الرئيسية')
  act(() => { useRawDataStore.setState({ journal: originalJournal }) })
  expect(document.body.textContent).toContain('تجاوز موازنة: مشروع 1')
  expect(document.body.textContent).not.toContain('مراجعة موازنة: مشروع 1')
})

it('نافذة المصروف تحذر صراحة عند تعذر حساب الموازنة بدلاً من اعتبارها بلا تجاوز', () => {
  useRawDataStore.setState({ journal: [] })
  render(<MemoryRouter><ProjectExpenseWindowView /></MemoryRouter>)
  fireEvent.change(document.querySelector('[data-expense-line-desc]')!, { target: { value: 'مصروف' } })
  fireEvent.change(document.querySelector('[data-expense-line-price]')!, { target: { value: '100' } })
  fireEvent.click(document.querySelector('[data-expense-prepost-open]')!)
  expect(document.body.textContent).toContain('تعذر حساب تحذير الموازنة')
  expect(document.body.textContent).toContain('لا تعني هذه الرسالة عدم وجود تجاوز')
})

it('مرتجع شراء مرتبط بالمشروع لا يخصم من التكلفة دون دليل عكس 5110، بما يشمل الموازنة وEVM', () => {
  const journal = S().journal
  useRawDataStore.setState({ purchases: [{ id: 7, projectId: 1 }] as never, purchaseReturns: [{ id: 8, purchaseId: 7, journalEntryId: 99, returnNumber: 'PR-8', date: todayLocalIso(), totalMinor: 1000 }] as never,
    journal: [...journal, { id: 99, entryNumber: 99, date: todayLocalIso(), description: 'مرتجع مخزون', sourceType: 'purchase_return', sourceId: 8, lines: [{ accountCode: '2101', debit: 1000, credit: 0 }, { accountCode: '1103', debit: 0, credit: 1000 }], createdAt: todayLocalIso(), createdBy: 'اختبار' }] as never })
  expect(() => S().getProjectCostBreakdown(1)).toThrow(/مرتجع شراء المشروع/)
  expect(() => S().getProjectProfit(1)).toThrow(/مرتجع شراء المشروع/)
  expect(() => S().getProjectBudgetVariance(1)).toThrow(/مرتجع شراء المشروع/)
  expect(() => S().getProjectEvm(1)).toThrow(/مرتجع شراء المشروع/)
  expect(S().getProjectProfit(2).costsMinor).toBe(7500)
  expect(S().projectCosts).toHaveLength(0); expect(S().journal).toHaveLength(2)
})

it('يحجب المرتجع تقارير المشاريع وتنبيهاتها فور وصوله ثم تعود المؤشرات إذا رُفع من البيانات للمراجعة', () => {
  useRawDataStore.setState({ projectBudgets: [{ id: 1, projectId: 1, kind: 'labor', amountMinor: 2000 }] as never, purchases: [], purchaseReturns: [], readNotificationIds: [] })
  render(<MemoryRouter><Header title="الرئيسية" /><ProjectBudgetPage /><ContractingReportsPage /></MemoryRouter>)
  fireEvent.click(document.querySelector('button[title*="تنبيه"]')!)
  expect(document.body.textContent).toContain('تجاوز موازنة: مشروع 1')
  act(() => { useRawDataStore.setState({ purchases: [{ id: 7, projectId: 1 }] as never, purchaseReturns: [{ id: 8, purchaseId: 7, totalMinor: 1000 }] as never }) })
  expect(screen.getAllByRole('alert').some(row => row.textContent?.includes('مرتجعات الشراء'))).toBe(true)
  expect(document.body.textContent).toContain('مراجعة موازنة: مشروع 1')
  expect(document.body.textContent).not.toContain('تجاوز موازنة: مشروع 1')
  act(() => { useRawDataStore.setState({ purchaseReturns: [] }) })
  expect(document.body.textContent).toContain('تجاوز موازنة: مشروع 1')
  expect(document.body.textContent).not.toContain('مراجعة موازنة: مشروع 1')
})

it('مرتجع مخفي في فرع آخر لا يختفي من مراجعة المشروع، والمرتجع غير المرتبط لا يحجبه', () => {
  const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
  useRawDataStore.setState({ branches, activeBranchId: 1, projects: [{ ...project(1), branchId: 1 }, { ...project(2), branchId: 2 }] as never,
    purchases: [{ id: 7, projectId: 1, branchId: 1 }, { id: 9, projectId: null, branchId: 1 }] as never,
    purchaseReturns: [{ id: 10, purchaseId: 9, branchId: 1, totalMinor: 1000 }] as never, payrollSlips: [], journal: [] })
  expect(() => S().getProjectCostBreakdown(1)).not.toThrow()
  useRawDataStore.setState({ purchaseReturns: [...S().purchaseReturns, { id: 11, purchaseId: 7, branchId: 2, totalMinor: 500 } as never] })
  expect(() => S().getProjectCostBreakdown(1)).toThrow(/مرتجع شراء المشروع/)
})

it('فاتورة مشروع فعلية تقيد 5110 ولا تدخل مخزون المتجر؛ مرتجع المخزون لها مرفوض بلا تغيير', () => {
  useRawDataStore.setState({ payrollSlips: [], payrollRuns: [], journal: [], projects: [project(1)] as never, projectCosts: [], purchases: [], purchaseReturns: [],
    items: [{ id: 5, nameAr: 'مادة', sku: 'M', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 100, stockQty: 0, priceMinor: 200, isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false }] as never,
    suppliers: [{ id: 8, nameAr: 'مورد', phone: '', openingBalanceMinor: 0 }] as never,
    warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] as never,
    treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
  const purchase = S().postPurchase({ supplierId: 8, projectId: 1, date: todayLocalIso(), lines: [{ itemId: 5, qty: 2, unitPriceMinor: 100, warehouseId: 1 }], expenses: [], paidMinor: 0, treasury: '1101', notes: '' })
  expect(S().journal.find(entry => entry.id === purchase.journalEntryId)?.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '5110', debit: 200 })]))
  expect(S().items[0].stockQty).toBe(0)
  expect(S().getProjectProfit(1).costsMinor).toBe(200)
  const before = S()
  expect(() => S().postPurchaseReturn({ purchaseId: purchase.id, qtyByItem: new Map([[5, 1]]), refund: 'debt', reason: 'اختبار' })).toThrow(/فاتورة مشروع مقاولات/)
  expect(S().journal).toBe(before.journal); expect(S().purchaseReturns).toBe(before.purchaseReturns); expect(S().items).toBe(before.items)
})
