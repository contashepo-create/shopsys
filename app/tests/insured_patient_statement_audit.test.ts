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
