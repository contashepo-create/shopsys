import { beforeEach, expect, it } from 'vitest'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { fxConversionHistoryIssues } from '../src/core/fxTreasury.ts'
import { assertJournalSnapshotSafe } from '../src/core/ledgerSnapshotGuard.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => { useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } }); useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, appUsers: [], currentUserId: null, sales: [], vouchers: [], purchases: [], journal: [], fxConversions: [] }) })
function fixture() {
  const s = useDataStore.getState(), dest = s.addTreasury('خزينة أخرى', 'cash')
  s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4101', amountMinor: 10000, description: 'حيازة', fx: { currencyCode: 'KWD', amountMinor: 1000, ratePpm: 100000000, decimals: 3 }, bookDecimals: 2, bookCurrencyCode: 'EGP' })
  return { s, dest }
}
it('ينقل نفس العملة بين خزانتين بالتكلفة دون ربح أو إعادة تقييم', () => {
  const { s, dest } = fixture()
  const doc = s.transferFx({ currency: 'KWD', decimals: 3, fromTreasury: '1101', toTreasury: dest.code, amountMinor: 250, notes: 'تحويل فعلي' })
  expect(s.getFxHoldings()).toEqual(expect.arrayContaining([expect.objectContaining({ treasury: '1101', currency: 'KWD', amountMinor: 750, bookValueMinor: 7500 }), expect.objectContaining({ treasury: dest.code, currency: 'KWD', amountMinor: 250, bookValueMinor: 2500 })]))
  const entry = useDataStore.getState().journal.find(row => row.id === doc.journalEntryId)!
  expect(entry.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: '1101', credit: 2500 }), expect.objectContaining({ accountCode: dest.code, debit: 2500 })]))
  expect(entry.lines).toHaveLength(2)
  expect(fxConversionHistoryIssues(useDataStore.getState().fxConversions, s.getFxFlows(), 'EGP', 2)).toEqual([])
})
it('يرفض الرصيد غير الكافي والخزينة نفسها أو السجل المتعارض دون كتابة', () => {
  const { s, dest } = fixture(), before = useRawDataStore.getState()
  const args = { currency: 'KWD', decimals: 3 as const, fromTreasury: '1101', toTreasury: dest.code, amountMinor: 1001 }
  expect(() => s.transferFx(args)).toThrow(/رصيد/)
  expect(() => s.transferFx({ ...args, amountMinor: 1, toTreasury: '1101' })).toThrow(/حسابين|خزين/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
  const doc = s.transferFx({ ...args, amountMinor: 250 })
  useRawDataStore.setState(state => ({ journal: state.journal.filter(entry => entry.id !== doc.journalEntryId) }))
  expect(() => s.getFxHoldings()).toThrow(/قيد/)
})
it('يتحقق من صلاحيات طرفي التحويل قبل تسجيله', () => {
  const { s, dest } = fixture()
  useRawDataStore.setState({ appUsers: [{ id: 9, nameAr: 'مستخدم', roleId: 'cashier', pinHash: 'x', active: true, treasuryAccess: { grants: [{ treasuryCode: '1101', operations: ['transfer_from'] }] } }] as never, currentUserId: 9 })
  const before = useRawDataStore.getState()
  expect(() => s.transferFx({ currency: 'KWD', decimals: 3, fromTreasury: '1101', toTreasury: dest.code, amountMinor: 250 })).toThrow(/مسموح/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يحفظ قيمة أصغر وحدة دون تقريب سعر الحيازة وينقل الباقي عند النفاد', () => {
  const { s, dest } = fixture()
  const d1 = s.transferFx({ currency: 'KWD', decimals: 3, fromTreasury: '1101', toTreasury: dest.code, amountMinor: 333 })
  const d2 = s.transferFx({ currency: 'KWD', decimals: 3, fromTreasury: '1101', toTreasury: dest.code, amountMinor: 667 })
  expect(d1.outBookValueMinor! + d2.outBookValueMinor!).toBe(10000)
  expect(s.getFxHoldings()).toEqual([expect.objectContaining({ treasury: dest.code, amountMinor: 1000, bookValueMinor: 10000 })])
})
it('يعكس آخر تحويل عملة بمستند عكسي محفوظ دون حذف أصل التحويل', () => {
  const { s, dest } = fixture()
  const doc = s.transferFx({ currency: 'KWD', decimals: 3, fromTreasury: '1101', toTreasury: dest.code, amountMinor: 250 })
  s.reverseFxTransfer({ conversionId: doc.id, reason: 'التحويل لم يتم فعلياً' })
  const state = useDataStore.getState(), reversed = state.fxConversions.find(row => row.id === doc.id)!
  expect(reversed.reversalEntryId).toBeTruthy()
  expect(state.journal.find(row => row.id === doc.journalEntryId)?.reversedByEntryId).toBe(reversed.reversalEntryId)
  expect(s.getFxHoldings()).toEqual([expect.objectContaining({ treasury: '1101', currency: 'KWD', amountMinor: 1000, bookValueMinor: 10000 })])
  expect(() => s.reverseFxTransfer({ conversionId: doc.id, reason: 'تكرار' })).toThrow(/معكوس/)
  useRawDataStore.setState({ journal: state.journal.filter(row => row.id !== reversed.reversalEntryId) })
  expect(() => s.getFxFlows()).toThrow(/عكس|قيد/)
})
it('يحجب تصحيح تحويل إذا تلتْه حركة على أي من رصيديه', () => {
  const { s, dest } = fixture()
  const doc = s.transferFx({ currency: 'KWD', decimals: 3, fromTreasury: '1101', toTreasury: dest.code, amountMinor: 250 })
  s.transferFx({ currency: 'KWD', decimals: 3, fromTreasury: dest.code, toTreasury: '1101', amountMinor: 100 })
  const before = useRawDataStore.getState()
  expect(() => s.reverseFxTransfer({ conversionId: doc.id, reason: 'تصحيح' })).toThrow(/لاحقة/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يسمح بعكس التحويلات بالترتيب العكسي ثم باستعمال الرصيد دون محو الأثر', () => {
  const { s, dest } = fixture()
  const one = s.transferFx({ currency: 'KWD', decimals: 3, fromTreasury: '1101', toTreasury: dest.code, amountMinor: 300 })
  const two = s.transferFx({ currency: 'KWD', decimals: 3, fromTreasury: dest.code, toTreasury: '1101', amountMinor: 100 })
  s.reverseFxTransfer({ conversionId: two.id, reason: 'ثاني تحويل ملغي' })
  s.reverseFxTransfer({ conversionId: one.id, reason: 'أول تحويل ملغي' })
  s.transferFx({ currency: 'KWD', decimals: 3, fromTreasury: '1101', toTreasury: dest.code, amountMinor: 200 })
  expect(s.getFxHoldings()).toEqual(expect.arrayContaining([expect.objectContaining({ treasury: '1101', amountMinor: 800, bookValueMinor: 8000 }), expect.objectContaining({ treasury: dest.code, amountMinor: 200, bookValueMinor: 2000 })]))
  const state = useDataStore.getState()
  expect(() => assertJournalSnapshotSafe(JSON.parse(JSON.stringify(useRawDataStore.getState())))).not.toThrow()
  expect(state.fxConversions).toHaveLength(3)
  expect(state.fxConversions.slice(0, 2).every(row => row.reversalEntryId != null)).toBe(true)
})
it('يرفض تحويل خزائن بتأريخ يسبق حيازته أو في المستقبل', () => {
  const { s, dest } = fixture(), args = { currency: 'KWD', decimals: 3 as const, fromTreasury: '1101', toTreasury: dest.code, amountMinor: 250 }
  const before = useRawDataStore.getState()
  expect(() => s.transferFx({ ...args, date: '2000-01-01' })).toThrow(/تاريخ/)
  expect(() => s.transferFx({ ...args, date: '2099-01-01' })).toThrow(/تاريخ/)
  expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('لا يسمح بإخفاء نوع تحويل الخزائن أو تغيير حساب قيد عكسه', () => {
  const { s, dest } = fixture()
  const doc = s.transferFx({ currency: 'KWD', decimals: 3, fromTreasury: '1101', toTreasury: dest.code, amountMinor: 250 })
  const saved = useRawDataStore.getState()
  useRawDataStore.setState({ fxConversions: [{ ...doc, kind: undefined }] })
  expect(() => s.getFxFlows()).toThrow(/قيد|مراجعة/)
  useRawDataStore.setState({ fxConversions: saved.fxConversions })
  s.reverseFxTransfer({ conversionId: doc.id, reason: 'تحويل غير منفذ' })
  const reversed = useRawDataStore.getState(), reverseId = reversed.fxConversions[0].reversalEntryId
  useRawDataStore.setState({ journal: reversed.journal.map(entry => entry.id === reverseId ? { ...entry, lines: entry.lines.map((line, i) => i === 0 ? { ...line, accountCode: '1102' } : line) } : entry) })
  expect(() => s.getFxFlows()).toThrow(/عكس|قيد|مراجعة/)
})
