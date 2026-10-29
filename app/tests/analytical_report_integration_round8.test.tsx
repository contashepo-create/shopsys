import { afterEach, beforeEach, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { AnalyticalProjectReportView } from '../src/ui/contracting/AnalyticalProjectReportView.tsx'
import { useDataStore, EMPTY_EXTENDED, type DataState } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { getCountry } from '../src/core/countries.ts'
import { formatMinor } from '../src/core/money.ts'

const original = useDataStore.getState()
const appOriginal = useAppStore.getState()
beforeEach(() => {
  useDataStore.setState({ ...original, customers: [], projects: [], projectExtracts: [], projectCosts: [], purchases: [], purchaseReturns: [], journal: [] })
  useAppStore.setState({ ...appOriginal, setup: { ...appOriginal.setup, countryCode: 'EG', vatPercent: 0, allowNegativeTreasury: true } })
})
afterEach(() => { cleanup(); useDataStore.setState(original); useAppStore.setState(appOriginal) })

it('سجل مرتجع افتراضي/مستورد يُعرض في التقرير ويتحدث عند إضافته', () => {
  const store = useDataStore.getState()
  store.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const project = useDataStore.getState().addProject({ nameAr: 'مشروع', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  useDataStore.getState().addProjectCost({ projectId: project.id, kind: 'materials', amountMinor: 1000, payment: 'cash', description: 'مواد', treasury: '1101' })
  const currency = getCountry('EG')!.currency
  const total = () => screen.getAllByText('إجمالي المصروفات')[0].parentElement?.textContent
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(total()).toContain(formatMinor(1000, currency, false))
  act(() => useDataStore.setState({
    purchases: [{ id: 999, projectId: project.id }] as DataState['purchases'],
    purchaseReturns: [{ purchaseId: 999, returnNumber: 'R-1', totalMinor: 300, date: '2026-01-03' }] as DataState['purchaseReturns'],
  }))
  expect(total()).toContain(formatMinor(700, currency, false))
  expect(screen.getByText('مرتجع مشتريات المشروع')).toBeTruthy()
})


it('لا يُضاف سند موزّع خطأً على مستخلص نقدي كتحصيل ثانٍ', () => {
  useDataStore.getState().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const project = useDataStore.getState().addProject({ nameAr: 'مشروع نقدي', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = useDataStore.getState().addProjectExtract({ projectId: project.id, description: 'نقدي', grossMinor: 1000, vatPercent: 0, payment: 'cash' })
  useDataStore.setState({ vouchers: [{ kind: 'receipt', partyKind: 'customer', partyId: customer.id, date: '2026-01-01', voucherNumber: 'WRONG', amountMinor: 500, allocations: [{ docKey: `extract:${extract.id}`, appliedMinor: 500 }] }] as DataState['vouchers'] })
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(screen.queryByText('WRONG')).toBeNull()
  expect(screen.queryByText(/تنبيه مراجعة: مجموع سطور التحصيلات/)).toBeNull()
})


it('ترحيل مرتجع مخزني لفاتورة مربوطة بمشروع مرفوض في المسار الحالي', () => {
  useDataStore.setState({ purchases: [{ id: 999, projectId: 1 }] as DataState['purchases'] })
  expect(() => useDataStore.getState().postPurchaseReturn({ purchaseId: 999, qtyByItem: new Map(), refund: 'cash', reason: 'اختبار', __approvalBypass: true } as never))
    .toThrow('فاتورة مشروع مقاولات')
})

it('مقاصة الطرف تظهر تسوية غير نقدية ولا تُنسب لشيك في تقرير المشروع', () => {
  useDataStore.getState().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل مقاصة', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  useDataStore.getState().addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد مقاصة', phone: '', notes: '' })
  const supplier = useDataStore.getState().suppliers.at(-1)!
  useDataStore.getState().setOpeningBalance({ kind: 'supplier', refId: supplier.id, amountMinor: 10000, label: supplier.nameAr })
  const project = useDataStore.getState().addProject({ nameAr: 'مشروع مقاصة', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  useDataStore.getState().addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  const offset = useDataStore.getState().postPartyOffset({ customerId: customer.id, supplierId: supplier.id, amountMinor: 4000 })
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(screen.getByText(offset.offsetNumber)).toBeTruthy()
  expect(screen.getByText('مقاصة الطرف (توزيع تقديري)')).toBeTruthy()
  expect(screen.queryByText(/تنبيه مراجعة: مجموع سطور التحصيلات/)).toBeNull()
})

it('مقاصة وشيك على المستخلص يظلان سطرين منفصلين بلا تحصيل مزدوج', () => {
  useDataStore.getState().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل مزدوج', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  useDataStore.getState().addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد مزدوج', phone: '', notes: '' })
  const supplier = useDataStore.getState().suppliers.at(-1)!
  useDataStore.getState().setOpeningBalance({ kind: 'supplier', refId: supplier.id, amountMinor: 10000, label: supplier.nameAr })
  const project = useDataStore.getState().addProject({ nameAr: 'مشروع مزدوج', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  useDataStore.getState().addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  const offset = useDataStore.getState().postPartyOffset({ customerId: customer.id, supplierId: supplier.id, amountMinor: 4000 })
  useDataStore.getState().receiveCheque({ chequeNumber: 'OFFSET-CHEQUE', partyId: customer.id, bankName: 'بنك', amountMinor: 3000, dueDate: '2026-11-01', notes: '' })
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(screen.getByText(offset.offsetNumber)).toBeTruthy()
  expect(screen.getByText('مقاصة الطرف (توزيع تقديري)')).toBeTruthy()
  expect(screen.getByText('OFFSET-CHEQUE')).toBeTruthy()
  expect(screen.queryByText(/تنبيه مراجعة: مجموع سطور التحصيلات/)).toBeNull()
  const ledger = useDataStore.getState().getOpenClientInvoices(customer.id, true)
  expect(ledger.find((doc) => doc.docKey.startsWith('extract:'))?.settledMinor).toBe(7000)
})

it('القيد الدائن الموزّع تقديرياً يظهر تسوية غير نقدية لا شيكاً', () => {
  useDataStore.getState().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل قيد', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const project = useDataStore.getState().addProject({ nameAr: 'مشروع قيد', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  useDataStore.getState().addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  const entry = useDataStore.getState().postManualEntry({ date: '2026-01-01', description: 'تخفيض', lines: [
    { accountCode: '5108', debit: 4000, credit: 0 },
    { accountCode: '1104', debit: 0, credit: 4000, partyKind: 'customer', partyId: customer.id },
  ] })
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(screen.getByText(`#${entry.entryNumber}`)).toBeTruthy()
  expect(screen.getByText('قيد دائن للعميل (توزيع تقديري)')).toBeTruthy()
  expect(screen.queryByText(/تنبيه مراجعة: مجموع سطور التحصيلات/)).toBeNull()
})

it('قبض تحت الحساب وشيك يُعرضان منفصلين دون احتساب مزدوج', () => {
  useDataStore.getState().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل مقدم', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const voucher = useDataStore.getState().postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 4000, description: 'مقدم نقدي' })
  const project = useDataStore.getState().addProject({ nameAr: 'مشروع مقدم', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  useDataStore.getState().addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  useDataStore.getState().receiveCheque({ chequeNumber: 'PRE-CHEQUE', bankName: 'بنك', partyId: customer.id, partyName: customer.nameAr, amountMinor: 3000, dueDate: '2026-02-01', notes: '' })
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(screen.getByText(voucher.voucherNumber)).toBeTruthy()
  expect(screen.getByText('سند تحت الحساب (توزيع تقديري)')).toBeTruthy()
  expect(screen.getByText('PRE-CHEQUE')).toBeTruthy()
  expect(screen.queryByText(/تنبيه مراجعة: مجموع سطور التحصيلات/)).toBeNull()
})

it('مقدم خطة التقسيط والشيك يظهران بمصدرين في تقرير المستخلص بلا مضاعفة', () => {
  useDataStore.getState().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل أقساط المشروع', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const project = useDataStore.getState().addProject({ nameAr: 'مشروع أقساط', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  useDataStore.getState().addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  const plan = useDataStore.getState().createInstallmentPlan({ customerId: customer.id, saleId: null, totalMinor: 10000, downPaymentMinor: 3000, count: 2, intervalMonths: 1, firstDueDate: '2026-12-01', treasury: '1101', notes: '' })
  useDataStore.getState().receiveCheque({ chequeNumber: 'INST-CHEQUE', bankName: 'بنك', partyId: customer.id, amountMinor: 2000, dueDate: '2026-12-01', notes: '' })
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(screen.getByText(plan.planNumber)).toBeTruthy()
  expect(screen.getByText('مقدم خطة تقسيط (توزيع تقديري)')).toBeTruthy()
  expect(screen.getByText('INST-CHEQUE')).toBeTruthy()
  expect(screen.queryByText(/تنبيه مراجعة: مجموع سطور التحصيلات/)).toBeNull()
})

it('إشعار مستخلص دائن يخفض الإيراد والمستحق دون احتسابه تحصيلاً', () => {
  useDataStore.getState().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل إشعار', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const project = useDataStore.getState().addProject({ nameAr: 'مشروع إشعار', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = useDataStore.getState().addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  useDataStore.getState().refundProjectExtract({ extractId: extract.id, amountMinor: 4000, mode: 'customer_credit', reason: 'تصحيح قيمة' })
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(useDataStore.getState().getCustomerBalance(customer.id)).toBe(6000)
  expect(screen.queryByText('إشعار دائن مستخلص (إطفاء غير نقدي)')).toBeNull()
  expect(indicator('قيمة الأعمال المستخلصة')).toBe(amount(6000))
  expect(indicator('صافي المستحق على المستخلصات')).toBe(amount(6000))
  expect(indicator('إجمالي ما تم تحصيله')).toBe(amount(0))
  expect(indicator('المتبقي من التحصيل')).toBe(amount(6000))
  expect(indicator('صافي نتيجة المشروع حتى تاريخه')).toBe(amount(6000))
})


const amount = (n: number) => formatMinor(n, getCountry('EG')!.currency, false)
const indicator = (label: string) => screen.getAllByText(label)[0].parentElement?.lastElementChild?.textContent

it('مستخلص نقدي بضريبة ورد نقدي يعكس الإيراد والضريبة والنقد المحصل مرة واحدة', () => {
  const project = useDataStore.getState().addProject({ nameAr: 'نقد وضريبة', clientId: null, clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = useDataStore.getState().addProjectExtract({ projectId: project.id, description: 'نقد', grossMinor: 10000, vatPercent: 15, payment: 'cash' })
  useDataStore.getState().refundProjectExtract({ extractId: extract.id, amountMinor: 4600, mode: 'cash', reason: 'رد', treasury: '1101' })
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(indicator('قيمة الأعمال المستخلصة')).toBe(amount(6000))
  expect(indicator('ض.ق.م محمّلة على العميل')).toBe(amount(900))
  expect(indicator('صافي المستحق على المستخلصات')).toBe(amount(6900))
  expect(indicator('إجمالي ما تم تحصيله')).toBe(amount(6900))
  expect(indicator('المتبقي من التحصيل')).toBe(amount(0))
  expect(indicator('صافي نتيجة المشروع حتى تاريخه')).toBe(amount(6000))
  expect(screen.getByText('رد نقدي على مستخلص')).toBeTruthy()
  expect(screen.queryByText(/تنبيه مراجعة: مجموع سطور التحصيلات/)).toBeNull()
})

it('فائض إشعار مستخلص مسدد يطفئ مشروعاً آخر دون خفض إيراده أو مضاعفة التحصيل', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل مشروعين', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const p1 = s.addProject({ nameAr: 'الأول', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const p2 = s.addProject({ nameAr: 'الثاني', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 5000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = s.addProjectExtract({ projectId: p1.id, description: 'أول', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  s.addProjectExtract({ projectId: p2.id, description: 'ثان', grossMinor: 5000, vatPercent: 0, payment: 'credit' })
  s.postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 8000, description: 'قبض' })
  s.refundProjectExtract({ extractId: extract.id, amountMinor: 4000, mode: 'customer_credit', reason: 'إشعار' })
  const view = render(<AnalyticalProjectReportView projectId={String(p1.id)} onProjectChange={() => {}} />)
  expect(indicator('قيمة الأعمال المستخلصة')).toBe(amount(6000))
  expect(indicator('إجمالي ما تم تحصيله')).toBe(amount(8000))
  expect(indicator('المتبقي من التحصيل')).toBe(amount(0))
  expect(screen.getByText(/قد يمثل الفائض رصيداً دائناً/)).toBeTruthy()
  view.rerender(<AnalyticalProjectReportView projectId={String(p2.id)} onProjectChange={() => {}} />)
  expect(indicator('قيمة الأعمال المستخلصة')).toBe(amount(5000))
  expect(indicator('صافي المستحق على المستخلصات')).toBe(amount(5000))
  expect(indicator('إجمالي ما تم تحصيله')).toBe(amount(2000))
  expect(indicator('المتبقي من التحصيل')).toBe(amount(3000))
  expect(screen.getByText('إشعار دائن مستخلص (إطفاء غير نقدي)')).toBeTruthy()
})

it('سجل إشعار تاريخي ناقص يحجب النتيجة وينبه بدل تخمين طريقة الرد', () => {
  const s = useDataStore.getState()
  const project = s.addProject({ nameAr: 'قديم', clientId: null, clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = s.addProjectExtract({ projectId: project.id, description: 'نقد', grossMinor: 10000, vatPercent: 0, payment: 'cash' })
  useDataStore.setState({ projectExtracts: useDataStore.getState().projectExtracts.map(e => e.id === extract.id ? { ...e, refundedMinor: 4000, refundedTaxMinor: 0 } : e) })
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(screen.getByText(/سجلات إشعارات المستخلصات ناقصة/)).toBeTruthy()
  for (const label of ['صافي نتيجة المشروع حتى تاريخه', 'قيمة الأعمال المستخلصة', 'صافي المستحق على المستخلصات', 'إجمالي ما تم تحصيله', 'المتبقي من التحصيل', 'نسبة التحصيل']) {
    expect(indicator(label)).toBe('تتطلب مراجعة إشعارات المستخلصات')
  }
})

it('مقاصة مقدمة وإشعار دائن وضريبة تخفض الإيراد والذمة دون احتساب الإشعار تحصيلاً', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل مقاصة ورد', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  s.addSupplier({ ...EMPTY_EXTENDED, nameAr: 'مورد مقاصة ورد', phone: '', notes: '' })
  const supplier = useDataStore.getState().suppliers.at(-1)!
  s.setOpeningBalance({ kind: 'supplier', refId: supplier.id, amountMinor: 3000, label: supplier.nameAr })
  const project = s.addProject({ nameAr: 'مقاصة ورد', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = s.addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 15, payment: 'credit' })
  s.postPartyOffset({ customerId: customer.id, supplierId: supplier.id, amountMinor: 3000 })
  s.refundProjectExtract({ extractId: extract.id, amountMinor: 4600, mode: 'customer_credit', reason: 'تصحيح' })
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(indicator('قيمة الأعمال المستخلصة')).toBe(amount(6000))
  expect(indicator('صافي المستحق على المستخلصات')).toBe(amount(6900))
  expect(indicator('إجمالي ما تم تحصيله')).toBe(amount(3000))
  expect(indicator('المتبقي من التحصيل')).toBe(amount(3900))
  expect(s.getCustomerBalance(customer.id)).toBe(3900)
  expect(screen.queryByText(/تنبيه مراجعة: مجموع سطور التحصيلات/)).toBeNull()
})

it('بطاقة عميل المقاولات تفصل الإشعار الدائن عن المحصّل وتعرض صافي المستحق', async () => {
  const { ContractingReportsPage } = await import('../src/ui/pages/ContractingReportsPage.tsx')
  const { fireEvent, within } = await import('@testing-library/react')
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل كشف الإشعار', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const project = s.addProject({ nameAr: 'مشروع كشف الإشعار', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = s.addProjectExtract({ projectId: project.id, description: 'مستخلص', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  s.refundProjectExtract({ extractId: extract.id, amountMinor: 4000, mode: 'customer_credit', reason: 'إشعار' })
  render(<ContractingReportsPage />)
  fireEvent.click(screen.getAllByText('عميل بعينه')[0])
  fireEvent.change(screen.getByTestId('client-select'), { target: { value: String(customer.id) } })
  const row = screen.getAllByText(extract.extractNumber).map(el => el.closest('tr')).find(el => el && within(el).queryByText(amount(4000)))
  expect(row).toBeUndefined()
  const detail = screen.getAllByText(extract.extractNumber).map(el => el.closest('tr')).find(el => el && el.children.length === 8)!
  expect([...detail.children].slice(3).map(el => el.textContent)).toEqual([amount(6000), amount(0), amount(6000), amount(0), amount(6000)])
})


it('تقرير مستخلص نقدي يحجب أرقام الإشعار إذا فُقد قيده', () => {
  const s = useDataStore.getState()
  const project = s.addProject({ nameAr: 'مشروع نقدي', clientId: null, clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = s.addProjectExtract({ projectId: project.id, description: 'نقدي', grossMinor: 10000, vatPercent: 0, payment: 'cash' })
  const updated = s.refundProjectExtract({ extractId: extract.id, amountMinor: 4000, mode: 'cash', reason: 'رد', treasury: '1101' })
  const id = updated.refunds!.at(-1)!.journalEntryId
  useDataStore.setState({ journal: useDataStore.getState().journal.filter(entry => entry.id !== id) })
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(screen.getByText(/سجلات إشعارات المستخلصات ناقصة/)).toBeTruthy()
  expect(indicator('صافي نتيجة المشروع حتى تاريخه')).toBe('تتطلب مراجعة إشعارات المستخلصات')
  expect(indicator('إجمالي ما تم تحصيله')).toBe('تتطلب مراجعة إشعارات المستخلصات')
})

it('تقرير مشروع بلا عميل يحجب الأرصدة عندما يفقد المستخلص قيده الأصلي', () => {
  const s = useDataStore.getState()
  const project = s.addProject({ nameAr: 'مشروع بلا ربط', clientName: 'جهة', contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = s.addProjectExtract({ projectId: project.id, description: 'نقدي', grossMinor: 10000, vatPercent: 0, payment: 'cash' })
  useDataStore.setState({ journal: useDataStore.getState().journal.filter(e => e.id !== extract.journalEntryId) })
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(screen.getAllByText('تتطلب مراجعة قيود المستخلصات الأصلية').length).toBeGreaterThan(0)
  expect(screen.getByText(/قيد مستخلص أصلي مفقود أو غير مطابق/)).toBeTruthy()
})

it('المستخلص الآجل التاريخي بلا عميل يحجب إجمالي التحصيل والمتبقي بدلاً من افتراض عدم السداد', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'جهة قديمة', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const project = s.addProject({ nameAr: 'مشروع قديم بلا ربط', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  s.addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 8000, vatPercent: 0, payment: 'credit' })
  useDataStore.setState({ projects: useDataStore.getState().projects.map(p => p.id === project.id ? { ...p, clientId: null } : p) })
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(screen.getAllByText('تتطلب مراجعة ربط العميل والتحصيلات').length).toBeGreaterThan(0)
  expect(screen.getByText(/لا يمكن تحديد التحصيل والمتبقي/)).toBeTruthy()
})

it('المستخلص الآجل الذي يشير إلى عميل محذوف لا يُعرض تحصيله كصفر مؤكد', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل محذوف', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const project = s.addProject({ nameAr: 'مشروع مفقود العميل', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  s.addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 8000, vatPercent: 0, payment: 'credit' })
  useDataStore.setState({ customers: [] })
  render(<AnalyticalProjectReportView projectId={String(project.id)} onProjectChange={() => {}} />)
  expect(screen.getAllByText('تتطلب مراجعة ربط العميل والتحصيلات').length).toBeGreaterThan(0)
})
