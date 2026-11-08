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
it('يرفض نسبة المستخلص لقياس أحدث أو غير موثق ويقبل بعد يوم القياس', () => {
 const p = S().projects[0], b = S().boqItems[0]
 S().saveProjectSurvey({ projectId: p.id, lines: [{ boqItemId: b.id, cumulativeQty: 10 }], expectedRevision: 0, reason: '', isFinal: false, measurementDate: '2026-11-04' })
 const args = { projectId: p.id, payment: 'cash' as const, description: 'أعمال', vatPercent: 0, extractQtyLines: [{ boqItemId: b.id, cumulativeQty: 10 }] }
 expect(() => S().addProjectExtract({ ...args, date: '2026-11-03' })).toThrow(/قياس الحصر/)
 const ex = S().addProjectExtract({ ...args, date: '2026-11-04' })
 expect(ex.date).toBe('2026-11-04'); expect(S().journal[0].date).toBe('2026-11-04')
 expect(S().projectSurveys[0].revisions[1].measurementDate).toBeUndefined()
})
it('لا يغيّر تاريخ تحصيل ماكينة من وقت تسجيلها', () => {
 expect(() => extract('2026-11-04', { terminalPayment: { terminalId: 't', providerReference: 'ref' } })).toThrow(/الماكينة/)
 expect(S().projectExtracts).toHaveLength(0); expect(S().paymentTerminalTransactions).toHaveLength(0)
})
it('السجل اليدوي القديم بلا تاريخ قياس لا يثبت جواز تاريخ إصدار سابق', () => {
 const p = S().projects[0], b = S().boqItems[0]
 S().saveProjectSurvey({ projectId: p.id, lines: [{ boqItemId: b.id, cumulativeQty: 10 }], expectedRevision: 0, reason: '', isFinal: false, measurementDate: '2026-11-04' })
 useRawDataStore.setState({ projectSurveys: S().projectSurveys.map(s => ({ ...s, revisions: s.revisions.map(r => ({ ...r, measurementDate: undefined })) })) })
 expect(() => extract('2026-11-04')).toThrow(/تاريخ قياس مثبت/)
 expect(S().journal).toHaveLength(0)
})
