import { seedLegacyProjectCredit } from './helpers/legacyProjectCredit.ts'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [], approvals: { ...app.approvals, enabled: false } })
 useRawDataStore.setState({ ...initial, currentUserId: null, activeBranchId: null, branches: [], customers: [], employees: [], projects: [], boqItems: [], projectExtracts: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], clientAdvances: [], journal: [], changeOrders: [], paymentTerminals: [], paymentTerminalTransactions: [], docApprovals: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
 const p = S().addProject({ nameAr: 'مشروع', clientName: 'عميل', clientId: S().customers[0].id, contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
 S().addBoqItem({ projectId: p.id, code: '1', descriptionAr: 'عمل', unit: 'م', qty: 100, unitPriceMinor: 100, estCostMinor: 0 })
})
afterEach(() => { useRawDataStore.setState(initial); useAppStore.setState(app); vi.useRealTimers() })
const extract = (date?: string, extra: { advanceRecoveryMinor?: number; terminalPayment?: { terminalId: string; providerReference: string } } = {}) => S().addProjectExtract({ projectId: S().projects[0].id, grossMinor: 1000, payment: 'credit', description: 'أعمال', vatPercent: 15, ...(date === undefined ? {} : { date }), ...extra })
it('يرحّل الفاتورة والقيد بتاريخ سابق صحيح مع وقت إنشاء فعلي وضريبة', () => {
 const ex = extract('2026-11-03')
 expect(ex.date).toBe('2026-11-03'); expect(ex.createdAt?.slice(0, 10)).toBe('2026-11-05')
 expect(ex.totals.vatMinor).toBe(150); expect(S().journal[0]).toMatchObject({ date: '2026-11-03', sourceId: ex.id, sourceType: 'project_extract' })
 expect(S().journal[0].createdAt.slice(0, 10)).toBe('2026-11-05')
 expect(S().journal[0].lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '2102', credit: 150 })]))
 expect(() => S().editProjectExtract({ extractId: ex.id, grossMinor: 900, description: 'تصحيح', payment: 'credit', vatPercent: 15, reason: 'تصحيح' })).toThrow(/مؤرخ قبل/)
 expect(S().projectExtracts).toHaveLength(1); expect(S().journal).toHaveLength(1)
})
it('المستدعي القديم يحصل على يوم التسجيل اليوم دون تجاوز الصيغة', () => {
 const ex = extract(); expect(ex.date).toBe('2026-11-05'); expect(ex.createdAt?.slice(0, 10)).toBe('2026-11-05')
})
it.each(['', '2026-11-06', '2026-02-30', '2026-11-04T12:00:00Z'])('يرفض %s قبل القيد أو طلب الاعتماد', date => {
 useRawDataStore.setState({ approvalFlows: [{ id: 1, action: 'project_extract', active: true, steps: [{ order: 1, roleAr: 'مدير', employeeId: null }] }], approvalRequests: [{ id: 1, action: 'project_extract', subject: 'اختبار', refId: S().projects[0].id, createdAt: new Date().toISOString(), status: 'approved', currentStep: 1, consumedAt: null, decisions: [] }] })
 expect(() => extract(date)).toThrow(/تاريخ الفاتورة/)
 expect(S().projectExtracts).toHaveLength(0); expect(S().journal).toHaveLength(0); expect(S().approvalRequests[0].consumedAt).toBeNull()
})
it('يرفض السنة المالية المقفلة دون مستخلص أو قيد', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'المقفلة', startDate: '2026-01-01', endDate: '2026-11-04', status: 'closed' }] })
 expect(() => extract('2026-11-04')).toThrow(/مقفلة/); expect(S().journal).toHaveLength(0)
})
it('لا يقدم مستخلصاً جديداً على سابقه أو على الدفعة المستردة', () => {
 extract('2026-11-04'); const before = S()
 expect(() => extract('2026-11-03')).toThrow(/تسلسل الأعمال/); expect(S().journal).toBe(before.journal)
 S().receiveClientAdvance({ projectId: S().projects[0].id, amountMinor: 1000, treasury: '1101', date: '2026-11-05' })
 const after = S()
 expect(() => extract('2026-11-04', { advanceRecoveryMinor: 500 })).toThrow(/تسلسل الاسترداد/)
 expect(S().journal).toBe(after.journal); expect(S().clientAdvances[0].recoveredMinor).toBe(0)
})
it('لا ينسب سقف أمر تغيير لاحق أو مجهول الاعتماد لفاتورة سابقة', () => {
 const order = S().addChangeOrder({ projectId: S().projects[0].id, titleAr: 'زيادة', amountMinor: 100 })
 S().setChangeOrderStatus(order.id, 'approved')
 expect(() => extract('2026-11-04')).toThrow(/اعتماد أمر تغيير/)
 expect(S().journal).toHaveLength(0)
 useRawDataStore.setState({ changeOrders: [{ ...S().changeOrders[0], approvedAt: null }] })
 expect(() => extract('2026-11-04')).toThrow(/اعتماد أمر تغيير/)
 expect(S().projectExtracts).toHaveLength(0)
})
it('المستخلص المستقل لا يتقيد بتاريخ قياس الحصر، بينما مسودته المستمدة منه تتقيد به', () => {
 const p = S().projects[0], b = S().boqItems[0]
 S().saveProjectSurvey({ projectId: p.id, lines: [{ boqItemId: b.id, cumulativeQty: 10 }], expectedRevision: 0, reason: '', isFinal: false, measurementDate: '2026-11-04' })
 const draft = S().prepareProjectExtractDraft(p.id, 1)
 const args = { projectId: p.id, payment: 'cash' as const, description: 'أعمال', vatPercent: 0, extractQtyLines: draft.lines }
 expect(() => S().addProjectExtract({ ...args, sourceSurveyDraft: true, date: '2026-11-03' })).toThrow(/قياس/)
 const ex = S().addProjectExtract({ ...args, date: '2026-11-03' })
 expect(ex.date).toBe('2026-11-03'); expect(S().projectSurveys[0].revisions).toHaveLength(1)
})
it('لا يغيّر تاريخ تحصيل ماكينة من وقت تسجيلها', () => {
 expect(() => extract('2026-11-04', { terminalPayment: { terminalId: 't', providerReference: 'ref' } })).toThrow(/الماكينة/)
 expect(S().projectExtracts).toHaveLength(0); expect(S().paymentTerminalTransactions).toHaveLength(0)
})
it('المسودة المستمدة من حصر قديم بلا تاريخ قياس لا تثبت تاريخ إصدار سابق', () => {
 const p = S().projects[0], b = S().boqItems[0]
 S().saveProjectSurvey({ projectId: p.id, lines: [{ boqItemId: b.id, cumulativeQty: 10 }], expectedRevision: 0, reason: '', isFinal: false })
 const draft = S().prepareProjectExtractDraft(p.id, 1)
 expect(() => S().addProjectExtract({ projectId: p.id, payment: 'cash', description: '', vatPercent: 0, extractQtyLines: draft.lines, sourceSurveyDraft: true, date: '2026-11-04' })).toThrow(/تاريخ قياس مثبت/)
 expect(S().journal).toHaveLength(0)
})
it('مرتجع المستخلص لا يرحّل في فترة مقفلة ويتحقق من تسلسل تاريخ الإشعار', () => {
 const item = S().boqItems[0]
 const ex = S().addProjectExtract({ projectId: S().projects[0].id, date: '2026-11-03', payment: 'credit', description: 'أعمال', vatPercent: 0, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 10 }] })
 const args = { extractId: ex.id, quantities: [{ boqItemId: item.id, qty: 1 }], amountMinor: 100, mode: 'customer_credit' as const, reason: 'تسوية' }
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-11-05', endDate: '2026-12-31', status: 'closed' }] })
 const before = S()
 expect(() => S().refundProjectExtract(args)).toThrow(/مقفلة/)
 expect(S().projectExtracts).toBe(before.projectExtracts); expect(S().journal).toBe(before.journal)
 useAppStore.setState({ fiscalYears: [] })
 const updated = S().refundProjectExtract(args)
 const refund = updated.refunds!.at(-1)!
 expect(refund.date).toBe('2026-11-05')
 expect(S().journal.find(row => row.id === refund.journalEntryId)?.date).toBe(refund.date)
 vi.setSystemTime(new Date(2026, 10, 4, 12))
 const after = S()
 expect(() => S().refundProjectExtract(args)).toThrow(/تسلسل المرتجعات/)
 expect(S().journal).toBe(after.journal); expect(S().projectExtracts).toBe(after.projectExtracts)
})
it('تحصيل العميل لا يرحّل في سنة مقفلة أو على خزينة غير متاحة', () => {
 const ex = extract('2026-11-03'), customerId = S().projects[0].clientId!
 const args = { customerId, amountMinor: 100, treasury: '1101', specificDocKey: `extract:${ex.id}` }
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'المقفلة', startDate: '2026-11-05', endDate: '2026-12-31', status: 'closed' }] })
 const before = S()
 expect(() => S().receiveClientPayment(args)).toThrow(/مقفلة/)
 expect(S().journal).toBe(before.journal); expect(S().clientSettlements).toBe(before.clientSettlements)
 useAppStore.setState({ fiscalYears: [] })
 expect(() => S().receiveClientPayment({ ...args, treasury: 'غير موجودة' })).toThrow(/خزينة|الخزينة|حساب/)
 const receipt = S().receiveClientPayment(args)
 const doc = S().clientSettlements.find(row => row.settlementNumber === receipt.settlementNumber)!
 expect(doc.date.slice(0, 10)).toBe('2026-11-05'); expect(S().journal.find(row => row.id === doc.journalEntryId)?.date).toBe('2026-11-05')
})

