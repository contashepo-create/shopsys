/**
 * بلاغ المالك 2026-10-27: «حصّلتُ شيكاً من عميل فظهر في كشف حسابه لكن لم
 * يظهر خصمه في تقارير المشاريع». الاختبار يثبت ربط الدفترين ويمنع عودة العطب.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore, EMPTY_EXTENDED, type DataState } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import {
  activeIncomingChequesTotal, allocateChequeDues, chequeSettlesCustomerDues,
  type ChequeDuesLike,
} from '../src/core/chequeDues.ts'
import type { ChequeStatus } from '../src/core/cheques.ts'

const original = useDataStore.getState()
const S = () => useDataStore.getState()

function setupCustomerWithExtract(amountMinor = 1_000_000_00) {
  S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'شركة النيل للمقاولات', phone: '01000000000', creditLimitMinor: 0, notes: '' })
  const cust = S().customers.at(-1)!
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
      vouchers: [], clientSettlements: [], journal: [], saleReturns: [], sales: [],
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
