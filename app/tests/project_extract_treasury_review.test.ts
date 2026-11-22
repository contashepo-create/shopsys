import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState()
const S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, countryCode: 'EG', activityId: 'contracting' as const, allowNegativeTreasury: true }
 useAppStore.setState({ ...app, setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, branches: [], activeBranchId: null, currentUserId: null, loggedOut: false, appUsers: [], customers: [], projects: [], projectExtracts: [], projectSurveys: [], projectExtractDrafts: [], projectCloseouts: [], boqItems: [], clientAdvances: [], journal: [], vouchers: [], clientSettlements: [], sales: [], saleReturns: [], changeOrders: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }, { code: '1102', nameAr: 'البنك', kind: 'bank' }] })
 S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'العميل', phone: '', creditLimitMinor: 0, notes: '' })
 S().addProject({ nameAr: 'المشروع', clientId: S().customers[0].id, clientName: 'العميل', contractValueMinor: 50000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
const args = () => ({ projectId: S().projects[0].id, grossMinor: 10000, vatPercent: 0, payment: 'cash' as const, description: 'مستخلص', treasury: '1101' })
function grant(operations: ('receipt' | 'refund')[], maxAmountMinor?: number) {
 useRawDataStore.setState({ currentUserId: 9, appUsers: [{ id: 9, nameAr: 'موظف', roleId: 'accountant', active: true, pinHash: '', treasuryAccess: { grants: [{ treasuryCode: '1101', operations, maxAmountMinor }] } }] })
}
it('يرفض إصدار مستخلص نقدي على حساب غير مسجل أو دون صلاحية أو فوق حد التحصيل دون آثار', () => {
 const before = S()
 expect(() => S().addProjectExtract({ ...args(), treasury: '4101' })).toThrow(/الخزينة/)
 grant([])
 expect(() => S().addProjectExtract(args())).toThrow(/غير مسموح/)
 grant(['receipt'], 9999)
 expect(() => S().addProjectExtract(args())).toThrow(/حد المستخدم/)
 expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts)
 grant(['receipt'], 10000)
 const extract = S().addProjectExtract(args())
 expect(S().journal.find(e => e.id === extract.journalEntryId)?.lines.some(l => l.accountCode === '1101' && l.debit === 10000)).toBe(true)
})
it('يطلب صلاحية رد الأصل النقدي وصلاحية تحصيل البديل بصورة مستقلة قبل تعديل المستخلص', () => {
 const extract = S().addProjectExtract(args())
 const edit = { extractId: extract.id, grossMinor: 8000, payment: 'cash' as const, treasury: '1101', vatPercent: 0, description: 'تعديل', reason: 'تصحيح' }
 grant(['receipt'])
 const before = S()
 expect(() => S().editProjectExtract(edit)).toThrow(/غير مسموح/)
 expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts)
 grant(['refund'])
 expect(() => S().editProjectExtract(edit)).toThrow(/غير مسموح/)
 expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts)
 grant(['refund', 'receipt'])
 const revised = S().editProjectExtract(edit)
 expect(S().journal.find(e => e.id === revised.editReversalEntryId)?.lines.some(l => l.accountCode === '1101' && l.credit === 10000)).toBe(true)
 expect(S().journal.find(e => e.id === revised.journalEntryId)?.lines.some(l => l.accountCode === '1101' && l.debit === 8000)).toBe(true)
})
it('لا يقبل التعديل على حساب بديل ليس خزينة حتى لو كان الأصل آجلاً', () => {
 const extract = S().addProjectExtract({ ...args(), payment: 'credit' })
 const before = S()
 expect(() => S().editProjectExtract({ extractId: extract.id, grossMinor: 8000, payment: 'cash', treasury: '4101', vatPercent: 0, description: 'تعديل', reason: 'تصحيح' })).toThrow(/الخزينة/)
 expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts)
})

it('يرفض خزينة فرع آخر عند إصدار مستخلص ويترك اليومية كما هي', () => {
 const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
 useRawDataStore.setState({ branches, activeBranchId: 1, treasuries: [{ code: '1101', nameAr: 'الرئيسي', kind: 'cash', branchId: 1 }, { code: '1102', nameAr: 'الثاني', kind: 'bank', branchId: 2 }] })
 const before = S()
 expect(() => S().addProjectExtract({ ...args(), treasury: '1102' })).toThrow(/الفرع|الخزينة/)
 expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts)
})

it('يستخدم خزينة الفرع المعيّن للمستخدم عند عدم تمرير حساب حتى لو اختلف الفرع النشط العام', () => {
 const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
 useRawDataStore.setState({ branches, activeBranchId: 1, customers: S().customers.map(c => ({ ...c, branchId: 2 })), projects: S().projects.map(p => ({ ...p, branchId: 2 })), treasuries: [{ code: '1101', nameAr: 'الرئيسي', kind: 'cash', branchId: 1 }, { code: '1102', nameAr: 'الثاني', kind: 'bank', branchId: 2 }], currentUserId: 9, appUsers: [{ id: 9, nameAr: 'محاسب', roleId: 'accountant', branchId: 2, active: true, pinHash: '', treasuryAccess: { grants: [{ treasuryCode: '1102', operations: ['receipt', 'refund'] }] } }] })
 const { treasury: _treasury, ...input } = args()
 const ex = S().addProjectExtract(input)
 expect(S().journal.find(row => row.id === ex.journalEntryId)?.lines.find(line => line.debit === 10000)?.accountCode).toBe('1102')
})