it('تحصيل العميل يرفض ماكينة فرع آخر والمرجع المكرر بعد إزالة المسافات دون أثر جزئي', () => {
 const ex = extract(), customerId = S().projects[0].clientId!
 const terminal = { id: 'terminal', code: 'TERM-1', nameAr: 'ماكينة', providerName: 'مزود', branchId: '2', settlementAccountCode: '1101', terminalId: 'T1', status: 'active' as const }
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 useRawDataStore.setState({ branches, activeBranchId: 1, paymentTerminals: [terminal], clientSettlements: [] })
 const args = { customerId, amountMinor: 100, treasury: '1101', specificDocKey: `extract:${ex.id}`, terminalPayment: { terminalId: terminal.id, providerReference: 'ref-1' } }
 const before = S()
 expect(() => S().receiveClientPayment(args)).toThrow(/الفرع/)
 expect(S().journal).toBe(before.journal); expect(S().clientSettlements).toBe(before.clientSettlements); expect(S().paymentTerminalTransactions).toBe(before.paymentTerminalTransactions)
 useRawDataStore.setState({ paymentTerminals: [{ ...terminal, branchId: '1' }] })
 S().receiveClientPayment(args)
 const saved = S()
 expect(() => S().receiveClientPayment({ ...args, terminalPayment: { ...args.terminalPayment, providerReference: '  ref-1  ' } })).toThrow(/مستخدم مسبقاً/)
 expect(S().journal).toBe(saved.journal); expect(S().clientSettlements).toBe(saved.clientSettlements); expect(S().paymentTerminalTransactions).toBe(saved.paymentTerminalTransactions)
})

