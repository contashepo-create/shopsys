import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { retentionWarningsWithReview } from '../src/core/contracting.ts'
import { FinancialDataReviewError } from '../src/core/financialDataReview.ts'
import { ContractingReportsPage } from '../src/ui/pages/ContractingReportsPage.tsx'
import { ProjectsPage } from '../src/ui/pages/ContractingPages.tsx'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
  const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], customers: [], projects: [], boqItems: [], projectExtracts: [], retentionReleases: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], sales: [], saleReturns: [], vouchers: [], clientSettlements: [], changeOrders: [], paymentTerminals: [], paymentTerminalTransactions: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
})
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); useRawDataStore.setState(initial); useAppStore.setState(app); vi.useRealTimers() })
function setup() {
  const project = S().addProject({ nameAr: 'مشروع الاختبار', clientId: S().customers[0].id, clientName: 'عميل', contractValueMinor: 10000, retentionPercent: 10, startDate: '2026-01-01', notes: '' })
  const extract = S().addProjectExtract({ projectId: project.id, date: '2026-11-03', grossMinor: 10000, payment: 'credit', vatPercent: 0, description: 'أعمال' })
  expect(S().getRemainingRetention(project.id)).toBe(1000)
  expect(S().releaseRetention(project.id).amount).toBe(1000)
  expect(S().getRemainingRetention(project.id)).toBe(0)
  return { project, extract, release: S().retentionReleases[0] }
}
it('يحجب رصيد المحتجز وربحية المشروع إذا لم يطابق تحصيله القيد أو فقد القيد', () => {
  const { project, release } = setup(), journal = S().journal
  for (const changed of [journal.filter(row => row.id !== release.journalEntryId), journal.map(row => row.id === release.journalEntryId ? { ...row, lines: row.lines.map(line => line.accountCode === '1105' ? { ...line, credit: 999 } : line) } : row), [...journal, journal.find(row => row.id === release.journalEntryId)!]]) {
    useRawDataStore.setState({ journal: changed })
    expect(() => S().getRemainingRetention(project.id)).toThrow(FinancialDataReviewError)
    expect(() => S().getProjectProfit(project.id)).toThrow(FinancialDataReviewError)
  }
})
it('يرفض تكرار هوية التحصيل أو المبلغ الزائد أو التاريخ غير المطابق قبل عرض الرصيد', () => {
  const { project, release } = setup(), original = S().retentionReleases
  for (const releases of [[...original, release], [{ ...release, amountMinor: 1001 }], [{ ...release, date: '2026-02-30' }], [{ ...release, date: '2026-11-04' }]]) {
    useRawDataStore.setState({ retentionReleases: releases })
    expect(() => S().getRemainingRetention(project.id)).toThrow(FinancialDataReviewError)
  }
})
it('لا يستعير قيد تحصيل أو إصدار صريح من فرع آخر في العرض الشامل', () => {
  const { project, extract, release } = setup()
  const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
  const journal = S().journal
  useRawDataStore.setState({ branches: branches as never, activeBranchId: null })
  for (const id of [extract.journalEntryId, release.journalEntryId]) {
    useRawDataStore.setState({ journal: journal.map(row => row.id === id ? { ...row, branchId: 2 } : row) })
    expect(() => S().getRemainingRetention(project.id)).toThrow(FinancialDataReviewError)
  }
})
it('يعرض تنبيه مراجعة ويمنع التقارير دون إسقاط المشروع أو إظهار رصيد صفري مؤكد', () => {
  const { project, release } = setup()
  useRawDataStore.setState({ journal: S().journal.filter(entry => entry.id !== release.journalEntryId) })
  const warnings = retentionWarningsWithReview([{ ...project, actualHandoverDate: '2026-10-01', defectsLiabilityMonths: 1 }], S().getRemainingRetention, '2026-11-05')
  expect(warnings.review).toEqual([{ projectId: project.id, projectNameAr: project.nameAr }]); expect(warnings.due).toEqual([])
  render(<MemoryRouter><ContractingReportsPage /></MemoryRouter>)
  expect(screen.getByRole('alert').textContent).toContain('يلزم مراجعة'); expect(screen.queryByText('طباعة / PDF')).toBeNull()
  cleanup()
  render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
  expect(screen.getByText('يلزم مراجعة قيود المشروع')).toBeTruthy(); expect(screen.getByText('مشروع الاختبار')).toBeTruthy()
})
it('يستعيد رصيد المحتجز المدقق بعد النسخ الاحتياطي', async () => {
  const { project } = setup(), { secureStorage, flushSecureStorageWrites } = await import('../src/data/secureStorage.ts'), { buildBackup, parseBackup } = await import('../src/core/backup.ts')
  vi.useRealTimers(); await flushSecureStorageWrites('shopsys-data')
  const backup = buildBackup({ appState: {}, storeState: JSON.parse((await secureStorage.getItem('shopsys-data'))!), appDataVersion: 25, shopName: 'اختبار' })
  const restored = parseBackup(JSON.stringify(backup))
  useRawDataStore.setState({ projects: [], projectExtracts: [], retentionReleases: [], journal: [] })
  await flushSecureStorageWrites('shopsys-data'); await secureStorage.setItem('shopsys-data', JSON.stringify(restored.data.store)); await useRawDataStore.persist.rehydrate()
  expect(S().getRemainingRetention(project.id)).toBe(0); expect(S().getProjectProfit(project.id).retentionHeldMinor).toBe(0)
  expect(S().retentionReleases[0].allocationEvidence).toEqual({ version: 1, allocations: [{ extractId: S().projectExtracts[0].id, journalEntryId: S().projectExtracts[0].journalEntryId, amountMinor: 1000 }] })
})

