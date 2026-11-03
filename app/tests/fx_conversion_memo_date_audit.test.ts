import { beforeEach, expect, it } from 'vitest'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, appUsers: [], currentUserId: null, items: [], sales: [], vouchers: [], purchases: [], journal: [], fxConversions: [] }) })
function fixture() {
 const s = useDataStore.getState(), dest = s.addTreasury('خزينة ثانية', 'cash')
 const fx = { currencyCode: 'USD', amountMinor: 200, ratePpm: 10000000, decimals: 2 as const }
 const receipt = s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4101', amountMinor: 2000, description: 'قبض', fx, bookDecimals: 2, bookCurrencyCode: 'EGP' })
 s.repairExternalFx({ kind: 'voucher', id: receipt.id, fx, date: '2026-01-01', reason: 'إيصال', confirmed: true })
 const doc = s.transferFx({ currency: 'USD', decimals: 2, fromTreasury: '1101', toTreasury: dest.code, amountMinor: 100 })
 return { s, doc, dest }
}
it('يصحح تاريخ مذكرة التحويل لكلا ساقيه دون تعديل المستند والقيد', () => {
 const { s, doc } = fixture(), before = useRawDataStore.getState()
 s.correctFxConversionMemoDate({ conversionId: doc.id, date: '2026-02-01', reason: 'إيصال التحويل', confirmed: true })
 const after = useDataStore.getState()
 expect(after.journal).toBe(before.journal)
 expect(after.fxConversions[0].date).toBe(doc.date)
 expect(s.getFxFlows().filter(f => f.seq === doc.journalEntryId).map(f => f.date)).toEqual(['2026-02-01', '2026-02-01'])
 expect(after.fxConversions[0].memoDateHistory?.[0]).toMatchObject({ previousDate: doc.date, date: '2026-02-01', reason: 'إيصال التحويل' })
})
it('يرفض تاريخاً قبل الحيازة أو متعارضاً مع الوجهة أو دون تأكيد', () => {
 const { s, doc, dest } = fixture()
 s.postVoucher({ kind: 'payment', treasury: dest.code, counterAccountCode: '5108', amountMinor: 500, description: 'صرف', fx: { currencyCode: 'USD', amountMinor: 50, ratePpm: 10000000, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
 const before = useRawDataStore.getState()
 expect(() => s.correctFxConversionMemoDate({ conversionId: doc.id, date: '2025-01-01', reason: 'إيصال', confirmed: true })).toThrow(/تاريخ/)
 expect(() => s.correctFxConversionMemoDate({ conversionId: doc.id, date: '2099-01-01', reason: 'إيصال', confirmed: true })).toThrow(/تاريخ/)
 expect(() => s.correctFxConversionMemoDate({ conversionId: doc.id, date: '2026-02-01', reason: 'إيصال', confirmed: false })).toThrow(/تأكيد/)
 expect(useRawDataStore.getState().fxConversions).toBe(before.fxConversions)
})
it('يحجب التاريخ المصحح إن تم العبث بسلسلة الإثبات أو قيد التحويل', () => {
 const { s, doc } = fixture()
 s.correctFxConversionMemoDate({ conversionId: doc.id, date: '2026-02-01', reason: 'إيصال التحويل', confirmed: true })
 const saved = useRawDataStore.getState()
 useRawDataStore.setState({ fxConversions: saved.fxConversions.map(row => ({ ...row, memoDateHistory: row.memoDateHistory?.map(h => ({ ...h, reason: '' })) })) })
 expect(() => s.getFxFlows()).toThrow(/سجل|تاريخ/)
 useRawDataStore.setState({ fxConversions: saved.fxConversions, journal: saved.journal.filter(e => e.id !== doc.journalEntryId) })
 expect(() => s.getFxFlows()).toThrow(/قيد/)
})
it('يرفض التاريخ الذي يتجاوز حركة لاحقة على خزينة الوجهة', () => {
 const { s, doc, dest } = fixture()
 s.correctFxConversionMemoDate({ conversionId: doc.id, date: '2026-02-01', reason: 'إيصال التحويل', confirmed: true })
 const pay = s.postVoucher({ kind: 'payment', treasury: dest.code, counterAccountCode: '5108', amountMinor: 500, description: 'صرف', fx: { currencyCode: 'USD', amountMinor: 50, ratePpm: 10000000, decimals: 2 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
 s.repairExternalFx({ kind: 'voucher', id: pay.id, fx: pay.fx!, date: '2026-03-01', reason: 'إيصال الصرف', confirmed: true })
 const before = useRawDataStore.getState()
 expect(() => s.correctFxConversionMemoDate({ conversionId: doc.id, date: '2026-04-01', reason: 'إيصال', confirmed: true })).toThrow(/تاريخ/)
 expect(useRawDataStore.getState().fxConversions).toBe(before.fxConversions)
})
it('يتطلب صلاحية عكس القيود وصلاحية طرفي التحويل', () => {
 const { s, doc } = fixture()
 useRawDataStore.setState({ appUsers: [{ id: 9, nameAr: 'كاشير', roleId: 'cashier', pinHash: 'x', active: true, treasuryAccess: { grants: [] } }] as never, currentUserId: 9 })
 const before = useRawDataStore.getState()
 expect(() => s.correctFxConversionMemoDate({ conversionId: doc.id, date: '2026-02-01', reason: 'إيصال', confirmed: true })).toThrow(/صلاحية/)
 expect(useRawDataStore.getState().fxConversions).toBe(before.fxConversions)
})
it('يظل العكس اللاحق موثقاً ولا يحذف إثبات التاريخ', () => {
 const { s, doc } = fixture()
 s.correctFxConversionMemoDate({ conversionId: doc.id, date: '2026-02-01', reason: 'إيصال', confirmed: true })
 s.reverseFxTransfer({ conversionId: doc.id, reason: 'إلغاء' })
 expect(s.getFxFlows().filter(row => row.seq === doc.journalEntryId)).toEqual([])
 expect(useDataStore.getState().fxConversions[0].memoDateHistory).toHaveLength(1)
})
