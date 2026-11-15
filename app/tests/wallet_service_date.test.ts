import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 5, 12))
 const setup = { ...app.setup, completed: true, activityId: 'mobiles' as never, countryCode: 'EG', allowNegativeTreasury: true }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], customers: [], walletOps: [], journal: [], paymentTerminals: [], paymentTerminalTransactions: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', isDefault: true }] })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
const input = { type: 'balance_transfer' as const, provider: 'vodafone' as const, targetPhone: '010123', paidToProviderMinor: 1000, chargeMinor: 1100, paidMinor: 1100, customerId: null, fundingTreasury: '1101', receiveTreasury: '1101', vatPercent: 15, notes: '' }
it('يحفظ التاريخ في العملية والقيد ووقت التسجيل الفعلي ويحسب الهامش والضريبة', () => {
 const op = S().postWalletService({ ...input, date: '2026-11-03' })
 expect(op).toMatchObject({ date: '2026-11-03', createdAt: expect.stringContaining('2026-11-05') })
 expect(op.totals).toMatchObject({ profitGrossMinor: 100, vatMinor: 13, revenueMinor: 87 }); expect(S().journal[0].date).toBe(op.date)
 expect(S().journal[0].createdAt.slice(0, 10)).toBe('2026-11-05')
})
it.each(['2026-11-06', '2026-02-30', '', '2026-11-04T12:00:00Z'])('يرفض تاريخاً غير صالح أو مستقبلياً %s دون كتابة', date => {
 expect(() => S().postWalletService({ ...input, date })).toThrow(/تاريخ/); expect(S().walletOps).toHaveLength(0); expect(S().journal).toHaveLength(0)
})
it('يرفض الفترة المقفلة وتاريخ ماكينة سابق وحركة خزينة لاحقة', () => {
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-11-02', status: 'closed' }, { id: 2, nameAr: 'مفتوحة', startDate: '2026-11-03', endDate: '2026-12-31', status: 'open' }] })
 expect(() => S().postWalletService({ ...input, date: '2026-11-02' })).toThrow(/مقفلة/)
 expect(() => S().postWalletService({ ...input, date: '2026-11-03', terminalPayment: { terminalId: 't', providerReference: 'ref' } })).toThrow(/الماكينة/)
 S().postWalletService({ ...input, date: '2026-11-04' })
 expect(() => S().postWalletService({ ...input, date: '2026-11-03' })).toThrow(/التسلسل/)
 expect(S().walletOps).toHaveLength(1); expect(S().journal).toHaveLength(1)
})
it('يتحقق من صلاحية المستخدم والخزينة ويمنع قيم المبالغ غير الآمنة', () => {
 useRawDataStore.setState({ currentUserId: 999 })
 expect(() => S().postWalletService(input)).toThrow(/صلاحية/)
 useRawDataStore.setState({ currentUserId: null })
 expect(() => S().postWalletService({ ...input, fundingTreasury: '9999' })).toThrow(/خزينة/)
 expect(() => S().postWalletService({ ...input, paidToProviderMinor: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/غير صالحة/)
 expect(S().walletOps).toHaveLength(0)
})
