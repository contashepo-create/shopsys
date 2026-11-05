import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, activeBranchContext: null, approvals: { ...app.approvals, enabled: false }, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, currentUserId: null, customers: [], employees: [], vouchers: [], journal: [] }) })
function fixture() {
 const s = useDataStore.getState()
 s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'العميل', phone: '', creditLimitMinor: 0, notes: '' })
 s.addEmployee({ nameAr: 'المحصّل', phone: '', roleId: 'cashier', salaryMinor: 0, active: true } as never)
 const state = useDataStore.getState()
 return { s, customer: state.customers[0], collector: state.employees[0] }
}
it('يحفظ المحصّل صراحة في سند القبض والقيد لا في طرف العميل', () => {
 const { s, customer, collector } = fixture()
 const voucher = s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 1000, description: 'تحصيل', partyKind: 'customer', partyId: customer.id, receiptCollectorEmployeeId: collector.id })
 expect(voucher.receiptCollectorEmployeeId).toBe(collector.id)
 expect(voucher.partyKind).toBe('customer')
 expect(useRawDataStore.getState().journal.find(entry => entry.id === voucher.journalEntryId)?.receiptCollectorId).toBe(collector.id)
})
it('يرفض محصلاً مكرراً أو معطلاً أو على سند صرف بلا كتابة', () => {
 const { s, collector } = fixture()
 const args = { kind: 'receipt' as const, treasury: '1101' as const, counterAccountCode: '4110', amountMinor: 1000, description: 'تحصيل', receiptCollectorEmployeeId: collector.id }
 expect(() => s.postVoucher({ ...args, kind: 'payment' })).toThrow(/محصّل/)
 useRawDataStore.setState(state => ({ employees: state.employees.map(employee => ({ ...employee, active: false })) }))
 expect(() => s.postVoucher(args)).toThrow(/محصّل/)
 useRawDataStore.setState(state => ({ employees: [{ ...state.employees[0], active: true }, collector] }))
 expect(() => s.postVoucher(args)).toThrow(/محصّل/)
 expect(useRawDataStore.getState().journal).toHaveLength(0)
})
it('يرفض عكس سند عندما يتعارض إثبات المحصّل مع القيد', () => {
 const { s, collector } = fixture()
 const voucher = s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4110', amountMinor: 1000, description: 'تحصيل', receiptCollectorEmployeeId: collector.id })
 useRawDataStore.setState(state => ({ vouchers: state.vouchers.map(row => row.id === voucher.id ? { ...row, receiptCollectorEmployeeId: null } : row) }))
 expect(() => s.reverseVoucher(voucher.id, 'خطأ')).toThrow(/محصّل/)
 expect(useRawDataStore.getState().journal).toHaveLength(1)
})
it('دفتر القبض يسجل السند في يومه والعكس في يومه ولا يخلط بين المحصل والطرف', async () => {
 const { receiptCollectorReport } = await import('../src/core/receiptCollectorReport.ts')
 const { s, collector, customer } = fixture()
 const voucher = s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 1000, description: 'تحصيل', partyKind: 'customer', partyId: customer.id, date: '2000-01-01', receiptCollectorEmployeeId: collector.id })
 s.reverseVoucher(voucher.id, 'تصحيح')
 const state = useRawDataStore.getState()
 const old = receiptCollectorReport(state.vouchers, state.journal, state.employees, { from: '2000-01-01', to: '2000-01-01' })
 expect(old.rows).toHaveLength(1)
 expect(old.rows[0]).toMatchObject({ kind: 'receipt', collectorId: collector.id, amountMinor: 1000, counterAccountCode: '1104' })
 const current = receiptCollectorReport(state.vouchers, state.journal, state.employees, { from: state.journal.at(-1)!.date, to: state.journal.at(-1)!.date })
 expect(current.rows).toHaveLength(1)
 expect(current.rows[0]).toMatchObject({ kind: 'reversal', collectorId: collector.id, amountMinor: 1000 })
})
it('لا يدرج القبض عند تلف العكس أو اختلاف المحصّل ويفصح عن الاستبعاد', async () => {
 const { receiptCollectorReport } = await import('../src/core/receiptCollectorReport.ts')
 const { s, collector } = fixture()
 const voucher = s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4110', amountMinor: 1000, description: 'تحصيل', receiptCollectorEmployeeId: collector.id })
 const state = useRawDataStore.getState()
 const result = receiptCollectorReport(state.vouchers.map(row => ({ ...row, receiptCollectorEmployeeId: null })), state.journal, state.employees, { from: '2000-01-01', to: '2100-01-01' })
 expect(result.rows).toHaveLength(0)
 expect(result.warnings.join(' ')).toContain(voucher.voucherNumber)
})
it('عكس القيد المباشر يرفض تضارب المحصّل أيضاً', () => {
 const { s, collector } = fixture()
 const voucher = s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4110', amountMinor: 1000, description: 'تحصيل', receiptCollectorEmployeeId: collector.id })
 useRawDataStore.setState(state => ({ vouchers: state.vouchers.map(row => row.id === voucher.id ? { ...row, receiptCollectorEmployeeId: null } : row) }))
 expect(() => s.reverseEntry(voucher.journalEntryId, 'خطأ')).toThrow(/محصّل/)
 expect(useRawDataStore.getState().journal).toHaveLength(1)
})
it('لا يدرج الدفتر عكساً لا يطابق الأصل ويترك السند التاريخي بلا إسناد', async () => {
 const { receiptCollectorReport } = await import('../src/core/receiptCollectorReport.ts')
 const { s } = fixture()
 const voucher = s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4110', amountMinor: 1000, description: 'تحصيل' })
 const legacy = useRawDataStore.getState()
 const legacyVoucher = legacy.vouchers.map(row => { const { receiptCollectorEmployeeId: ignored, ...rest } = row; void ignored; return rest })
 const legacyJournal = legacy.journal.map(entry => { const { receiptCollectorId: ignored, ...rest } = entry; void ignored; return rest })
 const period = { from: '2000-01-01', to: '2100-01-01' }
 expect(receiptCollectorReport(legacyVoucher, legacyJournal, legacy.employees, period).rows[0].collectorId).toBeNull()
 s.reverseVoucher(voucher.id, 'تصحيح')
 const reversed = useRawDataStore.getState()
 const damaged = reversed.journal.map(entry => entry.reversesEntryId === voucher.journalEntryId ? { ...entry, lines: entry.lines.map(line => ({ ...line, debit: line.debit * 2, credit: line.credit * 2 })) } : entry)
 const result = receiptCollectorReport(reversed.vouchers, damaged, reversed.employees, period)
 expect(result.rows).toHaveLength(0)
 expect(result.warnings.join(' ')).toContain(voucher.voucherNumber)
})
it('يحفظ محصل طلب الاعتماد ويعيد التحقق منه عند الترحيل بعد القرار', () => {
 const { s, collector } = fixture()
 useAppStore.setState({ approvals: { enabled: true, scope: ['receipt'], thresholdMinor: 0, approverUserIds: [], autoApprovedUserIds: [] } })
 useRawDataStore.setState({ appUsers: [{ id: 5, nameAr: 'كاشير', roleId: 'cashier', pinHash: '0'.repeat(64), active: true, branchId: null }] as never, currentUserId: 5, docApprovals: [] })
 expect(() => s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4110', amountMinor: 1000, description: 'تحصيل', receiptCollectorEmployeeId: collector.id })).toThrow(/الاعتماد/)
 const request = useRawDataStore.getState().docApprovals[0]
 expect(JSON.parse(request.payload).receiptCollectorEmployeeId).toBe(collector.id)
 useRawDataStore.setState({ currentUserId: null })
 s.decideDocApproval(request.id, { status: 'approved', by: null, byName: 'المالك' })
 const voucher = useRawDataStore.getState().vouchers[0]
 expect(voucher.receiptCollectorEmployeeId).toBe(collector.id)
 expect(useRawDataStore.getState().journal.find(entry => entry.id === voucher.journalEntryId)?.receiptCollectorId).toBe(collector.id)
})
it('يرفض محصّلاً من فرع آخر قبل حفظ السند', () => {
 const { s, collector } = fixture()
 useRawDataStore.setState(state => ({
  branches: [{ id: 1, nameAr: 'رئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true, customModulesMode: 'all', enabledModules: [] }, { id: 2, nameAr: 'فرع ٢', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true, customModulesMode: 'all', enabledModules: [] }],
  activeBranchId: 1, employees: state.employees.map(employee => ({ ...employee, branchId: 2 }))
 }))
 expect(() => s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4110', amountMinor: 1000, description: 'تحصيل', receiptCollectorEmployeeId: collector.id })).toThrow(/محصّل/)
 expect(useRawDataStore.getState().journal).toHaveLength(0)
})
