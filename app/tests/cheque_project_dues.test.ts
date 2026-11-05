/**
 * بلاغ المالك 2026-10-27: «حصّلتُ شيكاً من عميل فظهر في كشف حسابه لكن لم
 * يظهر خصمه في تقارير المشاريع». الاختبار يثبت ربط الدفترين ويمنع عودة العطب.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDataStore, EMPTY_EXTENDED, type DataState } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import {
  activeIncomingChequesTotal, allocateChequeDues, chequeSettlesCustomerDues,
  type ChequeDuesLike,
} from '../src/core/chequeDues.ts'
import { projectOpenBalances } from '../src/core/projectReportBalances.ts'
import type { ChequeStatus } from '../src/core/cheques.ts'

const original = useDataStore.getState()
const S = () => useDataStore.getState()

function setupCustomerWithExtract(amountMinor = 1_000_000_00, openingMinor = 0) {
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'شركة النيل للمقاولات', phone: '01000000000', creditLimitMinor: 0, notes: '' })
  const cust = S().customers.at(-1)!
  if (openingMinor) S().setOpeningBalance({ kind: 'customer', refId: cust.id, amountMinor: openingMinor, label: cust.nameAr })
  const project = S().addProject({
    nameAr: 'فيلا النخيل', clientId: cust.id, clientName: cust.nameAr,
    contractValueMinor: 2_450_000_00, retentionPercent: 0, startDate: '2026-01-01', notes: '',
  })
  const extract = S().addProjectExtract({
    projectId: project.id, description: 'مستخلص أول', grossMinor: amountMinor, vatPercent: 0, payment: 'credit',
  })
  return { cust, project, extract, key: `extract:${extract.id}` }
}

function receive(custId: number, chequeNumber: string, amountMinor: number, status: ChequeStatus = 'collected') {
  const c = S().receiveCheque({
    chequeNumber, partyId: custId, bankName: 'بنك مصر',
    amountMinor, dueDate: '2026-11-01', notes: 'دفعة على الحساب',
  })
  if (status !== 'held') S().setChequeStatus(c.id, status, S().treasuries[0]?.code ?? '1101')
  return c
}

describe('ربط الشيكات الواردة بذمم المشاريع (مصدر واحد للحقيقة)', () => {
  beforeEach(() => {
    useAppStore.setState((s) => ({ ...s, setup: { ...s.setup, countryCode: 'EG', vatPercent: 0, allowNegativeTreasury: true } }))
    useDataStore.setState({
      ...original,
      customers: [], projects: [], projectExtracts: [], cheques: [],
      vouchers: [], clientSettlements: [], journal: [], saleReturns: [], sales: [], openingBalances: {},
    })
  })

  it('① استلام/تحصيل شيك ⇒ يظهر في كشف العميل **ويُخصم من ذمم المستخلص**', () => {
    const { cust, key } = setupCustomerWithExtract()
    const before = S().getOpenClientInvoices(cust.id).find((d) => d.docKey === key)!
    expect(before.settledMinor).toBe(0)
    const balanceBefore = S().getCustomerBalance(cust.id)

    receive(cust.id, 'CH-9001', 400_000_00)

    const statement = S().getCustomerStatementRows(cust.id)
    expect(statement.some((r) => r.docLabel.includes('شيك وارد CH-9001'))).toBe(true)
    expect(S().getCustomerBalance(cust.id)).toBeLessThan(balanceBefore)
    // التقرير يرى التحصيل بعد الإصلاح
    const after = S().getOpenClientInvoices(cust.id).find((d) => d.docKey === key)
    expect(after?.settledMinor).toBe(400_000_00)
    expect(after ? after.dueMinor - after.settledMinor : 0).toBe(before.dueMinor - 400_000_00)
  })

  it('② ارتداد الشيك ⇒ يعود الدين في الكشف والتقرير معاً (لا خصم وهمي)', () => {
    const { cust, key } = setupCustomerWithExtract()
    // الارتداد في آلة الحالات مسموح من «في الحافظة» أو «تحت التحصيل» فقط
    receive(cust.id, 'CH-9002', 250_000_00, 'deposited')
    const settledBeforeBounce = S().getOpenClientInvoices(cust.id).find((d) => d.docKey === key)?.settledMinor
    expect(settledBeforeBounce).toBe(250_000_00)

    const bounced = S().cheques.find((c) => c.chequeNumber === 'CH-9002')!
    S().setChequeStatus(bounced.id, 'bounced')

    const after = S().getOpenClientInvoices(cust.id).find((d) => d.docKey === key)
    expect(after?.settledMinor ?? 0).toBe(0)
    const statement = S().getCustomerStatementRows(cust.id)
    expect(statement.some((r) => r.docLabel.includes('ارتداد شيك CH-9002'))).toBe(true)
  })

  it('③ سند قبض + شيك على نفس المستند ⇒ لا خصم مزدوج (المجموع لا يتجاوز المستحق)', () => {
    const { cust, key } = setupCustomerWithExtract(600_000_00)
    receive(cust.id, 'CH-9003', 300_000_00, 'collected')
    // سند قبض حقيقي عبر مسار المتجر — يقرأ الذمم بعد خصم الشيك
    S().postVoucher({
      kind: 'receipt', partyKind: 'customer', partyId: cust.id,
      treasury: S().treasuries[0]?.code ?? '1101', counterAccountCode: '1104',
      amountMinor: 200_000_00, description: 'تحصيل نقدي', date: '2026-05-01',
    })
    const doc = S().getOpenClientInvoices(cust.id).find((d) => d.docKey === key)
    expect(doc?.settledMinor ?? 0).toBe(500_000_00)
    expect(doc ? doc.dueMinor - doc.settledMinor : 0).toBe(100_000_00)
  })

  it('④ شيكات بلا طرف / صادرة / ملغاة لا تُحتسب', () => {
    const { cust, key } = setupCustomerWithExtract()
    // شيك وارد بلا طرف مسجل (إيراد آخر) — لا يخصم من ذمة هذا العميل
    S().receiveCheque({ chequeNumber: 'NO-PARTY', partyId: null, partyName: 'جهة أخرى', bankName: 'بنك', amountMinor: 100_000_00, dueDate: '2026-11-01', notes: '' })
    // شيك صادر لنفس العميل (اتجاه خاطئ) — لا يُحتسب
    S().cheques.push({
      id: 9999, chequeNumber: 'OUT-1', direction: 'outgoing', partyId: cust.id, partyName: cust.nameAr,
      counterAccount: '2101', bankName: 'بنك', amountMinor: 100_000_00, dueDate: '2026-11-01', status: 'issued',
      notes: '', createdAt: '2026-05-01T00:00:00Z', receiveEntryId: 0, settleEntryId: null, reverseEntryId: null,
      depositedAt: null, settledAt: null,
    } as DataState['cheques'][number])
    expect(S().getOpenClientInvoices(cust.id).find((d) => d.docKey === key)?.settledMinor ?? 0).toBe(0)
  })

  it('رصيد افتتاحي أقدم من المستخلص يُطفأ أولاً بالشيك ولا يُظهر المستخلص مسدداً', () => {
    const { cust, key, project } = setupCustomerWithExtract(10000, 10000)
    receive(cust.id, 'OPENING', 10000, 'held')
    expect(S().getCustomerBalance(cust.id)).toBe(10000)
    expect(projectOpenBalances(S().projects, S().projectExtracts, S().getOpenClientInvoices).get(project.id)).toBe(10000)
    const extract = S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === key)
    expect(extract?.settledMinor).toBe(0)
    expect(S().getOpenClientInvoices(cust.id).some((d) => d.docKey === key)).toBe(true)
  })

  it('الفائض عن الافتتاحي يذهب للمستخلص ثم يزول عند ارتداد الشيك', () => {
    const { cust, key } = setupCustomerWithExtract(10000, 10000)
    const c = receive(cust.id, 'OPENING-OVER', 14000, 'deposited')
    const ledger = () => S().getOpenClientInvoices(cust.id, true)
    expect(ledger().find((d) => d.docKey === `customer-opening:${cust.id}`)?.settledMinor).toBe(10000)
    expect(ledger().find((d) => d.docKey === key)?.settledMinor).toBe(4000)
    S().setChequeStatus(c.id, 'bounced')
    expect(ledger().find((d) => d.docKey === `customer-opening:${cust.id}`)?.settledMinor).toBe(0)
    expect(ledger().find((d) => d.docKey === key)?.settledMinor).toBe(0)
  })

  it('توزيع السند على الافتتاحي يثبت ثم يعاد حساب الشيك عند عكس السند', () => {
    const { cust, key } = setupCustomerWithExtract(10000, 10000)
    const v = S().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: cust.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 3000, description: 'رصيد قديم' })
    expect(v.allocations).toEqual([{ docKey: `customer-opening:${cust.id}`, docLabel: 'رصيد افتتاحي للعميل', appliedMinor: 3000 }])
    receive(cust.id, 'OPENING-VOUCHER', 9000, 'held')
    const ledger = () => S().getOpenClientInvoices(cust.id, true)
    expect(ledger().find((d) => d.docKey === key)?.settledMinor).toBe(2000)
    S().reverseVoucher(v.id, 'تصحيح')
    expect(ledger().find((d) => d.docKey === key)?.settledMinor).toBe(0)
    expect(ledger().find((d) => d.docKey === `customer-opening:${cust.id}`)?.settledMinor).toBe(9000)
  })

  it('التحصيل القديم تحت الحساب يخفّض الافتتاحي تقديرياً دون تغيير السجل الأصلي', () => {
    S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل قديم', phone: '', creditLimitMinor: 0, notes: '' })
    const cust = S().customers.at(-1)!
    const v = S().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: cust.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 5000, description: 'قديم' })
    expect(v.unallocatedMinor).toBe(5000)
    S().setOpeningBalance({ kind: 'customer', refId: cust.id, amountMinor: 10000, label: cust.nameAr })
    const project = S().addProject({ nameAr: 'قديم', clientId: cust.id, clientName: cust.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
    const ex = S().addProjectExtract({ projectId: project.id, description: 'مستخلص', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
    receive(cust.id, 'OPENING-OLD', 7000, 'held')
    const ledger = S().getOpenClientInvoices(cust.id, true)
    expect(ledger.find((d) => d.docKey === `extract:${ex.id}`)?.settledMinor).toBe(2000)
    expect(S().vouchers.find((row) => row.id === v.id)?.unallocatedMinor).toBe(5000)
    S().reverseVoucher(v.id, 'تصحيح')
    expect(S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === `extract:${ex.id}`)?.settledMinor).toBe(0)
  })

  it('مقاصة العميل الأقدم من الشيك تُراعى قبل إسناد الشيك للمستخلص', () => {
    const { cust, key } = setupCustomerWithExtract(10000, 10000)
    S().addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد مقاصة', phone: '', notes: '' })
    const supplier = S().suppliers.at(-1)!
    S().setOpeningBalance({ kind: 'supplier', refId: supplier.id, amountMinor: 10000, label: supplier.nameAr })
    S().postPartyOffset({ customerId: cust.id, supplierId: supplier.id, amountMinor: 10000 })
    receive(cust.id, 'OFFSET-THEN-CHEQUE', 10000, 'held')
    expect(S().getCustomerBalance(cust.id)).toBe(0)
    expect(S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === key)?.settledMinor).toBe(10000)
  })

  it('قيد العميل الدائن الأقدم من الشيك يدخل تقدير الذمم قبل إسناد الشيك للمستخلص', () => {
    const { cust, key } = setupCustomerWithExtract(10000, 10000)
    S().postManualEntry({ date: '2026-01-01', description: 'تسوية سابقة', lines: [
      { accountCode: '5108', debit: 10000, credit: 0 },
      { accountCode: '1104', debit: 0, credit: 10000, partyKind: 'customer', partyId: cust.id },
    ] })
    receive(cust.id, 'MANUAL-THEN-CHEQUE', 10000, 'held')
    expect(S().getCustomerBalance(cust.id)).toBe(0)
    expect(S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === key)?.settledMinor).toBe(10000)
  })

  it('عكس القيد الدائن يعيد المستخلص مفتوحاً ولا يخلق تخصيصاً تقديرياً وهمياً', () => {
    const { cust, key } = setupCustomerWithExtract(10000)
    const entry = S().postManualEntry({ date: '2026-01-01', description: 'تخفيض مؤقت', lines: [
      { accountCode: '5108', debit: 4000, credit: 0 },
      { accountCode: '1104', debit: 0, credit: 4000, partyKind: 'customer', partyId: cust.id },
    ] })
    expect(S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === key)?.settledMinor).toBe(4000)
    S().reverseEntry(entry.id, 'تصحيح')
    expect(S().getCustomerBalance(cust.id)).toBe(10000)
    expect(S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === key)?.settledMinor).toBe(0)
  })

  it('عكس قيد دائن في يوم لاحق لا يترك المستخلص القديم مسدداً', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-02-01T12:00:00Z'))
      const { cust, key } = setupCustomerWithExtract(10000)
      const entry = S().postManualEntry({ date: '2026-02-01', description: 'تخفيض', lines: [
        { accountCode: '5108', debit: 4000, credit: 0 },
        { accountCode: '1104', debit: 0, credit: 4000, partyKind: 'customer', partyId: cust.id },
      ] })
      expect(S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === key)?.settledMinor).toBe(4000)
      vi.setSystemTime(new Date('2026-03-01T12:00:00Z'))
      S().reverseEntry(entry.id, 'تصحيح')
      expect(S().getCustomerBalance(cust.id)).toBe(10000)
      expect(S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === key)?.settledMinor).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('دين قيد يدوي أقدم يستهلك الشيك قبل مستخلص أحدث', () => {
    const { cust, key } = setupCustomerWithExtract(10000)
    S().postManualEntry({ date: '2025-01-01', description: 'دين سابق', lines: [
      { accountCode: '1104', debit: 5000, credit: 0, partyKind: 'customer', partyId: cust.id },
      { accountCode: '4101', debit: 0, credit: 5000 },
    ] })
    receive(cust.id, 'MANUAL-DEBIT', 5000, 'held')
    expect(S().getCustomerBalance(cust.id)).toBe(10000)
    expect(S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === key)?.settledMinor).toBe(0)
  })

  it('تسوية الرصيد الدائنة تخفض الافتتاحي قبل إسناد الشيك إلى المستخلص', () => {
    const { cust, key } = setupCustomerWithExtract(10000, 10000)
    S().applySettlement({ section: 'customer', refId: cust.id, actualMinor: 10000, reason: 'مطابقة' })
    receive(cust.id, 'SETTLEMENT-THEN-CHEQUE', 10000, 'held')
    expect(S().getCustomerBalance(cust.id)).toBe(0)
    expect(S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === key)?.settledMinor).toBe(10000)
  })

  it('التحصيل على قيد عميل مدين ثم عكسه لا يختفي من رصيد الدفتر', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
      S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل قيد', phone: '', creditLimitMinor: 0, notes: '' })
      const cust = S().customers.at(-1)!
      const entry = S().postManualEntry({ date: '2026-01-01', description: 'دين', lines: [
        { accountCode: '1104', debit: 5000, credit: 0, partyKind: 'customer', partyId: cust.id },
        { accountCode: '4101', debit: 0, credit: 5000 },
      ] })
      const v = S().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: cust.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 5000, description: 'سداد' })
      expect(v.allocations?.[0]?.docKey).toBe(`customer-journal:${entry.id}`)
      vi.setSystemTime(new Date('2026-02-01T12:00:00Z'))
      S().reverseEntry(entry.id, 'تصحيح')
      const project = S().addProject({ nameAr: 'مشروع', clientId: cust.id, clientName: cust.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
      const ex = S().addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
      expect(S().getCustomerBalance(cust.id)).toBe(5000)
      expect(S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === `extract:${ex.id}`)?.settledMinor).toBe(5000)
    } finally { vi.useRealTimers() }
  })

  it('قبض تحت الحساب سابق لمستخلص يُسند تقديرياً إلى أقدم ذمة ولا يضيع من الرصيد', () => {
    S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل مقدم', phone: '', creditLimitMinor: 0, notes: '' })
    const cust = S().customers.at(-1)!
    const voucher = S().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: cust.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 10000, description: 'قبض سابق' })
    expect(voucher.unallocatedMinor).toBe(10000)
    const project = S().addProject({ nameAr: 'مشروع لاحق', clientId: cust.id, clientName: cust.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
    const ex = S().addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
    expect(S().getCustomerBalance(cust.id)).toBe(0)
    expect(S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === `extract:${ex.id}`)?.settledMinor).toBe(10000)
  })

  it('عكس سند تحت الحساب يلغي إسناده التقديري للمستخلص اللاحق', () => {
    S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل مقدم معكوس', phone: '', creditLimitMinor: 0, notes: '' })
    const cust = S().customers.at(-1)!
    const voucher = S().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: cust.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 4000, description: 'قبض سابق' })
    const project = S().addProject({ nameAr: 'مشروع', clientId: cust.id, clientName: cust.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
    const ex = S().addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
    expect(S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === `extract:${ex.id}`)?.settledMinor).toBe(4000)
    S().reverseVoucher(voucher.id, 'تصحيح')
    expect(S().getCustomerBalance(cust.id)).toBe(10000)
    expect(S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === `extract:${ex.id}`)?.settledMinor).toBe(0)
  })

  it('استبدال الولاء يُطفئ الذمة تقديرياً ولا يعكس قيده منفرداً عن سجل الولاء', () => {
    const old = localStorage.getItem('shopsys-app')
    try {
      localStorage.setItem('shopsys-app', JSON.stringify({ state: { loyalty: { enabled: true, redeemValueMinor: 5, minRedeemPoints: 100 } } }))
      const { cust, key } = setupCustomerWithExtract(10000)
      useDataStore.setState({ customers: S().customers.map((c) => c.id === cust.id ? { ...c, loyaltyPoints: 800 } : c) })
      const redemption = S().redeemLoyaltyPoints(cust.id, 800)
      expect(redemption.valueMinor).toBe(4000)
      expect(S().getCustomerBalance(cust.id)).toBe(6000)
      expect(S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === key)?.settledMinor).toBe(4000)
      expect(() => S().reverseEntry(redemption.journalEntryId, 'تصحيح')).toThrow(/الولاء/)
      expect(S().getCustomerBalance(cust.id)).toBe(6000)
    } finally {
      if (old == null) localStorage.removeItem('shopsys-app'); else localStorage.setItem('shopsys-app', old)
    }
  })

  it('تحصيل عميل تحت الحساب سابق للمستخلص يظهر تقديرياً بمصدره', () => {
    S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل تحصيل مقدم', phone: '', creditLimitMinor: 0, notes: '' })
    const cust = S().customers.at(-1)!
    const receipt = S().receiveClientPayment({ customerId: cust.id, treasury: '1101', amountMinor: 3000 })
    expect(receipt.unallocatedMinor).toBe(3000)
    const project = S().addProject({ nameAr: 'مشروع لاحق', clientId: cust.id, clientName: cust.nameAr, contractValueMinor: 3000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
    const ex = S().addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 3000, vatPercent: 0, payment: 'credit' })
    expect(S().getCustomerBalance(cust.id)).toBe(0)
    const doc = S().getOpenClientInvoices(cust.id, true).find((d) => d.docKey === `extract:${ex.id}`)
    expect(doc?.settledMinor).toBe(3000)
    expect(doc?.estimatedReceiptAllocations?.[0]?.number).toBe(receipt.settlementNumber)
  })

  it('بيع سيارة أمانة آجل أقدم يستهلك الشيك قبل مستخلص العميل', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
      S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل أمانة', phone: '', creditLimitMinor: 0, notes: '' })
      const cust = S().customers.at(-1)!
      const car = S().addConsignmentCar({ make: 'سيارة', model: 'أمانة', year: 2023, plateOrVin: 'TEST-1', ownerName: 'المالك', ownerNetMinor: 4000, askingPriceMinor: 5000 })
      S().sellConsignmentCar({ id: car.id, salePriceMinor: 5000, payment: 'credit', buyerCustomerId: cust.id })
      vi.setSystemTime(new Date('2026-02-01T12:00:00Z'))
      const project = S().addProject({ nameAr: 'مشروع', clientId: cust.id, clientName: cust.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-02-01', notes: '' })
      const ex = S().addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
      receive(cust.id, 'CONSIGNMENT-FIRST', 5000, 'held')
      expect(S().getCustomerBalance(cust.id)).toBe(10000)
      expect(S().getOpenClientInvoices(cust.id, true).find(d => d.docKey === `extract:${ex.id}`)?.settledMinor).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('مقدم خطة أقساط على افتتاحي يُراعى قبل توزيع شيك لاحق للمستخلص', () => {
    const { cust, key } = setupCustomerWithExtract(10000, 10000)
    S().createInstallmentPlan({ customerId: cust.id, saleId: null, totalMinor: 10000, downPaymentMinor: 6000, count: 2, intervalMonths: 1, firstDueDate: '2026-12-01', treasury: '1101', notes: '' })
    receive(cust.id, 'INSTALLMENT-DOWN', 10000, 'held')
    expect(S().getCustomerBalance(cust.id)).toBe(4000)
    expect(S().getOpenClientInvoices(cust.id, true).find(d => d.docKey === key)?.settledMinor).toBe(6000)
  })

  it('رصيد مرتجع المغسلة المحصلة يطفئ مستخلص العميل كتسوية غير نقدية', () => {
    const { cust, key } = setupCustomerWithExtract(10000)
    const order = S().openLaundryOrder({ customerId: cust.id, customerName: cust.nameAr, phone: '', promisedAt: '2026-12-01', lines: [{ desc: 'غسيل', service: 'wash', qty: 1, unitPriceMinor: 4000 }], prepaidMinor: 0, notes: '' })
    S().setLaundryStatus(order.id, 'ready')
    S().deliverLaundryOrder({ orderId: order.id })
    S().refundLaundryOrder({ orderId: order.id, amountMinor: 4000, mode: 'customer_credit', reason: 'اختبار' })
    expect(S().getCustomerBalance(cust.id)).toBe(6000)
    const doc = S().getOpenClientInvoices(cust.id, true).find(d => d.docKey === key)
    expect(doc?.settledMinor).toBe(4000)
    expect(doc?.adjustmentAllocations?.[0]?.description).toContain('مغسلة')
  })

  it('هامش ومقدم وسداد أقساط يُراعون مع الشيك دون إطفاء مزدوج', () => {
    const { cust, key } = setupCustomerWithExtract(10000, 10000)
    const plan = S().createInstallmentPlan({ customerId: cust.id, saleId: null, totalMinor: 12000, downPaymentMinor: 6000, interestMinor: 2000, count: 2, intervalMonths: 1, firstDueDate: '2026-12-01', treasury: '1101', notes: '' })
    S().payInstallment(plan.id, 2000, '1101')
    receive(cust.id, 'INSTALLMENT-MIX', 10000, 'held')
    expect(S().getCustomerBalance(cust.id)).toBe(4000)
    const docs = S().getOpenClientInvoices(cust.id, true)
    expect(docs.find(d => d.docKey === key)?.settledMinor).toBe(8000)
    expect(docs.reduce((sum, d) => sum + Math.max(0, d.dueMinor - d.settledMinor), 0)).toBe(4000)
  })

  it('إشعار دائن للمستخلص يخفض ذمته ولا يظهر كشيك أو قبض نقدي', () => {
    const { cust, extract, key } = setupCustomerWithExtract(10000)
    S().refundProjectExtract({ extractId: extract.id, amountMinor: 4000, mode: 'customer_credit', reason: 'تخفيض المستخلص' })
    expect(S().getCustomerBalance(cust.id)).toBe(6000)
    const doc = S().getOpenClientInvoices(cust.id, true).find(d => d.docKey === key)
    expect(doc?.settledMinor).toBe(4000)
    expect(doc?.adjustmentAllocations?.[0]?.description).toContain('إشعار دائن')
  })

  it('ملخص ذمم المشروع يتتبع الرصيد الفعلي قبل الشيك وبعد سداده وارتداده', () => {
    const { cust, project } = setupCustomerWithExtract(10000)
    const balance = () => projectOpenBalances(S().projects, S().projectExtracts, S().getOpenClientInvoices).get(project.id)
    expect(balance()).toBe(10000)
    receive(cust.id, 'BALANCE', 10000, 'deposited')
    expect(balance()).toBe(0)
    const cheque = S().cheques.find((c) => c.chequeNumber === 'BALANCE')!
    S().setChequeStatus(cheque.id, 'bounced')
    expect(balance()).toBe(10000)
  })

  it('⑤ الفائض عن الذمم يبقى غير موزَّع ولا يُنشئ رصيداً سالباً', () => {
    const { cust, key } = setupCustomerWithExtract(100_000_00)
    receive(cust.id, 'CH-9005', 900_000_00, 'collected')
    const doc = S().getOpenClientInvoices(cust.id).find((d) => d.docKey === key)
    // المستند يُطفأ بالكامل فيُستبعد من «المفتوح»، ولا يظهر رصيد سالب
    expect(doc).toBeUndefined()
    const result = allocateChequeDues(S().cheques, cust.id, [{
      docKey: key, docLabel: 'مستخلص', dueMinor: 100_000_00, settledMinor: 0, date: '2026-01-01',
    }])
    expect(result.allocations[0]?.appliedMinor).toBe(100_000_00)
    expect(result.unallocatedMinor).toBe(800_000_00)
  })
})

const mk = (over: Partial<ChequeDuesLike>): ChequeDuesLike => ({
  direction: 'incoming', partyId: 1, status: 'collected', amountMinor: 100, createdAt: '2026-01-01', ...over,
})

describe('نواة chequeDues — قواعد الأهلية والتوزيع', () => {
  it('الأهلية: وارد نشط فقط، والمرتد/الملغي/الصادر/بلا طرف مستثنى', () => {
    expect(chequeSettlesCustomerDues(mk({}))).toBe(true)
    expect(chequeSettlesCustomerDues(mk({ status: 'held' }))).toBe(true)
    expect(chequeSettlesCustomerDues(mk({ status: 'deposited' }))).toBe(true)
    for (const status of ['bounced', 'cancelled']) expect(chequeSettlesCustomerDues(mk({ status }))).toBe(false)
    expect(chequeSettlesCustomerDues(mk({ direction: 'outgoing' }))).toBe(false)
    expect(chequeSettlesCustomerDues(mk({ partyId: null }))).toBe(false)
    expect(chequeSettlesCustomerDues(mk({ amountMinor: 0 }))).toBe(false)
    expect(chequeSettlesCustomerDues(mk({ amountMinor: 1.5 }))).toBe(false)
  })

  it('الإجمالي يجمع النشط لعميل بعينه فقط', () => {
    const list = [mk({ amountMinor: 100 }), mk({ amountMinor: 50, status: 'held' }), mk({ amountMinor: 999, status: 'bounced' }), mk({ amountMinor: 999, partyId: 2 })]
    expect(activeIncomingChequesTotal(list, 1)).toBe(150)
    expect(activeIncomingChequesTotal(list, 2)).toBe(999)
    expect(activeIncomingChequesTotal(list, 3)).toBe(0)
  })

  it('FIFO: الأقدم أولاً مع كسر تعادل حتمي بالمفتاح، واحترام المحصَّل سابقاً', () => {
    const cheques = [mk({ amountMinor: 350 })]
    const docs = [
      { docKey: 'sale:2', docLabel: 'ب', dueMinor: 200, settledMinor: 50, date: '2026-02-01' },
      { docKey: 'sale:1', docLabel: 'أ', dueMinor: 200, settledMinor: 0, date: '2026-01-01' },
      { docKey: 'sale:3', docLabel: 'ج', dueMinor: 200, settledMinor: 0, date: '2026-03-01' },
    ]
    const r = allocateChequeDues(cheques, 1, docs)
    expect(r.allocations.map((a) => [a.docKey, a.appliedMinor])).toEqual([
      ['sale:1', 200], ['sale:2', 150],
    ])
    expect(r.unallocatedMinor).toBe(0)
  })
})
