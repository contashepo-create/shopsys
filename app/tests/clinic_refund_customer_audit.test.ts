import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useDataStore.getState()
const app = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useDataStore.setState({ ...original, customers: [], clinicPatients: [], clinicVisits: [], clinicCollections: [], projects: [], projectExtracts: [], journal: [], insuranceClaims: [], vouchers: [], clientSettlements: [], cheques: [], openingBalances: {} })
})

it('مرتجع زيارة على الحساب يظهر في كشف العميل ويخفض مستخلصه دون مضاعفة', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل مريض', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '', linkedCustomerId: customer.id })
  const visit = s.addClinicVisit({ patientId: patient.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 4000, paidMinor: 4000, vatPercent: 0, planId: null })
  const project = s.addProject({ nameAr: 'مشروع', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = s.addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  s.refundClinicVisit({ visitId: visit.id, amountMinor: 4000, mode: 'patient_credit', reason: 'إشعار' })
  expect(s.getPatientBalance(patient.id)).toBe(-4000)
  expect(s.getCustomerBalance(customer.id)).toBe(6000)
  const doc = s.getOpenClientInvoices(customer.id, true).find((row) => row.docKey === `extract:${extract.id}`)!
  expect(doc.settledMinor).toBe(4000)
  expect(doc.adjustmentAllocations?.[0].description).toContain('مرتجع زيارة')
})

it('يرفض رصيد مريض غير مرتبط ومرتجع زيارة مؤمنة بلا أي قيد جديد', () => {
  const s = useDataStore.getState()
  const patient = s.addClinicPatient({ nameAr: 'مريض غير مرتبط', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const visit = s.addClinicVisit({ patientId: patient.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 4000, paidMinor: 4000, vatPercent: 0, planId: null })
  const count = useDataStore.getState().journal.length
  expect(() => s.refundClinicVisit({ visitId: visit.id, amountMinor: 1000, mode: 'patient_credit', reason: 'رد' })).toThrow(/اربط المريض/)
  useDataStore.setState({ insuranceClaims: [{ id: 1, source: 'clinic_visit', sourceId: visit.id }] as never })
  expect(() => s.refundClinicVisit({ visitId: visit.id, amountMinor: 1000, mode: 'cash', reason: 'رد' })).toThrow(/مؤمّنة/)
  expect(useDataStore.getState().journal).toHaveLength(count)
})
