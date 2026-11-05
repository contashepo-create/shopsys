import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useDataStore.getState()
const app = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useDataStore.setState({ ...original, customers: [], projects: [], projectExtracts: [], journal: [], vouchers: [], clientSettlements: [], cheques: [], openingBalances: {}, insuranceClaims: [], clinicPatients: [], labPatients: [] })
})
function setup(limit = 0) {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل تعديل', phone: '', creditLimitMinor: limit, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const project = s.addProject({ nameAr: 'تعديل', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 20000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = s.addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 8000, vatPercent: 0, payment: 'credit' })
  return { s, customer, project, extract }
}
const edit = (s: ReturnType<typeof useDataStore.getState>, id: number, gross: number, payment: 'cash' | 'credit' = 'credit') =>
  s.editProjectExtract({ extractId: id, grossMinor: gross, vatPercent: 0, payment, description: 'تعديل', reason: 'تصحيح' })

it('لا يعدل مستخلصاً تحصيله موزع صراحة بسند قبض حفاظاً على التوزيع', () => {
  const { s, customer, extract } = setup()
  const voucher = s.postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 6000, description: 'قبض' })
  expect(voucher.allocations?.some(a => a.docKey === `extract:${extract.id}`)).toBe(true)
  const before = useDataStore.getState()
  expect(() => edit(s, extract.id, 4000)).toThrow(/تحصيل|توزيع/)
  expect(useDataStore.getState().journal).toBe(before.journal)
  expect(useDataStore.getState().projectExtracts).toBe(before.projectExtracts)
})

it('لا يحوّل مستخلصاً تحصيله موزع صراحة إلى نقدي', () => {
  const { s, customer, extract } = setup()
  const payment = s.receiveClientPayment({ customerId: customer.id, amountMinor: 3000, treasury: '1101' })
  expect(payment.allocations.some(a => a.docKey === `extract:${extract.id}`)).toBe(true)
  const before = useDataStore.getState()
  expect(() => edit(s, extract.id, 8000, 'cash')).toThrow(/تحصيل|توزيع/)
  expect(useDataStore.getState().journal).toBe(before.journal)
})

it('حد ائتمان التعديل يقارن الزيادة فقط ولا يجمع المستخلص القديم والجديد', () => {
  const { s, customer, extract } = setup(10000)
  expect(s.getCustomerBalance(customer.id)).toBe(8000)
  expect(() => edit(s, extract.id, 7000)).not.toThrow()
  expect(s.getCustomerBalance(customer.id)).toBe(7000)
  expect(() => edit(s, extract.id, 11000)).toThrow(/ائتمان/)
  expect(s.getCustomerBalance(customer.id)).toBe(7000)
})

it('يرفض تعديل أو رد مستخلص عندما يشير قيده الأصلي إلى مستند آخر', () => {
  const { s, extract } = setup()
  useDataStore.setState({ journal: useDataStore.getState().journal.map(e => e.id === extract.journalEntryId ? { ...e, sourceId: extract.id + 99 } : e) })
  const before = useDataStore.getState()
  expect(() => edit(s, extract.id, 7000)).toThrow(/مراجعة/)
  expect(() => s.refundProjectExtract({ extractId: extract.id, amountMinor: 1000, mode: 'customer_credit', reason: 'رد' })).toThrow(/مراجعة/)
  expect(useDataStore.getState().journal).toBe(before.journal)
})

it('يسمح بالتعديل بعد عكس سند التحصيل المرتبط', () => {
  const { s, customer, extract } = setup()
  const voucher = s.postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 3000, description: 'قبض' })
  s.reverseVoucher(voucher.id, 'تصحيح')
  expect(() => edit(s, extract.id, 7000)).not.toThrow()
  expect(s.getCustomerBalance(customer.id)).toBe(7000)
})

it('زيادة التعديل داخل حد الائتمان تقبل والزيادة فوقه ترفض بلا قيود', () => {
  const { s, customer, extract } = setup(10000)
  edit(s, extract.id, 9500)
  expect(s.getCustomerBalance(customer.id)).toBe(9500)
  const before = useDataStore.getState()
  expect(() => edit(s, extract.id, 11000)).toThrow(/ائتمان/)
  expect(useDataStore.getState().journal).toBe(before.journal)
  expect(s.getCustomerBalance(customer.id)).toBe(9500)
})