it('مرتجع المستخلص النقدي يرفض خزينة وهمية وطريقة رد غير صالحة بلا تغيير المستخلص أو الدفتر', () => {
 const ex = extract(), before = S()
 const args = { extractId: ex.id, quantities: [], amountMinor: 100, mode: 'cash' as const, treasury: '4107', reason: 'تسوية' }
 expect(() => S().refundProjectExtract(args)).toThrow(/الخزينة|البنك/)
 expect(() => S().refundProjectExtract({ ...args, mode: 'invalid' as never })).toThrow(/طريقة رد/)
 expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts)
})
it('مرتجع الماكينة لا يستعمل عملية فرع آخر أو أصلاً مكرراً أو مرجعاً مكرراً بعد إزالة المسافات', () => {
 const item = S().boqItems[0]
 const ex = S().addProjectExtract({ projectId: S().projects[0].id, payment: 'credit', description: 'أعمال', vatPercent: 0, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 10 }] })
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }]
 const terminal = { id: 't', code: 'TERM-1', nameAr: 'ماكينة', providerName: 'مزود', branchId: '2', settlementAccountCode: '1101', terminalId: 'T1', status: 'active' as const }
 const charge = { id: 'charge', idempotencyKey: 'charge', kind: 'charge' as const, terminalId: 't', branchId: '2', userId: 0, documentType: 'project_extract' as const, documentId: String(ex.id), amountMinor: 1000, providerReference: 'original', occurredAt: '2026-11-05T10:00:00Z' }
 useRawDataStore.setState({ branches, activeBranchId: 1, paymentTerminals: [terminal], paymentTerminalTransactions: [charge] })
 const args = { extractId: ex.id, quantities: [{ boqItemId: item.id, qty: 1 }], amountMinor: 100, mode: 'cash' as const, treasury: '1101', reason: 'رد', terminalRefund: { originalTransactionId: 'charge', providerReference: ' REF ' } }
 const before = S()
 expect(() => S().refundProjectExtract(args)).toThrow(/الفرع/)
 expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts); expect(S().paymentTerminalTransactions).toBe(before.paymentTerminalTransactions)
 useRawDataStore.setState({ paymentTerminals: [{ ...terminal, branchId: '1' }], paymentTerminalTransactions: [{ ...charge, branchId: '1' }, { ...charge, branchId: '1' }] })
 expect(() => S().refundProjectExtract(args)).toThrow(/غير فريد/)
 const existingRefund = { ...charge, id: 'refund', idempotencyKey: 'refund', kind: 'refund' as const, branchId: '1', originalTransactionId: 'charge', providerReference: 'REF' }
 useRawDataStore.setState({ paymentTerminalTransactions: [{ ...charge, branchId: '1' }, existingRefund] })
 const after = S()
 expect(() => S().refundProjectExtract(args)).toThrow(/مستخدم مسبقاً/)
 expect(S().journal).toBe(after.journal); expect(S().projectExtracts).toBe(after.projectExtracts); expect(S().paymentTerminalTransactions).toBe(after.paymentTerminalTransactions)
})

