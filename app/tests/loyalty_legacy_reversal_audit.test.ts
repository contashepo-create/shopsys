import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore, useRawDataStore, EMPTY_EXTENDED } from '../src/data/repo.ts'
import { buildReversalLines } from '../src/core/ledger.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { secureStorage, flushSecureStorageWrites } from '../src/data/secureStorage.ts'
import { buildBackup, parseBackup } from '../src/core/backup.ts'

const original = useDataStore.getState()
const appOriginal = useAppStore.getState()
const S = () => useDataStore.getState()

beforeEach(() => {
  useAppStore.setState({ ...appOriginal, setup: { ...appOriginal.setup, countryCode: 'EG', vatPercent: 0, allowNegativeTreasury: true } })
  useDataStore.setState({ ...original, customers: [], projects: [], projectExtracts: [], cheques: [], vouchers: [], clientSettlements: [], journal: [], saleReturns: [], sales: [], openingBalances: {}, loyaltyRedemptions: [] })
  localStorage.setItem('shopsys-app', JSON.stringify({ state: { loyalty: { enabled: true, redeemValueMinor: 5, minRedeemPoints: 100 } } }))
})

function setupLegacy() {
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل ولاء', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = S().customers.at(-1)!
  useDataStore.setState({ customers: S().customers.map(c => c.id === customer.id ? { ...c, loyaltyPoints: 800 } : c) })
  const project = S().addProject({ nameAr: 'مشروع', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = S().addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  const redemption = S().redeemLoyaltyPoints(customer.id, 800)
  const entry = S().journal.find(e => e.id === redemption.journalEntryId)!
  const reversalId = Math.max(...S().journal.map(e => e.id)) + 1
  const reversal = { ...entry, id: reversalId, entryNumber: reversalId, date: '2026-12-01', sourceType: 'reversal' as const, sourceId: entry.id, lines: buildReversalLines(entry.lines), reversedByEntryId: null, reversesEntryId: entry.id }
  useDataStore.setState({ journal: [...S().journal.map(e => e.id === entry.id ? { ...e, reversedByEntryId: reversalId } : e), reversal] })
  return { customer, extract, entry, reversal }
}

describe('تصحيح عرض عكس استبدال الولاء القديم دون تغيير النقاط تلقائياً', () => {
  it('يظهر الاستبدال والعكس في كشف العميل ويتوقف تخصيصه للمستخلص', () => {
    const { customer, extract } = setupLegacy()
    const rows = S().getCustomerStatementRows(customer.id)
    expect(rows.some(row => row.docLabel.includes('استبدال 800 نقطة'))).toBe(true)
    expect(rows.some(row => row.docLabel.includes('عكس استبدال') && row.date === '2026-12-01' && row.debitMinor === 4000)).toBe(true)
    expect(S().getCustomerBalance(customer.id)).toBe(10000)
    expect(S().getOpenClientInvoices(customer.id, true).find(doc => doc.docKey === `extract:${extract.id}`)?.settledMinor).toBe(0)
    expect(S().customers.find(c => c.id === customer.id)?.loyaltyPoints).toBe(0)
  })

  it('لا يعتبر رابط عكس مفقود دليلاً على إلغاء الاستبدال', () => {
    const { customer, extract, reversal } = setupLegacy()
    useDataStore.setState({ journal: S().journal.filter(e => e.id !== reversal.id) })
    expect(S().getCustomerBalance(customer.id)).toBe(6000)
    expect(S().getOpenClientInvoices(customer.id, true).find(doc => doc.docKey === `extract:${extract.id}`)?.settledMinor).toBe(4000)
  })
  it('يستعيد المالك النقاط مرة واحدة بعد مراجعة مؤكدة ويسجل السبب بلا قيد جديد', () => {
    const { customer } = setupLegacy()
    const redemption = S().loyaltyRedemptions[0]
    const journalCount = S().journal.length
    expect(() => S().resolveLegacyLoyaltyPoints(redemption.id, 'restore', '  ')).toThrow(/سبب/)
    S().resolveLegacyLoyaltyPoints(redemption.id, 'restore', 'تمت مطابقة سجل العميل')
    expect(S().customers.find(c => c.id === customer.id)?.loyaltyPoints).toBe(800)
    expect(S().loyaltyRedemptions[0].legacyResolution).toMatchObject({ action: 'restore', reason: 'تمت مطابقة سجل العميل' })
    expect(S().auditLog.at(-1)?.title).toContain('800 نقطة')
    expect(S().journal.length).toBe(journalCount)
    expect(S().getCustomerBalance(customer.id)).toBe(10000)
    expect(() => S().resolveLegacyLoyaltyPoints(redemption.id, 'restore', 'تكرار')).toThrow(/مسبقاً/)
    expect(S().customers.find(c => c.id === customer.id)?.loyaltyPoints).toBe(800)
  })

  it('تسجيل التصحيح اليدوي السابق لا يضيف النقاط مرة ثانية', () => {
    const { customer } = setupLegacy()
    const redemption = S().loyaltyRedemptions[0]
    useDataStore.setState({ customers: S().customers.map(c => c.id === customer.id ? { ...c, loyaltyPoints: 800 } : c) })
    S().resolveLegacyLoyaltyPoints(redemption.id, 'already_corrected', 'صُححت النقاط سابقاً')
    expect(S().customers.find(c => c.id === customer.id)?.loyaltyPoints).toBe(800)
    expect(S().loyaltyRedemptions[0].legacyResolution?.action).toBe('already_corrected')
  })

  it('يرفض غير المالك ولا يعالج قيد عكس مفقوداً', () => {
    const { reversal } = setupLegacy()
    const redemption = S().loyaltyRedemptions[0]
    useDataStore.setState({ appUsers: [{ id: 91, nameAr: 'موظف', roleId: 'cashier', pinHash: '0'.repeat(64), active: true }], currentUserId: 91 })
    expect(() => S().resolveLegacyLoyaltyPoints(redemption.id, 'restore', 'مراجعة')).toThrow(/للمالك فقط/)
    useDataStore.setState({ currentUserId: null, journal: S().journal.filter(e => e.id !== reversal.id) })
    expect(() => S().resolveLegacyLoyaltyPoints(redemption.id, 'restore', 'مراجعة')).toThrow(/عكسي/)
  })

  it('يفصل سجلات الفروع ويكتشف عكس الاستبدال القديم المرتبط بعميل الفرع حتى لو كان القيد بلا فرع', () => {
    const { customer, extract } = setupLegacy()
    const main = { id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }
    const second = { id: 2, nameAr: 'الفرع الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }
    useRawDataStore.setState({
      branches: [main, second], activeBranchId: 2, currentUserId: null, appUsers: [],
      customers: S().customers.map(c => ({ ...c, branchId: 2 })),
      projects: S().projects.map(p => ({ ...p, branchId: 2 })),
      projectExtracts: S().projectExtracts.map(e => ({ ...e, branchId: 2 })),
      loyaltyRedemptions: S().loyaltyRedemptions.map(r => ({ ...r, branchId: 2 })),
    })
    expect(S().getCustomerBalance(customer.id)).toBe(10000)
    expect(S().getOpenClientInvoices(customer.id, true).find(d => d.docKey === `extract:${extract.id}`)?.settledMinor).toBe(0)
    expect(S().getPendingLegacyLoyaltyReviews()).toHaveLength(1)
    useRawDataStore.setState({ activeBranchId: 1 })
    expect(S().getPendingLegacyLoyaltyReviews()).toHaveLength(0)
    expect(() => S().resolveLegacyLoyaltyPoints(1, 'restore', 'مراجعة فرع آخر')).toThrow(/الفرع الحالي/)
    useRawDataStore.setState({ activeBranchId: 2 })
    S().resolveLegacyLoyaltyPoints(1, 'restore', 'مطابقة الفرع')
    expect(S().customers[0].loyaltyPoints).toBe(800)
    useRawDataStore.setState({ activeBranchId: null, branches: [] })
  })

  it('لا يصحح آثار قيد عكسي بمبلغ مختلف أو بفرع مختلف', () => {
    const { customer, reversal } = setupLegacy()
    const bad = { ...reversal, branchId: 2, lines: reversal.lines.map(l => l.accountCode === '1104' ? { ...l, debit: 3999 } : l) }
    useDataStore.setState({ journal: S().journal.map(e => e.id === bad.id ? bad : e) })
    expect(S().getCustomerBalance(customer.id)).toBe(6000)
    expect(S().getPendingLegacyLoyaltyReviews()).toHaveLength(0)
    expect(() => S().resolveLegacyLoyaltyPoints(1, 'restore', 'مراجعة')).toThrow(/عكسي/)
  })

  it('لا يقبل عكساً تالفاً في حساب المصروف حتى لو تطابق حساب العميل', () => {
    const { customer, reversal } = setupLegacy()
    useDataStore.setState({ journal: S().journal.map(e => e.id === reversal.id ? { ...e, lines: e.lines.map(l => l.accountCode === '5115' ? { ...l, credit: l.credit - 1 } : l) } : e) })
    expect(S().getPendingLegacyLoyaltyReviews()).toHaveLength(0)
    expect(S().getCustomerBalance(customer.id)).toBe(6000)
    expect(() => S().resolveLegacyLoyaltyPoints(1, 'restore', 'مراجعة')).toThrow(/عكسي/)
  })

  it('تستمر مراجعة نقاط الولاء بعد تخزين مشفر ونسخة احتياطية وإعادة تحميل المخزن', async () => {
    const { customer } = setupLegacy()
    S().resolveLegacyLoyaltyPoints(1, 'restore', 'تم التحقق قبل الاستعادة')
    await flushSecureStorageWrites('shopsys-data')
    const stored = await secureStorage.getItem('shopsys-data')
    expect(stored).toBeTruthy()
    const backup = buildBackup({ appState: {}, storeState: JSON.parse(stored!), appDataVersion: 1, shopName: 'اختبار' })
    const restored = parseBackup(JSON.stringify(backup))
    useRawDataStore.setState({ customers: [], loyaltyRedemptions: [], journal: [] })
    await flushSecureStorageWrites('shopsys-data')
    await secureStorage.setItem('shopsys-data', JSON.stringify(restored.data.store))
    await useRawDataStore.persist.rehydrate()
    expect(S().customers.find((c) => c.id === customer.id)?.loyaltyPoints).toBe(800)
    expect(S().loyaltyRedemptions[0].legacyResolution?.action).toBe('restore')
    expect(S().getPendingLegacyLoyaltyReviews()).toHaveLength(0)
    expect(() => S().resolveLegacyLoyaltyPoints(1, 'restore', 'محاولة ثانية')).toThrow(/مسبقاً/)
  })

})