it('تتعطل طباعة المعاينة القديمة عند فقد دليل تحصيل المحتجز بعد فتحها', () => {
  const { release } = setup()
  render(<MemoryRouter><ContractingReportsPage /></MemoryRouter>)
  fireEvent.click(document.querySelector('[data-print="projects"]')!)
  expect(usePrintPreview.getState().handle?.html).toContain('مشروع الاختبار')
  act(() => { useRawDataStore.setState({ journal: S().journal.filter(entry => entry.id !== release.journalEntryId) }); usePrintPreview.getState().refresh() })
  expect(usePrintPreview.getState().rebuildError).toBe(true)
  expect(screen.getByRole('alert').textContent).toContain('يلزم مراجعة')
})

it('لا يبرر تحصيلاً أقدم بمحتجز مستخلص أضيف بعده رغم تساوي الإجمالي النهائي', () => {
  const { project, extract, release } = setup(), entries = S().journal
  const movedRelease = { ...release, journalEntryId: extract.journalEntryId }
  const movedExtract = { ...extract, journalEntryId: release.journalEntryId }
  const movedEntries = entries.map(row => row.id === extract.journalEntryId ? { ...entries.find(e => e.id === release.journalEntryId)!, id: extract.journalEntryId, date: extract.date.slice(0, 10) } : row.id === release.journalEntryId ? { ...entries.find(e => e.id === extract.journalEntryId)!, id: release.journalEntryId, date: extract.date.slice(0, 10) } : row)
  useRawDataStore.setState({ projectExtracts: [movedExtract], retentionReleases: [{ ...movedRelease, date: extract.date.slice(0, 10) }], journal: movedEntries })
  expect(() => S().getRemainingRetention(project.id)).toThrow(FinancialDataReviewError)
})

it('يحمي تحصيل الماكينة الجديد عند فقد الحركة أو تعديلها أو ردها، ويحميها في مقارنة الاستعادة', async () => {
  const terminal = { id: 't1', code: 'TERM-0001', nameAr: 'ماكينة', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'P1', status: 'active' as const }
  S().addPaymentTerminal(terminal)
  const project = S().addProject({ nameAr: 'مشروع ماكينة', clientId: S().customers[0].id, clientName: 'عميل', contractValueMinor: 10000, retentionPercent: 10, startDate: '2026-01-01', notes: '' })
  S().addProjectExtract({ projectId: project.id, date: '2026-11-03', grossMinor: 10000, payment: 'credit', vatPercent: 0, description: 'أعمال' })
  S().releaseRetention(project.id, '1101', { terminalId: 't1', providerReference: 'PAY-123' })
  const current = S(), charge = current.paymentTerminalTransactions[0], release = current.retentionReleases[0]
  const { assertProjectFinancialHistoryPreserved } = await import('../src/core/projectFinancialHistoryGuard.ts')
  const snapshot = { clientAdvances: current.clientAdvances, projectExtracts: current.projectExtracts, retentionReleases: current.retentionReleases, paymentTerminalTransactions: current.paymentTerminalTransactions }
  expect(() => assertProjectFinancialHistoryPreserved(snapshot, structuredClone(snapshot))).not.toThrow()
  for (const transactions of [[], [{ ...charge, amountMinor: charge.amountMinor - 1 }], [charge, charge], [charge, { ...charge, id: 'void', kind: 'void' as const, originalTransactionId: charge.id }]]) {
    useRawDataStore.setState({ paymentTerminalTransactions: transactions })
    expect(() => S().getRemainingRetention(project.id)).toThrow(FinancialDataReviewError)
    expect(() => S().getProjectProfit(project.id)).toThrow(FinancialDataReviewError)
  }
  for (const transactions of [[], [{ ...charge, providerReference: 'مختلف' }], [charge, charge]]) {
    expect(() => assertProjectFinancialHistoryPreserved(snapshot, { ...snapshot, paymentTerminalTransactions: transactions })).toThrow(/ماكينة تحصيل المحتجز/)
  }
  const reversal = { ...charge, id: 'ref', kind: 'refund' as const, originalTransactionId: charge.id }
  expect(() => assertProjectFinancialHistoryPreserved(snapshot, { ...snapshot, paymentTerminalTransactions: [charge, reversal] })).toThrow(/رد ماكينة تحصيل المحتجز/)
  const corrupt = { ...snapshot, paymentTerminalTransactions: [charge, reversal] }
  expect(() => assertProjectFinancialHistoryPreserved(corrupt, { ...snapshot, paymentTerminalTransactions: [charge] })).toThrow(/رد ماكينة تحصيل المحتجز/)
  useRawDataStore.setState({ paymentTerminalTransactions: [charge], retentionReleases: [{ ...release, paymentEvidence: { ...release.paymentEvidence!, treasuryCode: '1102' } }] })
  expect(() => S().getRemainingRetention(project.id)).toThrow(FinancialDataReviewError)
})