it('إشعار كمي لمستخلص بلا محتجز أو دفعة يحفظ دليل البنود ويطابق قيده وضريبته', () => {
 const p = S().projects[0], item = S().boqItems[0]
 const ex = S().addProjectExtract({ projectId: p.id, payment: 'credit', description: 'أعمال', vatPercent: 15, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 20 }] })
 const before = S()
 expect(() => S().refundProjectExtract({ extractId: ex.id, quantities: [{ boqItemId: item.id, qty: 5 }], amountMinor: 1, mode: 'customer_credit', reason: 'رفض بند' })).toThrow(/تغيرت قيمة/)
 expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts)
 const updated = S().refundProjectExtract({ extractId: ex.id, quantities: [{ boqItemId: item.id, qty: 5 }], amountMinor: 575, mode: 'customer_credit', reason: 'رفض بند' })
 expect(updated.refunds?.[0]).toMatchObject({ grossMinor: 500, taxShareMinor: 75, retentionMinor: 0, amountMinor: 575, quantities: [{ boqItemId: item.id, qty: 5 }] })
 expect(S().journal.find(row => row.id === updated.refunds![0].journalEntryId)?.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '4102', debit: 500 }), expect.objectContaining({ accountCode: '2102', debit: 75 }), expect.objectContaining({ accountCode: '1104', credit: 575 })]))
 expect(S().getCustomerBalance(p.clientId!)).toBe(1725)
 expect(() => S().refundProjectExtract({ extractId: ex.id, amountMinor: 100, mode: 'customer_credit', reason: 'بلا كمية' } as never)).toThrow(/اختر البنود/)
 const second = S().refundProjectExtract({ extractId: ex.id, quantities: [{ boqItemId: item.id, qty: 15 }], amountMinor: 1725, mode: 'customer_credit', reason: 'باقي البند' })
 expect(second.refundedMinor).toBe(2300); expect(S().getCustomerBalance(p.clientId!)).toBe(0)
})

it('الإشعار الكمي يرفض المحتجز والدفعة أو دليلاً قديماً ويكشف تعديل بيانات الكمية لاحقاً', () => {
 const p = S().projects[0], item = S().boqItems[0]
 const ex = S().addProjectExtract({ projectId: p.id, payment: 'credit', description: 'أعمال', vatPercent: 0, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 20 }] })
 const args = { extractId: ex.id, quantities: [{ boqItemId: item.id, qty: 5 }], amountMinor: 500, mode: 'customer_credit' as const, reason: 'رفض' }
 const originalExtracts = S().projectExtracts
 useRawDataStore.setState({ projectExtracts: originalExtracts.map(row => ({ ...row, advanceRecoveryMinor: 100 })) })
 expect(() => S().refundProjectExtract(args)).toThrow()
 useRawDataStore.setState({ projectExtracts: originalExtracts })
 const result = S().refundProjectExtract(args)
 expect(result.quantityCreditVersion).toBe(1)
 const saved = S().projectExtracts
 for (const bad of [
  { ...result, refunds: result.refunds!.map(refund => ({ ...refund, quantities: [{ boqItemId: item.id, qty: 6 }] })) },
  { ...result, refunds: result.refunds!.map(refund => ({ ...refund, quantities: undefined, grossMinor: undefined, retentionMinor: undefined })) },
 ]) {
  useRawDataStore.setState({ projectExtracts: [bad] })
  expect(() => S().assertProjectExtractRefunds(p.id)).toThrow(/مراجعة/)
 }
 useRawDataStore.setState({ projectExtracts: saved })
 expect(() => S().assertProjectExtractRefunds(p.id)).not.toThrow()
})
it('الرد الكمي لا يُخمن كميات إشعار مالي تاريخي', () => {
 const p = S().projects[0], item = S().boqItems[0]
 const ex = S().addProjectExtract({ projectId: p.id, payment: 'credit', description: 'أعمال', vatPercent: 0, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 20 }] })
 seedLegacyProjectCredit({ extractId: ex.id, amountMinor: 100, mode: 'customer_credit', reason: 'إشعار قديم' })
 const before = S()
 expect(() => S().refundProjectExtract({ extractId: ex.id, quantities: [{ boqItemId: item.id, qty: 1 }], amountMinor: 100, mode: 'customer_credit', reason: 'إشعار كمي' })).toThrow(/دليل كميات/)
 expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts)
})

