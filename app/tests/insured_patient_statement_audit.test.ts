import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useDataStore.getState()
const app = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useDataStore.setState({ ...original, customers: [], clinicPatients: [], clinicVisits: [], clinicCollections: [], labPatients: [], labTests: [], labOrders: [], insuranceProviders: [], insuranceClaims: [], projects: [], projectExtracts: [], journal: [], vouchers: [], clientSettlements: [], cheques: [], openingBalances: {} })
})

it('طلب معمل مؤمن لا يُحمّل العميل مطالبة التأمين ومرتجعه الدائن يأخذ نصيب العميل فقط', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل المعمل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const patient = s.addLabPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', notes: '', linkedCustomerId: customer.id })
  const test = s.addLabTest({ code: 'LAB-A', nameAr: 'تحليل', category: 'كيمياء', sampleType: 'دم', unit: '', priceMinor: 10000, costMinor: 0, refRanges: [] })
  const insurer = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
  const order = s.registerInsuredLabOrder({ patientId: patient.id, testIds: [test.id], providerId: insurer.id, referrerId: null, vatPercent: 0 })
  expect(s.getCustomerBalance(customer.id)).toBe(0)
  const project = s.addProject({ nameAr: 'مشروع', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = s.addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  s.refundLabOrder({ orderId: order.id, amountMinor: 4000, mode: 'customer_credit', reason: 'إشعار' })
  expect(s.getClaimBalance(insurer.id)).toBe(4200)
  expect(s.getCustomerBalance(customer.id)).toBe(8800)
  expect(s.getOpenClientInvoices(customer.id, true).find((d) => d.docKey === `extract:${extract.id}`)?.settledMinor).toBe(1200)
})

it('زيارة مؤمنة لا تُظهر نصيب جهة التأمين كذمة على العميل', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل العيادة', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '', linkedCustomerId: customer.id })
  const insurer = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
  s.registerInsuredVisit({ patientId: patient.id, providerId: insurer.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  expect(s.getPatientBalance(patient.id)).toBe(0)
  expect(s.getCustomerBalance(customer.id)).toBe(0)
  expect(s.getClaimBalance(insurer.id)).toBe(7000)
})

it('مرتجع معمل مؤمن عبر الماكينة يسجل حصة المريض فقط ويمنع رداً بعد تسوية المطالبة', () => {
  const s = useDataStore.getState()
  const patient = s.addLabPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', notes: '' })
  const test = s.addLabTest({ code: 'LAB-T', nameAr: 'تحليل', category: 'كيمياء', sampleType: 'دم', unit: '', priceMinor: 10000, costMinor: 0, refRanges: [] })
  const insurer = s.addInsuranceProvider({ nameAr: 'تأمين ماكينة', coveragePercent: 70 })
  s.addPaymentTerminal({ id: 'lab-t', code: 'LT-1', nameAr: 'ماكينة', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'LT-1', status: 'active' })
  const order = s.registerInsuredLabOrder({ patientId: patient.id, testIds: [test.id], providerId: insurer.id, referrerId: null, vatPercent: 0, treasury: '1101', terminalPayment: { terminalId: 'lab-t', providerReference: 'LAB-CHARGE' } })
  const charge = useDataStore.getState().paymentTerminalTransactions.find(t => t.providerReference === 'LAB-CHARGE')!
  s.refundLabOrder({ orderId: order.id, amountMinor: 4000, mode: 'cash', treasury: '1101', reason: 'رد جزئي', terminalRefund: { originalTransactionId: charge.id, providerReference: 'LAB-REFUND' } })
  expect(useDataStore.getState().paymentTerminalTransactions.find(t => t.providerReference === 'LAB-REFUND')?.amountMinor).toBe(1200)
  expect(s.getClaimBalance(insurer.id)).toBe(4200)
  s.settleInsuranceClaims(insurer.id)
  const before = useDataStore.getState().journal.length
  expect(() => s.refundLabOrder({ orderId: order.id, amountMinor: 1000, mode: 'cash', reason: 'مراجعة' })).toThrow(/محصلة بالفعل/)
  expect(useDataStore.getState().journal).toHaveLength(before)
})

it('تقريب مرتجعات المعمل المؤمّن الصغيرة تراكمي ولا يترك مطالبة وهمية', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل كسور', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const patient = s.addLabPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', notes: '', linkedCustomerId: customer.id })
  const test = s.addLabTest({ code: 'LAB-R', nameAr: 'تحليل', category: 'كيمياء', sampleType: 'دم', unit: '', priceMinor: 100, costMinor: 0, refRanges: [] })
  const insurer = s.addInsuranceProvider({ nameAr: 'تأمين كسور', coveragePercent: 33 })
  const order = s.registerInsuredLabOrder({ patientId: patient.id, testIds: [test.id], providerId: insurer.id, referrerId: null, vatPercent: 0 })
  for (let i = 0; i < 100; i++) s.refundLabOrder({ orderId: order.id, amountMinor: 1, mode: 'customer_credit', reason: 'رد' })
  expect(s.getClaimBalance(insurer.id)).toBe(0)
  expect(s.getCustomerBalance(customer.id)).toBe(-67)
  expect(useDataStore.getState().labOrders.find(o => o.id === order.id)?.refundedMinor).toBe(100)
})