it('لا يقبل ربط حركة ماكينة بتحصيل جديد موثق كتحصيل بلا ماكينة', () => {
  const { project, release } = setup()
  useRawDataStore.setState({ paymentTerminalTransactions: [{ id: 't', idempotencyKey: 't', kind: 'charge', terminalId: 't', branchId: '', userId: 0, documentType: 'project_extract', documentId: `retention:${release.id}`, amountMinor: release.amountMinor, providerReference: 'p', occurredAt: release.createdAt! }] })
  expect(() => S().getRemainingRetention(project.id)).toThrow(FinancialDataReviewError)
})

it.each(['refund', 'void'] as const)('يمنع %s حركة ماكينة المحتجز منفردة دون تعديل دفتر أو مشروع', kind => {
  const terminal = { id: 't1', code: 'TERM-0001', nameAr: 'ماكينة', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'P1', status: 'active' as const }
  S().addPaymentTerminal(terminal)
  const p = S().addProject({ nameAr: 'مشروع ماكينة', clientId: S().customers[0].id, clientName: 'عميل', contractValueMinor: 10000, retentionPercent: 10, startDate: '2026-01-01', notes: '' })
  S().addProjectExtract({ projectId: p.id, date: '2026-11-03', grossMinor: 10000, payment: 'credit', vatPercent: 0, description: 'أعمال' })
  S().releaseRetention(p.id, '1101', { terminalId: 't1', providerReference: 'PAY-123' })
  const before = S(), original = before.paymentTerminalTransactions[0]
  const reversal = { ...original, id: `test-${kind}`, idempotencyKey: `key-${kind}`, kind, documentId: `return-${kind}`, originalTransactionId: original.id, providerReference: 'refund-ref' }
  expect(() => S().recordPaymentTerminalTransaction(reversal)).toThrow(/ماكينة المحتجز/)
  expect(S().paymentTerminalTransactions).toBe(before.paymentTerminalTransactions); expect(S().journal).toBe(before.journal); expect(S().projects).toBe(before.projects)
  expect(S().getRemainingRetention(p.id)).toBe(0)
  // ينطبق المنع على التحصيل القديم أيضاً عند وجود رابط المستند دون لقطة.
  const { paymentEvidence: _evidence, ...legacy } = S().retentionReleases[0]; void _evidence
  useRawDataStore.setState({ retentionReleases: [legacy] })
  expect(() => S().recordPaymentTerminalTransaction(reversal)).toThrow(/ماكينة المحتجز/)
})