it('التحويل من نقدي إلى آجل يحسب الذمة الجديدة كاملة في حد الائتمان', () => {
  const { s, customer, extract } = setup(10000)
  edit(s, extract.id, 8000, 'cash')
  expect(s.getCustomerBalance(customer.id)).toBe(0)
  const before = useDataStore.getState()
  expect(() => edit(s, extract.id, 11000, 'credit')).toThrow(/ائتمان/)
  expect(useDataStore.getState().journal).toBe(before.journal)
  edit(s, extract.id, 9000, 'credit')
  expect(s.getCustomerBalance(customer.id)).toBe(9000)
})

it('يرفض تعديل المستخلص وردّه عند فقد القيد أو اختلال قيم الإيراد أو الذمة', () => {
  const { s, extract } = setup()
  const journal = useDataStore.getState().journal
  const originalEntry = journal.find(e => e.id === extract.journalEntryId)!
  const altered = originalEntry.lines.map(l => l.accountCode === '4107' ? { ...l, credit: 7000 } : l.accountCode === '1104' ? { ...l, debit: 7000 } : l)
  for (const next of [journal.filter(e => e.id !== originalEntry.id), journal.map(e => e.id === originalEntry.id ? { ...e, lines: altered } : e)]) {
    useDataStore.setState({ journal: next })
    const before = useDataStore.getState()
    expect(() => edit(s, extract.id, 7000)).toThrow(/مراجعة/)
    expect(() => s.refundProjectExtract({ extractId: extract.id, amountMinor: 1000, mode: 'customer_credit', reason: 'رد' })).toThrow(/مراجعة/)
    expect(useDataStore.getState().journal).toBe(before.journal)
  }
})

it('فقد قيد المستخلص الأصلي يحجب كشف العميل والذمم والتحصيل بدلاً من اعتماد دين بلا قيد', () => {
  const { s, customer, extract, project } = setup()
  useDataStore.setState({ journal: useDataStore.getState().journal.filter(e => e.id !== extract.journalEntryId) })
  const before = useDataStore.getState()
  expect(() => s.getCustomerBalance(customer.id)).toThrow(/مراجعة/)
  expect(() => s.getOpenClientInvoices(customer.id, true)).toThrow(/مراجعة/)
  expect(() => s.getProjectProfit(project.id)).toThrow(/مراجعة/)
  expect(() => s.receiveClientPayment({ customerId: customer.id, amountMinor: 1000, treasury: '1101' })).toThrow(/مراجعة/)
  expect(useDataStore.getState().journal).toBe(before.journal)
})

it('لا ينقل عميل المشروع بعد مستخلص لأن ذلك ينقل ذمته دون نقل تحصيله', () => {
  const { s, customer, project } = setup()
  s.receiveClientPayment({ customerId: customer.id, amountMinor: 3000, treasury: '1101' })
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل آخر', phone: '', creditLimitMinor: 0, notes: '' })
  const other = useDataStore.getState().customers.at(-1)!
  const before = useDataStore.getState()
  expect(() => s.updateProject(project.id, { clientId: other.id })).toThrow(/عميل|مستخلص/)
  expect(useDataStore.getState().projects).toBe(before.projects)
  expect(s.getCustomerBalance(customer.id)).toBe(5000)
  expect(s.getCustomerBalance(other.id)).toBe(0)
})

it('يسمح بتغيير عميل مشروع لم يصدر مستخلصاً أو يقبض دفعة مقدمة', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل جديد', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const p = s.addProject({ nameAr: 'مشروع جديد', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  expect(() => s.updateProject(p.id, { clientId: customer.id })).not.toThrow()
  s.receiveClientAdvance({ projectId: p.id, amountMinor: 1000, treasury: '1101' })
  const before = useDataStore.getState()
  expect(() => s.updateProject(p.id, { clientId: null })).toThrow(/العميل|دفعة/)
  expect(useDataStore.getState().projects).toBe(before.projects)
  expect(() => s.updateProject(p.id, { notes: 'تعديل إداري', clientId: customer.id })).not.toThrow()
})

it('يسمح بالتعديل عند توزيع تقديري للشيك ويعيد حسابه على القيمة الجديدة', () => {
  const { s, customer, extract } = setup()
  s.receiveCheque({ chequeNumber: 'EDIT-CH', partyId: customer.id, bankName: 'بنك', amountMinor: 3000, dueDate: '2026-11-01', notes: '' })
  edit(s, extract.id, 7000)
  expect(s.getCustomerBalance(customer.id)).toBe(4000)
  const doc = s.getOpenClientInvoices(customer.id, true).find(d => d.docKey === `extract:${extract.id}`)!
  expect(doc.settledMinor).toBe(3000)
  expect(doc.dueMinor - doc.settledMinor).toBe(4000)
})