it('الإشعار الكمي يعكس محتجز شريحة الأعمال بقيد متوازن', () => {
 const p = S().projects[0], item = S().boqItems[0]
 useRawDataStore.setState({ projects: S().projects.map(row => ({ ...row, retentionPercent: 10 })) })
 const ex = S().addProjectExtract({ projectId: p.id, payment: 'credit', description: 'أعمال', vatPercent: 0, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 20 }] })
 const result = S().refundProjectExtract({ extractId: ex.id, quantities: [{ boqItemId: item.id, qty: 5 }], amountMinor: 450, mode: 'customer_credit', reason: 'رفض' })
 expect(result.quantityCreditVersion).toBe(2)
 expect(result.refunds?.[0]).toMatchObject({ grossMinor: 500, retentionMinor: 50, amountMinor: 450 })
 expect(S().journal.at(-1)?.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '4102', debit: 500 }), expect.objectContaining({ accountCode: '1105', credit: 50 }), expect.objectContaining({ accountCode: '1104', credit: 450 })]))
 expect(S().getRemainingRetention(p.id)).toBe(150)
 expect(() => S().assertProjectExtractRefunds(p.id)).not.toThrow()
})

it('الإشعار يحتسب سعر وكمية إصدار المستخلص لا بطاقة البند المعدلة لاحقاً', () => {
 const p = S().projects[0], item = S().boqItems[0]
 const ex = S().addProjectExtract({ projectId: p.id, payment: 'credit', description: 'أعمال', vatPercent: 0, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 20 }] })
 useRawDataStore.setState({ boqItems: S().boqItems.map(row => ({ ...row, qty: row.qty + 10, unitPriceMinor: row.unitPriceMinor + 100 })) })
 const result = S().refundProjectExtract({ extractId: ex.id, quantities: [{ boqItemId: item.id, qty: 5 }], amountMinor: 500, mode: 'customer_credit', reason: 'رفض' })
 expect(result.refunds?.[0].grossMinor).toBe(500)
 expect(() => S().assertProjectExtractRefunds(p.id)).not.toThrow()
})

it('المستودع يرفض أول إشعار دون كميات بما فيها القائمة الفارغة دون أثر', () => {
 const p = S().projects[0], item = S().boqItems[0]
 const ex = S().addProjectExtract({ projectId: p.id, payment: 'credit', description: 'أعمال', vatPercent: 0, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 20 }] })
 const before = S(), args = { extractId: ex.id, amountMinor: 100, mode: 'customer_credit' as const, reason: 'رد' }
 expect(() => S().refundProjectExtract(args as never)).toThrow(/البنود والكميات/)
 expect(() => S().refundProjectExtract({ ...args, quantities: [] })).toThrow(/البنود والكميات/)
 expect(S().projectExtracts).toBe(before.projectExtracts); expect(S().journal).toBe(before.journal)
})

it('الإشعار الكمي المثبت يمنع إعادة بناء المستخلص دون تغيير التاريخ', () => {
 const p = S().projects[0], item = S().boqItems[0]
 const ex = S().addProjectExtract({ projectId: p.id, payment: 'credit', description: 'أعمال', vatPercent: 0, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 20 }] })
 S().refundProjectExtract({ extractId: ex.id, quantities: [{ boqItemId: item.id, qty: 1 }], amountMinor: 100, mode: 'customer_credit', reason: 'رد' })
 const before = S()
 expect(() => S().editProjectExtract({ extractId: ex.id, extractQtyLines: [{ boqItemId: item.id, cumulativeQty: 25 }], vatPercent: 0, payment: 'credit', description: 'تعديل', reason: 'تصحيح' })).toThrow(/إشعار دائن/)
 expect(S().projectExtracts).toBe(before.projectExtracts); expect(S().journal).toBe(before.journal)
})