it('يرفض ماكينة فرع آخر أو ماكينة مكررة عند إصدار مستخلص ولو تطابق حساب تسويتها', () => {
 const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
 const terminal = { id: 't', code: 'T', nameAr: 'ماكينة', providerName: 'مزود', branchId: '2', settlementAccountCode: '1101', terminalId: 'T1', status: 'active' as const }
 useRawDataStore.setState({ branches, activeBranchId: 1, paymentTerminals: [terminal], paymentTerminalTransactions: [] })
 const input = { ...args(), terminalPayment: { terminalId: 't', providerReference: 'R1' } }, before = S()
 expect(() => S().addProjectExtract(input)).toThrow(/الفرع/)
 expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts); expect(S().paymentTerminalTransactions).toBe(before.paymentTerminalTransactions)
 useRawDataStore.setState({ paymentTerminals: [{ ...terminal, branchId: '1' }, terminal] })
 expect(() => S().addProjectExtract(input)).toThrow(/مكرر|فريد/)
 expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts)
})

it('يرفض تعديل مستخلص مؤرخ مستقبلاً أو لا يطابق تاريخ قيده دون قيد عكسي', () => {
 const ex = S().addProjectExtract(args())
 const input = { extractId: ex.id, grossMinor: 8000, payment: 'cash' as const, treasury: '1101', vatPercent: 0, description: 'تعديل', reason: 'تصحيح' }
 const state = S()
 useRawDataStore.setState({ journal: state.journal.map(j => j.id === ex.journalEntryId ? { ...j, date: '2026-11-04' } : j) })
 const before = S(); expect(() => S().editProjectExtract(input)).toThrow(/مراجعة/); expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts)
 useRawDataStore.setState({ journal: state.journal.map(j => j.id === ex.journalEntryId ? { ...j, date: '2026-11-06' } : j), projectExtracts: state.projectExtracts.map(e => ({ ...e, date: '2026-11-06', createdAt: '2026-11-06T12:00:00Z' })) })
 const future = S(); expect(() => S().editProjectExtract(input)).toThrow(/مراجعة|المستقبل/); expect(S().journal).toBe(future.journal); expect(S().projectExtracts).toBe(future.projectExtracts)
})

it('يسمح بماكينة الفرع الصحيحة ويرفض تكرار المرجع بعد إزالة المسافات دون أثر جديد', () => {
 const branch = { id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }
 const terminal = { id: 't', code: 'T', nameAr: 'ماكينة', providerName: 'مزود', branchId: '1', settlementAccountCode: '1101', terminalId: 'T1', status: 'active' as const }
 useRawDataStore.setState({ branches: [branch], activeBranchId: 1, paymentTerminals: [terminal], paymentTerminalTransactions: [] })
 const input = { ...args(), terminalPayment: { terminalId: 't', providerReference: ' ref ' } }
 const ex = S().addProjectExtract(input)
 expect(S().paymentTerminalTransactions).toHaveLength(1)
 expect(S().paymentTerminalTransactions[0]).toMatchObject({ documentType: 'project_extract', documentId: String(ex.id), branchId: '1', amountMinor: 10000, providerReference: 'ref' })
 const before = S(); expect(() => S().addProjectExtract(input)).toThrow(/مستخدم مسبقاً/)
 expect(S().journal).toBe(before.journal); expect(S().projectExtracts).toBe(before.projectExtracts); expect(S().paymentTerminalTransactions).toBe(before.paymentTerminalTransactions)
})

it('يستعمل فرع المستخدم أيضاً في حساب القيد البديل عند تعديل المستخلص', () => {
 const branches = [{ id: 1, nameAr: 'الرئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'الثاني', isMain: false, active: true, warehouseId: 2, treasuryCode: '1102' }]
 useRawDataStore.setState({ branches, activeBranchId: 1, customers: S().customers.map(c => ({ ...c, branchId: 2 })), projects: S().projects.map(p => ({ ...p, branchId: 2 })), treasuries: [{ code: '1101', nameAr: 'الرئيسي', kind: 'cash', branchId: 1 }, { code: '1102', nameAr: 'الثاني', kind: 'bank', branchId: 2 }], currentUserId: 9, appUsers: [{ id: 9, nameAr: 'محاسب', roleId: 'accountant', branchId: 2, active: true, pinHash: '', treasuryAccess: { grants: [{ treasuryCode: '1102', operations: ['receipt', 'refund'] }] } }] })
 const ex = S().addProjectExtract({ ...args(), treasury: '1102' })
 const edited = S().editProjectExtract({ extractId: ex.id, grossMinor: 8000, vatPercent: 0, payment: 'cash', description: 'تعديل', reason: 'تصحيح' })
 expect(S().journal.find(row => row.id === edited.journalEntryId)?.lines.some(line => line.accountCode === '1102' && line.debit === 8000)).toBe(true)
})