it('تحصيل مستخلص آخر لا يمنع تعديل المستخلص غير الموزع', () => {
  const { s, customer, project, extract } = setup()
  const other = s.addProjectExtract({ projectId: project.id, description: 'آخر', grossMinor: 8000, vatPercent: 0, payment: 'credit' })
  s.receiveClientPayment({ customerId: customer.id, amountMinor: 3000, treasury: '1101', specificDocKey: `extract:${other.id}` })
  expect(() => edit(s, extract.id, 7000)).not.toThrow()
  expect(() => edit(s, other.id, 7000)).toThrow(/تحصيل|توزيع/)
  expect(s.getCustomerBalance(customer.id)).toBe(12000)
})

it('لا يُنشئ ذمة مستخلص آجل بلا عميل مرتبط حتى لا يبقى رصيد 1104 بلا صاحب', () => {
  const s = useDataStore.getState()
  const project = s.addProject({ nameAr: 'مشروع بلا عميل', clientName: 'جهة', contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const before = useDataStore.getState()
  expect(() => s.addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 8000, vatPercent: 0, payment: 'credit' })).toThrow(/عميل/)
  expect(useDataStore.getState().journal).toBe(before.journal)
  expect(useDataStore.getState().projectExtracts).toBe(before.projectExtracts)
  expect(() => s.addProjectExtract({ projectId: project.id, description: 'نقدي', grossMinor: 8000, vatPercent: 0, payment: 'cash' })).not.toThrow()
})

it('لا يزيد ذمة مشروع قديم بلا عميل ولا ينشئ رصيد رد بلا صاحب', () => {
  const { s, extract, project } = setup()
  useDataStore.setState({ projects: useDataStore.getState().projects.map(p => p.id === project.id ? { ...p, clientId: null } : p) })
  const before = useDataStore.getState()
  expect(() => edit(s, extract.id, 9000)).toThrow(/عميل/)
  expect(() => s.refundProjectExtract({ extractId: extract.id, amountMinor: 1000, mode: 'customer_credit', reason: 'رد' })).toThrow(/عميل/)
  expect(useDataStore.getState().journal).toBe(before.journal)
  expect(useDataStore.getState().projectExtracts).toBe(before.projectExtracts)
})

it('يسمح بمستخلص بلا عميل إذا استردت الدفعة المقدمة كامل المستحق بلا ذمة 1104', () => {
  const s = useDataStore.getState()
  const project = s.addProject({ nameAr: 'مشروع بدفعة مقدمة', clientName: 'جهة', contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  s.receiveClientAdvance({ projectId: project.id, amountMinor: 8000, treasury: '1101' })
  const extract = s.addProjectExtract({ projectId: project.id, description: 'استرداد كامل', grossMinor: 8000, vatPercent: 0, payment: 'credit', advanceRecoveryMinor: 8000 })
  const entry = useDataStore.getState().journal.find(e => e.id === extract.journalEntryId)!
  expect(entry.lines.some(l => l.accountCode === '1104' && l.debit > 0)).toBe(false)
  expect(s.getAdvanceBalance(project.id)).toBe(0)
})

it('يرفض قيم استرداد دفعة مقدمة سالبة أو كسرية أو غير رقمية قبل إصدار أو تعديل مستخلص', () => {
  const { s, project, extract } = setup()
  for (const recovery of [-1, 0.5, Number.NaN]) {
    const before = useDataStore.getState()
    expect(() => s.addProjectExtract({ projectId: project.id, description: 'خطأ', grossMinor: 1000, vatPercent: 0, payment: 'credit', advanceRecoveryMinor: recovery })).toThrow(/استرداد/)
    expect(() => s.editProjectExtract({ extractId: extract.id, grossMinor: 7000, vatPercent: 0, payment: 'credit', advanceRecoveryMinor: recovery, description: 'خطأ', reason: 'تصحيح' })).toThrow(/استرداد/)
    expect(useDataStore.getState().journal).toBe(before.journal)
    expect(useDataStore.getState().projectExtracts).toBe(before.projectExtracts)
  }
})