it('يرفض مرتجع معمل مؤمّن إذا كان تاريخه القديم يجعل مطالبته أكبر من المتبقي', () => {
  const s = useDataStore.getState()
  const patient = s.addLabPatient({ nameAr: 'مريض قديم', phone: '', gender: 'male', birthDate: '', notes: '' })
  const test = s.addLabTest({ code: 'LAB-OLD', nameAr: 'تحليل', category: 'كيمياء', sampleType: 'دم', unit: '', priceMinor: 100, costMinor: 0, refRanges: [] })
  const insurer = s.addInsuranceProvider({ nameAr: 'تأمين قديم', coveragePercent: 33 })
  const order = s.registerInsuredLabOrder({ patientId: patient.id, testIds: [test.id], providerId: insurer.id, referrerId: null, vatPercent: 0 })
  useDataStore.setState({ labOrders: useDataStore.getState().labOrders.map(o => o.id === order.id ? { ...o, refundedMinor: 90, refundedTaxMinor: 0 } : o) })
  const before = useDataStore.getState().journal.length
  expect(() => s.refundLabOrder({ orderId: order.id, amountMinor: 1, mode: 'cash', reason: 'مراجعة' })).toThrow(/مراجعة مطالبة التأمين/)
  expect(useDataStore.getState().journal).toHaveLength(before)
})

it('يرفض تحميل نقص حصة التأمين التاريخية على مرتجع صغير', () => {
  const s = useDataStore.getState()
  const patient = s.addLabPatient({ nameAr: 'مريض قديم', phone: '', gender: 'male', birthDate: '', notes: '' })
  const test = s.addLabTest({ code: 'LAB-GAP', nameAr: 'تحليل', category: 'كيمياء', sampleType: 'دم', unit: '', priceMinor: 100, costMinor: 0, refRanges: [] })
  const insurer = s.addInsuranceProvider({ nameAr: 'تأمين قديم', coveragePercent: 70 })
  const order = s.registerInsuredLabOrder({ patientId: patient.id, testIds: [test.id], providerId: insurer.id, referrerId: null, vatPercent: 0 })
  useDataStore.setState({ labOrders: useDataStore.getState().labOrders.map(o => o.id === order.id ? { ...o, refundedMinor: 5, refundedTaxMinor: 0 } : o) })
  const before = useDataStore.getState().journal.length
  expect(() => s.refundLabOrder({ orderId: order.id, amountMinor: 1, mode: 'cash', reason: 'مراجعة' })).toThrow(/لا يمكن تحميل الفرق/)
  expect(useDataStore.getState().journal).toHaveLength(before)
})