it('تعرض تفاصيل المشروع تخصيص التحصيل المدقق وتحجبه بعد فساد دليل المستخلص', () => {
  const { extract } = setup()
  render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
  fireEvent.click(screen.getByTitle('التفاصيل والقيود'))
  const details = document.querySelector('[data-project-retention-allocations]')
  expect(details?.textContent).toContain(extract.extractNumber)
  expect(details?.textContent).toContain(`قيد المستخلص #${extract.journalEntryId}`)
  expect(details?.textContent).toContain('لا يثبت استحقاق الضمان')
  act(() => { useRawDataStore.setState({ projectExtracts: [] }) })
  expect(document.querySelector('[data-project-retention-allocations]')).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('يلزم مراجعة')
})
it('تعرض التفاصيل تحصيلاً قديماً بلا تخمين تخصيص مستخلص', () => {
  setup()
  const { allocationEvidence: _evidence, ...legacy } = S().retentionReleases[0]; void _evidence
  useRawDataStore.setState({ retentionReleases: [legacy] })
  render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
  fireEvent.click(screen.getByTitle('التفاصيل والقيود'))
  expect(document.querySelector('[data-project-retention-allocations]')?.textContent).toContain('تحصيل تاريخي بلا تخصيص محفوظ')
})
it('يحافظ على حركة ماكينة مرتبطة بمستند تحصيل قديم وعلى ردودها دون اختلاق دليل للتسوية', async () => {
  const { assertProjectFinancialHistoryPreserved } = await import('../src/core/projectFinancialHistoryGuard.ts')
  const release = { id: 3, projectId: 9, amountMinor: 100, journalEntryId: 4 }
  const charge = { id: 't1', kind: 'charge', documentType: 'project_extract', documentId: 'retention:3', amountMinor: 100, providerReference: 'r' }
  const refund = { ...charge, id: 'r1', kind: 'refund', originalTransactionId: 't1' }
  const state = { projectExtracts: [], retentionReleases: [release], paymentTerminalTransactions: [charge] }
  expect(() => assertProjectFinancialHistoryPreserved(state, structuredClone(state))).not.toThrow()
  for (const transactions of [[], [{ ...charge, providerReference: 'آخر' }], [charge, charge]]) expect(() => assertProjectFinancialHistoryPreserved(state, { ...state, paymentTerminalTransactions: transactions })).toThrow(/ماكينة تحصيل المحتجز/)
  expect(() => assertProjectFinancialHistoryPreserved(state, { ...state, paymentTerminalTransactions: [charge, refund] })).toThrow(/رد ماكينة تحصيل المحتجز/)
  expect(() => assertProjectFinancialHistoryPreserved({ ...state, paymentTerminalTransactions: [charge, refund] }, state)).toThrow(/رد ماكينة تحصيل المحتجز/)
  const noCharge = { ...state, paymentTerminalTransactions: [] }
  expect(() => assertProjectFinancialHistoryPreserved(noCharge, state)).toThrow(/ماكينة تحصيل المحتجز/)
  expect(() => assertProjectFinancialHistoryPreserved(state, { ...state, paymentTerminalTransactions: [charge, { ...charge, id: 'other', documentId: 'retention:99' }] })).not.toThrow()
})
it.each(['refund', 'void'] as const)('يحجب الربحية والرصيد عند وجود %s لحركة تحصيل تاريخية مرتبطة بالمحتجز', kind => {
  const terminal = { id: 't1', code: 'TERM-0001', nameAr: 'ماكينة', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'P1', status: 'active' as const }
  S().addPaymentTerminal(terminal)
  const project = S().addProject({ nameAr: 'مشروع', clientId: S().customers[0].id, clientName: 'عميل', contractValueMinor: 10000, retentionPercent: 10, startDate: '2026-01-01', notes: '' })
  S().addProjectExtract({ projectId: project.id, date: '2026-11-03', grossMinor: 10000, payment: 'credit', vatPercent: 0, description: 'أعمال' })
  S().releaseRetention(project.id, '1101', { terminalId: 't1', providerReference: 'PAY-123' })
  const { paymentEvidence: _payment, allocationEvidence: _allocation, ...legacy } = S().retentionReleases[0]; void _payment; void _allocation
  const charge = S().paymentTerminalTransactions[0]
  useRawDataStore.setState({ retentionReleases: [legacy] })
  expect(S().getRemainingRetention(project.id)).toBe(0) // لا يعني ذلك إثبات التسوية القديمة
  const reversal = { ...charge, id: `r-${kind}`, idempotencyKey: `r-${kind}`, kind, originalTransactionId: charge.id }
  useRawDataStore.setState({ paymentTerminalTransactions: [charge, reversal] })
  expect(() => S().getRemainingRetention(project.id)).toThrow(FinancialDataReviewError)
  expect(() => S().getProjectProfit(project.id)).toThrow(FinancialDataReviewError)
})
it('يحجب رصيد المحتجز عند شكل إشعار تالف بدلاً من إعطاء خطأ لغة', () => {
  const { project, extract } = setup()
  for (const refunds of [{ broken: true }, [null]]) {
    useRawDataStore.setState({ projectExtracts: [{ ...extract, refunds } as never] })
    expect(() => S().getRemainingRetention(project.id)).toThrow(FinancialDataReviewError)
    expect(() => S().getProjectProfit(project.id)).toThrow(FinancialDataReviewError)
  }
})
